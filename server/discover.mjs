import { STEAM_TAGS, steamApi, steamTagNames } from './genres.mjs';
import { NINTENDO_GENRES, nintendoByGenre, searchGames, steamResults } from './search.mjs';
import { diskCache } from './diskCache.mjs';
import { igdbConsolePool, igdbPlatformsForSteam } from './igdb.mjs';

// Candidates for Play next: well-reviewed Steam games carrying the Steam tags
// behind your favourite sub-genres and genres (needs STEAM_API_KEY), the most
// popular Switch games in your favourite genres from the eShop, and popular
// PlayStation and Xbox games in them from IGDB. IGDB also says which consoles
// each Steam game is on, so "Only on my platforms" works without a PC.

const PER_TAG = 80;
const MAX_GAMES = 400;
const TTL = 24 * 3600 * 1000;
// On disk (.cache/discover.json), so Play next is instant after a restart too.
// The app doesn't save the pool with your library; it asks for it here.
const cache = diskCache('discover', TTL);

/** Steam tag names behind a Savepoint sub-genre or genre ("Soulslike" -> ["Souls-like"]). */
function steamTagsFor(name, key) {
  return Object.entries(STEAM_TAGS)
    .filter(([, m]) => m[key] === name)
    .map(([tag]) => tag);
}

async function topForTag(tagid) {
  const input = {
    query: {
      start: 0,
      count: PER_TAG,
      // Popular first; without a sort Steam returns games in no useful order.
      sort: 13,
      filters: { released_only: true, type_filters: { include_games: true }, tagids_must_match: [{ tagids: [tagid] }] },
    },
    context: { language: 'english', country_code: 'US' },
    data_request: { include_reviews: true },
  };
  const r = await steamApi(
    `https://api.steampowered.com/IStoreQueryService/Query/v1/?key=${process.env.STEAM_API_KEY}` +
      `&input_json=${encodeURIComponent(JSON.stringify(input))}`,
  );
  if (!r.ok) return [];
  const data = await r.json();
  return (data.response?.store_items ?? [])
    .filter((i) => {
      const s = i.reviews?.summary_filtered;
      return s && s.percent_positive >= 80 && s.review_count >= 500;
    })
    .map((i) => i.appid);
}

/** Popular Switch games for your top genres, a fair share from each. */
async function switchPool(genres) {
  const labels = [
    ...new Set(
      genres.flatMap((g) =>
        Object.entries(NINTENDO_GENRES)
          .filter(([label, m]) => m.g === g && !/-/.test(label))
          .map(([label]) => label),
      ),
    ),
  ].slice(0, 5);
  const lists = await Promise.all(labels.map((l) => nintendoByGenre(l, 60).catch(() => [])));
  const seen = new Set();
  const out = [];
  for (let i = 0; i < 60; i++) {
    for (const list of lists) {
      const g = list[i];
      if (g && !seen.has(g.title)) {
        seen.add(g.title);
        out.push(g);
      }
    }
  }
  return out.filter((g) => g.genres.length + g.subgenres.length > 0);
}

const words = (s) =>
  ` ${s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

/**
 * Games in your favourite franchises, found by searching the stores for each
 * name and keeping titles that contain it ("Resident Evil" -> Resident Evil 4,
 * Village, …). Searched one at a time to go easy on the stores.
 */
async function franchisePool(franchises) {
  const out = [];
  for (const name of franchises) {
    const key = words(name);
    if (key.trim().length < 2) continue;
    const found = await searchGames(name).catch(() => []);
    out.push(...found.filter((g) => words(g.title).includes(key)).slice(0, 30));
  }
  return out;
}

/** subgenres/genres: Savepoint names, strongest first. franchises: your favourites. */
export async function discoverPool(subgenres, genres, franchises = []) {
  // v2: with console games and every platform a game is on.
  const key = `v2#${subgenres.join('|')}#${genres.join('|')}#${franchises.join('|')}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  const [series, steam, nintendo, consoles] = await Promise.all([
    franchisePool(franchises).catch(() => []),
    steamPool(subgenres, genres).catch(() => []),
    switchPool(genres).catch(() => []),
    igdbConsolePool(genres).catch(() => []),
  ]);
  // Franchise games first, so they survive de-duplication with their search
  // details; a game found twice keeps every platform it was found on.
  const byId = new Map();
  for (const g of [...series, ...steam, ...nintendo, ...consoles]) {
    const id = g.steamAppId ? `s${g.steamAppId}` : words(g.title);
    const kept = byId.get(id) ?? byId.get(words(g.title));
    if (kept) kept.availableOn = [...new Set([...kept.availableOn, ...g.availableOn])];
    else {
      const copy = { ...g, availableOn: [...g.availableOn] };
      byId.set(id, copy);
      byId.set(words(g.title), copy);
    }
  }
  const games = [...new Set(byId.values())];
  const platforms = await igdbPlatformsForSteam(games.map((g) => g.steamAppId).filter(Boolean)).catch(() => new Map());
  for (const g of games) {
    const more = g.steamAppId && platforms.get(g.steamAppId);
    if (more) g.availableOn = [...new Set([...g.availableOn, ...more])];
  }
  if (games.length) cache.set(key, games); // Don't keep a failed lookup for a day.
  return games;
}

async function steamPool(subgenres, genres) {
  if (!process.env.STEAM_API_KEY?.trim()) return [];
  const wanted = [...subgenres.flatMap((s) => steamTagsFor(s, 's')), ...genres.flatMap((g) => steamTagsFor(g, 'g'))];

  const names = await steamTagNames();
  const idByName = new Map([...names].map(([id, name]) => [name, id]));
  const tagids = [...new Set(wanted.map((t) => idByName.get(t)).filter(Boolean))].slice(0, 12);

  const lists = await Promise.all(tagids.map((id) => topForTag(id).catch(() => [])));
  // Interleave the lists so every tag gets a fair share before the cap.
  const appids = [];
  for (let i = 0; i < PER_TAG && appids.length < MAX_GAMES; i++) {
    for (const list of lists) if (list[i] && !appids.includes(list[i])) appids.push(list[i]);
  }
  return (await steamResults(appids.slice(0, MAX_GAMES))).filter((g) => g.genres.length + g.subgenres.length > 0);
}
