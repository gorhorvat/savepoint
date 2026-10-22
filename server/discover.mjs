import { STEAM_TAGS, steamApi, steamTagNames } from './genres.mjs';
import { NINTENDO_GENRES, nintendoByGenre, steamResults } from './search.mjs';
import { diskCache } from './diskCache.mjs';

// Candidates for Play next: well-reviewed Steam games carrying the Steam tags
// behind your favourite sub-genres and genres (needs STEAM_API_KEY), plus the
// most popular Switch games in your favourite genres from the eShop.

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

/** subgenres/genres: Savepoint names, strongest first. */
export async function discoverPool(subgenres, genres) {
  const key = `${subgenres.join('|')}#${genres.join('|')}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  const [steam, nintendo] = await Promise.all([
    steamPool(subgenres, genres).catch(() => []),
    switchPool(genres).catch(() => []),
  ]);
  const games = [...steam, ...nintendo];
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
