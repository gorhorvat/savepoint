import { diskCache } from './diskCache.mjs';
import { itadDeal } from './itad.mjs';
import { nintendoPrice } from './search.mjs';

// Price alerts: the app sends its wishlist targets here, and the server checks
// them every six hours while it runs, sending a push notification through
// ntfy (https://ntfy.sh) when a game drops to or below its target. Needs
// NTFY_TOPIC; subscribe to the same topic in the ntfy phone app.

const store = diskCache('alerts', 0);
const EVERY = 6 * 3600 * 1000;
let timer = null;

export const ntfyTopic = () => process.env.NTFY_TOPIC?.trim() || '';

export async function notify({ title, message, url }) {
  const topic = ntfyTopic();
  if (!topic) throw new Error('NTFY_TOPIC is not set on the server.');
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: {
      // Header values must be plain ASCII.
      Title: title.replace(/[^\x20-\x7e]/g, ''),
      Tags: 'video_game',
      ...(url && { Click: url }),
    },
    body: message,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`ntfy: HTTP ${r.status}`);
}

/** Best current price for an alert item: IsThereAnyDeal for PC, the eShop for Switch. */
async function bestPrice(item) {
  const options = [];
  if (item.pc) {
    const d = await itadDeal(item).catch(() => null);
    if (d?.current) options.push({ price: d.current.price, where: d.current.shop, url: d.current.url });
  }
  if (item.switch) {
    const e = await nintendoPrice(item.title, item.nsuid).catch(() => null);
    if (e) options.push({ price: e.price, where: 'Nintendo eShop', url: e.url });
  }
  return options.sort((a, b) => a.price - b.price)[0] ?? null;
}

export async function checkAlerts() {
  if (!ntfyTopic()) return { checked: 0, sent: 0 };
  const items = (await store.get('items')) ?? [];
  const sent = (await store.get('sent')) ?? {};
  let count = 0;
  for (const item of items) {
    if (item.target == null) continue;
    const best = await bestPrice(item);
    if (!best || best.price > item.target) {
      // Back above target: allow a new alert the next time it drops.
      if (sent[item.id] != null) delete sent[item.id];
      continue;
    }
    // Only notify again if the price fell further since the last alert.
    if (sent[item.id] != null && best.price >= sent[item.id]) continue;
    await notify({
      title: `${item.title}: $${best.price.toFixed(2)}`,
      message: `${item.title} is $${best.price.toFixed(2)} at ${best.where}, at or below your $${item.target.toFixed(2)} target.`,
      url: best.url,
    }).catch(() => {});
    sent[item.id] = best.price;
    count++;
  }
  await store.set('sent', sent);
  await store.set('checkedAt', new Date().toISOString());
  return { checked: items.length, sent: count };
}

/** Replaces the list of watched games (from the app's wishlist targets). */
export async function setAlerts(items) {
  await store.set('items', items);
  return checkAlerts();
}

/** Local runs only; on Vercel a daily Cron job calls /api/cron/alerts instead. */
export function startAlertTimer() {
  if (timer) return;
  timer = setInterval(() => void checkAlerts().catch(() => {}), EVERY);
  // First check shortly after the server starts.
  setTimeout(() => void checkAlerts().catch(() => {}), 60_000);
}
