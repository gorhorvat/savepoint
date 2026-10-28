import { diskCache } from './diskCache.mjs';
import { normalizeTitle } from './genres.mjs';

// OpenCritic through RapidAPI. The free plan allows 25 searches and 200 game
// lookups a day, so a title's OpenCritic id is cached for good and its score
// and outlet reviews (two lookups) for a month, and searching stops for the
// day once the quota runs out.

const HOST = 'opencritic-api.p.rapidapi.com';
const ids = diskCache('opencritic-ids', 0);
// v2: with per-outlet reviews.
const scores = diskCache('opencritic-scores-2', 30 * 24 * 3600 * 1000);
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

/** Big outlets, shown first when they reviewed the game. */
const BIG_OUTLETS = [
  'IGN',
  'GameSpot',
  'PC Gamer',
  'Eurogamer',
  'GamesRadar+',
  'Game Informer',
  'Polygon',
  'Destructoid',
  'VGC',
  'The Guardian',
  'Push Square',
  'Nintendo Life',
  'Pure Xbox',
  'Rock Paper Shotgun',
  'Shacknews',
  'Hardcore Gamer',
];
const bigRank = (name) => {
  const i = BIG_OUTLETS.findIndex((o) => o.toLowerCase() === String(name).toLowerCase());
  return i === -1 ? BIG_OUTLETS.length : i;
};

/** The score as the outlet gave it: "8.5 / 10", "4 / 5", "Recommended", "88". */
function scoreLabel(r) {
  const f = r.ScoreFormat ?? {};
  const score = Number(r.score);
  if (Array.isArray(f.options) && f.options.length) {
    const opt = f.options.find((o) => score >= Number(o.min ?? o.val ?? -Infinity) && score <= Number(o.max ?? o.val ?? Infinity));
    if (opt?.label) return opt.label;
  }
  if (!Number.isFinite(score)) return null;
  const base = Number(f.base);
  const shown = Number.isInteger(score) ? String(score) : score.toFixed(1).replace(/\.0$/, '');
  return base && base !== 100 ? `${shown} / ${base}` : shown;
}

/** Up to 6 outlet reviews with a score, big outlets and top critics first. */
function pickOutlets(reviews) {
  if (!Array.isArray(reviews)) return [];
  const seen = new Set();
  return reviews
    .filter((r) => r?.Outlet?.name && r.npScore > 0 && scoreLabel(r))
    .map((r) => ({
      outlet: r.Outlet.name,
      score: scoreLabel(r),
      // 0 to 100, for colouring.
      normalized: Math.round(r.npScore),
      url: r.externalUrl || undefined,
      top: Boolean(r.Outlet.isContributor),
    }))
    .sort((a, b) => bigRank(a.outlet) - bigRank(b.outlet) || Number(b.top) - Number(a.top))
    .filter((r) => !seen.has(r.outlet) && seen.add(r.outlet))
    .slice(0, 6);
}

/**
 * { score, tier, reviews, url, outlets } for a game, null when OpenCritic doesn't
 * have it or the quota is used up. `outlets` lists individual reviews (IGN 9 / 10...).
 */
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
  // Outlet reviews are a nice extra: a failure here still caches the score.
  const reviews = g.topCriticScore > 0 ? await call(`/review/game/${id}`).catch(() => null) : null;
  const result =
    g.topCriticScore > 0
      ? {
          score: Math.round(g.topCriticScore),
          tier: g.tier,
          reviews: g.numReviews,
          url: `https://opencritic.com/game/${id}/${g.url?.split('/').pop() ?? ''}`,
          outlets: pickOutlets(reviews),
        }
      : null;
  await scores.set(String(id), result);
  return result;
}
