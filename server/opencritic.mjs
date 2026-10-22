import { diskCache } from './diskCache.mjs';
import { normalizeTitle } from './genres.mjs';

// OpenCritic through RapidAPI. The free plan allows 25 searches and 200 game
// lookups a day, so a title's OpenCritic id is cached for good and its score
// for a month, and searching stops for the day once the quota runs out.

const HOST = 'opencritic-api.p.rapidapi.com';
const ids = diskCache('opencritic-ids', 0);
const scores = diskCache('opencritic-scores', 30 * 24 * 3600 * 1000);
// Kept in the cache too, so a fresh serverless instance knows the quota is used up.
const quota = diskCache('opencritic-quota', 0);
let searchesBlockedUntil = 0;

function blockSearches(resetSeconds) {
  searchesBlockedUntil = Date.now() + (Number(resetSeconds) || 3600) * 1000;
  return quota.set('searchesBlockedUntil', searchesBlockedUntil);
}

async function searchesBlocked() {
  if (Date.now() < searchesBlockedUntil) return true;
  searchesBlockedUntil = Math.max(searchesBlockedUntil, (await quota.get('searchesBlockedUntil')) ?? 0);
  return Date.now() < searchesBlockedUntil;
}

async function call(path) {
  const r = await fetch(`https://${HOST}${path}`, {
    headers: { 'X-RapidAPI-Key': process.env.OPENCRITIC_RAPIDAPI_KEY.trim(), 'X-RapidAPI-Host': HOST },
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 429) {
    if (path.startsWith('/game/search')) await blockSearches(r.headers.get('x-ratelimit-searches-reset'));
    return null;
  }
  if (!r.ok) throw new Error(`OpenCritic: HTTP ${r.status}`);
  if (path.startsWith('/game/search') && r.headers.get('x-ratelimit-searches-remaining') === '0') {
    await blockSearches(r.headers.get('x-ratelimit-searches-reset'));
  }
  return r.json();
}

/** { score, tier, reviews, url } for a game, null when OpenCritic doesn't have it or the quota is used up. */
export async function criticScore(title) {
  if (!process.env.OPENCRITIC_RAPIDAPI_KEY?.trim()) return null;
  const key = normalizeTitle(title);
  let id = await ids.get(key);
  if (id === undefined) {
    if (await searchesBlocked()) return null;
    const hits = await call(`/game/search?criteria=${encodeURIComponent(title)}`);
    if (!hits) return null;
    const hit = hits.find((h) => normalizeTitle(h.name) === key) ?? (hits[0]?.dist <= 0.1 ? hits[0] : null);
    id = hit?.id ?? null;
    await ids.set(key, id);
  }
  if (!id) return null;
  const cached = await scores.get(String(id));
  if (cached !== undefined) return cached;
  const g = await call(`/game/${id}`);
  if (!g) return null;
  const result =
    g.topCriticScore > 0
      ? {
          score: Math.round(g.topCriticScore),
          tier: g.tier,
          reviews: g.numReviews,
          url: `https://opencritic.com/game/${id}/${g.url?.split('/').pop() ?? ''}`,
        }
      : null;
  await scores.set(String(id), result);
  return result;
}
