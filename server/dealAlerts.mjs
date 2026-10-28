// Free game and big deal alerts, per account, sent to the same ntfy topic as
// price alerts (server/alerts.mjs) and checked on the same schedule.
//
// - Free games: GamerPower's giveaway list (https://www.gamerpower.com, free,
//   no key; it asks for a credit, shown in Settings and on the homepage).
// - Big deals: IsThereAnyDeal's deals list (ITAD_API_KEY), any game at or past
//   the account's discount, optionally only at its all-time low and only
//   well-reviewed games.
//
// Every item is sent to an account once (deal_alerts_sent); several new items
// in one check go out as one notification.
import { query } from './db.mjs';
import { notify } from './alerts.mjs';
import { itadConfigured } from './itad.mjs';

const USER_AGENT = 'Savepoint/0.1 (self-hosted game library app)';

// ---------------------------------------------------------------- settings

/** Stores you can pick for free games, matched against GamerPower's platform names. */
export const FREE_STORES = {
  steam: /\bSteam\b/i,
  epic: /Epic Games/i,
  gog: /\bGOG\b/i,
  itchio: /itch\.?io/i,
  ubisoft: /Ubisoft/i,
  ea: /\bEA\b|Origin/i,
  battlenet: /Battle\.?net/i,
  amazon: /Prime Gaming|Amazon/i,
  playstation: /PlayStation|\bPS[345]\b/i,
  xbox: /Xbox/i,
  switch: /Switch|Nintendo/i,
  mobile: /Android|iOS/i,
  drmfree: /DRM-?Free/i,
};

export const DEFAULT_DEAL_SETTINGS = {
  freeGames: { enabled: false, stores: ['steam', 'epic', 'gog'], dlc: false, loot: false },
  bigDeals: { enabled: false, minCut: 75, historicalLow: true, wellReviewed: true },
};

function clean(raw) {
  const f = raw?.freeGames ?? {};
  const b = raw?.bigDeals ?? {};
  const d = DEFAULT_DEAL_SETTINGS;
  return {
    freeGames: {
      enabled: typeof f.enabled === 'boolean' ? f.enabled : d.freeGames.enabled,
      stores: Array.isArray(f.stores) ? f.stores.filter((s) => s in FREE_STORES) : d.freeGames.stores,
      dlc: typeof f.dlc === 'boolean' ? f.dlc : d.freeGames.dlc,
      loot: typeof f.loot === 'boolean' ? f.loot : d.freeGames.loot,
    },
    bigDeals: {
      enabled: typeof b.enabled === 'boolean' ? b.enabled : d.bigDeals.enabled,
      minCut: Number.isFinite(Number(b.minCut)) ? Math.min(95, Math.max(30, Math.round(Number(b.minCut)))) : d.bigDeals.minCut,
      historicalLow: typeof b.historicalLow === 'boolean' ? b.historicalLow : d.bigDeals.historicalLow,
      wellReviewed: typeof b.wellReviewed === 'boolean' ? b.wellReviewed : d.bigDeals.wellReviewed,
    },
  };
}

export async function dealSettings(userId) {
  const { rows } = await query('SELECT "data" FROM deal_alert_settings WHERE "user_id" = $1', [userId]);
  return clean(rows[0]?.data);
}

export async function saveDealSettings(userId, raw) {
  const data = clean(raw);
  await query(
    `INSERT INTO deal_alert_settings ("user_id", "data") VALUES ($1, $2)
     ON CONFLICT ("user_id") DO UPDATE SET "data" = EXCLUDED."data", "updated_at" = now()`,
    [userId, JSON.stringify(data)],
  );
  return data;
}

// ---------------------------------------------------------------- sources

let giveawayCache = null;

