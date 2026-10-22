import { diskCache } from './diskCache.mjs';
import { normalizeTitle } from './genres.mjs';

// HowLongToBeat has no official API. This uses the same search its website
// does: a short-lived token from /api/search/site/init, then a POST search.
// If they change it, lookups just come back empty.

const BASE = 'https://howlongtobeat.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  Referer: `${BASE}/`,
  Origin: BASE,
};
const cache = diskCache('hltb', 60 * 24 * 3600 * 1000);
let token = null;
let next = 0;

async function getToken(fresh = false) {
  if (token && !fresh && Date.now() - token.at < 10 * 60 * 1000) return token.value;
  const r = await fetch(`${BASE}/api/search/site/init?t=${Date.now()}`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HowLongToBeat: HTTP ${r.status}`);
  token = { value: (await r.json()).token, at: Date.now() };
  return token.value;
}

async function search(title, retry = true) {
  // Be gentle: at most two searches a second.
  const wait = next - Date.now();
  next = Math.max(Date.now(), next) + 500;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const body = {
    searchType: 'games',
    searchTerms: title.split(/\s+/).filter(Boolean),
    searchPage: 1,
    size: 10,
    searchOptions: {
      games: {
        userId: 0,
        platform: '',
        sortCategory: 'popular',
        rangeCategory: 'main',
        rangeTime: { min: null, max: null },
        gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { min: '', max: '' },
        modifier: '',
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '',
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
  };
  const r = await fetch(`${BASE}/api/search/site`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', 'x-auth-token': await getToken(!retry) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if ((r.status === 401 || r.status === 403) && retry) return search(title, false);
  if (!r.ok) throw new Error(`HowLongToBeat: HTTP ${r.status}`);
  return (await r.json()).data ?? [];
}

const hours = (seconds) => (seconds > 0 ? Math.round((seconds / 3600) * 2) / 2 : undefined);

/**
 * Typical hours to beat: { main, extra, complete, url } or null when not found.
 * Exact title matches win; otherwise the most popular result whose title
 * contains the one asked for.
 */
export async function howLongToBeat(title) {
  const key = normalizeTitle(title);
  const cached = await cache.get(key);
  if (cached !== undefined) return cached;
  const data = await search(title.replace(/[™®©:]/g, ' ').trim());
  const hit =
    data.find((d) => normalizeTitle(d.game_name) === key) ??
    data.find((d) => normalizeTitle(d.game_alias || '') === key) ??
    data.find((d) => normalizeTitle(d.game_name).startsWith(key));
  const result = hit
    ? {
        main: hours(hit.comp_main),
        extra: hours(hit.comp_plus),
        complete: hours(hit.comp_100),
        url: `${BASE}/game/${hit.game_id}`,
      }
    : null;
  await cache.set(key, result);
  return result;
}
