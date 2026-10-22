import { diskCache } from './diskCache.mjs';

// IsThereAnyDeal: the best current PC price across ~50 stores and the
// all-time low. Needs ITAD_API_KEY. Game ids are cached for good, prices for
// three hours.

const API = 'https://api.isthereanydeal.com';
const ids = diskCache('itad-ids', 0);
const prices = diskCache('itad-prices', 3 * 3600 * 1000);

export const itadConfigured = () => Boolean(process.env.ITAD_API_KEY?.trim());
const key = () => `key=${encodeURIComponent(process.env.ITAD_API_KEY.trim())}`;

async function itadId({ title, steamAppId }) {
  const cacheKey = steamAppId ? `steam:${steamAppId}` : `t:${title.toLowerCase()}`;
  const cached = await ids.get(cacheKey);
  if (cached !== undefined) return cached;
  const qs = steamAppId ? `appid=${steamAppId}` : `title=${encodeURIComponent(title)}`;
  const r = await fetch(`${API}/games/lookup/v1?${key()}&${qs}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`IsThereAnyDeal: HTTP ${r.status}`);
  const j = await r.json();
  const id = j.found ? j.game.id : null;
  await ids.set(cacheKey, id);
  return id;
}

/**
 * { current: { price, regular, cut, shop, url }, lowest: { price, shop, date }, url }
 * in USD, or null when IsThereAnyDeal doesn't know the game.
 */
export async function itadDeal(game) {
  if (!itadConfigured()) return null;
  const id = await itadId(game);
  if (!id) return null;
  const cached = await prices.get(id);
  if (cached !== undefined) return cached;
  const r = await fetch(`${API}/games/overview/v2?${key()}&country=US`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([id]),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`IsThereAnyDeal: HTTP ${r.status}`);
  const p = (await r.json()).prices?.[0];
  const result = p
    ? {
        current: p.current && {
          price: p.current.price.amount,
          regular: p.current.regular.amount,
          cut: p.current.cut,
          shop: p.current.shop.name,
          url: p.current.url,
        },
        lowest: p.lowest && {
          price: p.lowest.price.amount,
          shop: p.lowest.shop.name,
          date: p.lowest.timestamp,
        },
        url: p.urls?.game,
      }
    : null;
  await prices.set(id, result);
  return result;
}