/** Active GamerPower giveaways, kept for an hour. */
export async function freeGiveaways() {
  if (giveawayCache && giveawayCache.at > Date.now() - 3600 * 1000) return giveawayCache.list;
  const r = await fetch('https://www.gamerpower.com/api/giveaways?sort-by=popularity', {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  // 201 = no active giveaways.
  if (r.status === 201) return [];
  if (!r.ok) throw new Error(`GamerPower: HTTP ${r.status}`);
  const raw = await r.json();
  const list = (Array.isArray(raw) ? raw : [])
    .filter((g) => g.status !== 'Expired')
    .map((g) => {
      const t = String(g.type ?? '').toLowerCase();
      return {
        id: g.id,
        title: String(g.title ?? '')
          .replace(/\s*\((?:Steam|Epic Games|GOG|PC|[^)]*Store)\)\s*/gi, ' ')
          .replace(/\s*Giveaway\s*$/i, '')
          .trim(),
        kind: t.includes('loot') ? 'loot' : t.includes('dlc') ? 'dlc' : t.includes('beta') ? 'beta' : 'game',
        worth: g.worth && g.worth !== 'N/A' ? g.worth : undefined,
        platforms: String(g.platforms ?? ''),
        image: g.image || g.thumbnail || undefined,
        endsAt: g.end_date && g.end_date !== 'N/A' ? `${g.end_date.replace(' ', 'T')}Z` : undefined,
        url: g.open_giveaway_url || g.gamerpower_url,
        users: Number(g.users) || 0,
      };
    });
  giveawayCache = { at: Date.now(), list };
  return list;
}

/** Giveaways an account's free-game settings ask for. */
export function matchingGiveaways(list, s) {
  const stores = s.stores.map((k) => FREE_STORES[k]).filter(Boolean);
  return list.filter(
    (g) =>
      (g.kind === 'game' || (g.kind === 'dlc' && s.dlc) || (g.kind === 'loot' && s.loot)) &&
      (!stores.length || stores.some((re) => re.test(g.platforms))),
  );
}

const dealCache = new Map();

/**
 * Current deals at `minCut`% off or more, from IsThereAnyDeal's list, most
 * popular first. Cached for three hours per set of filters.
 */
export async function bigDeals({ minCut, historicalLow, wellReviewed }) {
  if (!itadConfigured()) return [];
  const key = `${minCut}|${historicalLow}|${wellReviewed}`;
  const hit = dealCache.get(key);
  if (hit && hit.at > Date.now() - 3 * 3600 * 1000) return hit.list;
  const filter = {
    cut: { min: minCut, max: null },
    // Games only, no DLC, bundles or software.
    type: [1],
    ...(wellReviewed && { steamPerc: { min: 75, max: null }, steamCount: { min: 500, max: null } }),
  };
  const r = await fetch(`https://api.isthereanydeal.com/deals/v2?key=${encodeURIComponent(process.env.ITAD_API_KEY.trim())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country: 'US', limit: 200, filter }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`IsThereAnyDeal deals: HTTP ${r.status}`);
  const list = ((await r.json()).list ?? [])
    .filter((x) => x?.deal && x.deal.cut >= minCut)
    // H = at its all-time low, N = a new all-time low.
    .filter((x) => !historicalLow || x.deal.flag === 'H' || x.deal.flag === 'N')
    .map((x) => ({
      id: x.id,
      title: x.title,
      shop: x.deal.shop?.name,
      price: x.deal.price?.amount,
      regular: x.deal.regular?.amount,
      cut: x.deal.cut,
      historicalLow: x.deal.flag === 'H' || x.deal.flag === 'N',
      image: x.assets?.banner400 ?? x.assets?.banner300,
      endsAt: x.deal.expiry ?? undefined,
      url: x.deal.url,
    }));
  dealCache.set(key, { at: Date.now(), list });
  return list;
}

// ---------------------------------------------------------------- checking

const money = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : '');

async function alreadySent(userId, keys) {
  if (!keys.length) return new Set();
  const { rows } = await query(
    'SELECT "item_key" FROM deal_alerts_sent WHERE "user_id" = $1 AND "item_key" = ANY($2::text[])',
    [userId, keys],
  );
  return new Set(rows.map((r) => r.item_key));
}

async function markSent(userId, keys) {
  if (!keys.length) return;
  await query(
    `INSERT INTO deal_alerts_sent ("user_id", "item_key")
     SELECT $1, k FROM unnest($2::text[]) AS k ON CONFLICT DO NOTHING`,
    [userId, keys],
  );
}

/** One notification for one item, a summary for several. */
async function send(topic, items, { one, many, url }) {
  if (!items.length) return 0;
  const message =
    items.length === 1
      ? one(items[0])
      : `${items
          .slice(0, 10)
          .map((x) => `• ${one(x, true)}`)
          .join('\n')}${items.length > 10 ? `\n…and ${items.length - 10} more` : ''}`;
  await notify(topic, {
    title: items.length === 1 ? items[0].title : many(items.length),
    message,
    url: items.length === 1 ? items[0].url : url,
  });
  return 1;
}

/**
 * Checks free games and big deals for every account that has them on (or just
 * `userId`) and an ntfy topic. Each source is read once per check.
 */
export async function checkDealAlerts({ userId = null } = {}) {
  const { rows } = await query(
    `SELECT s."user_id", s."data", t."topic" FROM deal_alert_settings s JOIN alert_topics t USING ("user_id")
     WHERE $1::integer IS NULL OR s."user_id" = $1`,
    [userId],
  );
  let sent = 0;
  let giveaways = null;
  for (const row of rows) {
    const s = clean(row.data);
    try {
      if (s.freeGames.enabled) {
        giveaways ??= await freeGiveaways().catch(() => []);
        const wanted = matchingGiveaways(giveaways, s.freeGames);
        const done = await alreadySent(row.user_id, wanted.map((g) => `free:${g.id}`));
        const fresh = wanted.filter((g) => !done.has(`free:${g.id}`));
        sent += await send(row.topic, fresh, {
          one: (g, short) =>
            short
              ? `${g.title}${g.worth ? ` (${g.worth})` : ''}`
              : `Free to keep${g.worth ? ` (usually ${g.worth})` : ''} on ${g.platforms}.` +
                (g.endsAt ? ` Ends ${new Date(g.endsAt).toUTCString().slice(5, 16)}.` : ''),
          many: (n) => `${n} free games`,
          url: 'https://www.gamerpower.com',
        });
        await markSent(row.user_id, fresh.map((g) => `free:${g.id}`));
      }
      if (s.bigDeals.enabled) {
        const deals = await bigDeals(s.bigDeals).catch(() => []);
        // Keyed by price, so a deeper cut later is sent again.
        const key = (d) => `deal:${d.id}:${d.price}`;
        const done = await alreadySent(row.user_id, deals.map(key));
        const fresh = deals.filter((d) => !done.has(key(d)));
        sent += await send(row.topic, fresh, {
          one: (d, short) =>
            short
              ? `${d.title}: ${money(d.price)} (-${d.cut}%)${d.historicalLow ? ', all-time low' : ''}`
              : `${money(d.price)} at ${d.shop}, ${d.cut}% off${d.historicalLow ? ', its all-time low' : ''}.`,
          many: (n) => `${n} big deals`,
          url: 'https://isthereanydeal.com/deals/',
        });
        await markSent(row.user_id, fresh.map(key));
      }
    } catch {
      // No error notifications for background work; the next check tries again.
    }
  }
  // Old entries can't match anything any more.
  await query(`DELETE FROM deal_alerts_sent WHERE "sent_at" < now() - interval '120 days'`).catch(() => {});
  return { accounts: rows.length, sent };
}
