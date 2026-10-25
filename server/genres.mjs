// Looks up genres for games that aren't in Savepoint's catalog, in two passes:
//
// 1. Steam (fast): titles are matched against Steam's full app list, which is
//    downloaded once and cached on disk, then community tags for up to 100
//    games are fetched per request. Covers most games, including PlayStation
//    titles that were also released on PC.
// 2. Wikidata (slow, rate-limited): console exclusives use Wikidata's "genre"
//    property. Requests stop early instead of waiting out rate limits, and
//    tell the client when to continue.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CACHE_DIR } from './diskCache.mjs';

const USER_AGENT = 'Savepoint/0.1 (self-hosted game library app)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RateLimited extends Error {
  constructor(retryAfter) {
    super('rate limited');
    this.retryAfter = retryAfter;
  }
}

/** Spaces out calls to one host. A 429 throws right away with the wait asked for. */
function throttled(minGapMs) {
  let next = 0;
  return async function get(url) {
    const wait = next - Date.now();
    if (wait > 0) await sleep(wait);
    next = Date.now() + minGapMs;
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (r.status === 429) {
      const retryAfter = Math.min(Number(r.headers.get('retry-after')) || 30, 120);
      next = Date.now() + retryAfter * 1000;
      throw new RateLimited(retryAfter);
    }
    return r;
  };
}

export const steamApi = throttled(100);
const steamStore = throttled(1500);
const wikidata = throttled(1000);

// Same normalization as the client's matcher: drop symbols, editions and
// platform suffixes so "Ghost of Tsushima DIRECTOR'S CUT" finds the game.
const NOISE = [
  /\b(game of the year|goty|complete|definitive|deluxe|ultimate|standard|digital|director'?s cut|remastered|enhanced|anniversary|royal edition)\b( edition)?/g,
  // Platform suffixes before the bare word "edition": otherwise "Red Dead
  // Redemption: Nintendo Switch 2 Edition" loses "edition" first and ends up
  // as "red dead redemption 2". Longest first, so "ps4 and ps5" goes whole.
  /\b(ps4\s+and\s+ps5|playstation ?[345]|ps[345]|for nintendo switch|nintendo switch 2 edition|nintendo switch)\b/g,
  /\bedition\b/g,
];
export function normalizeTitle(title) {
  let t = String(title)
    .toLowerCase()
    // Before NFKD, which would turn ™ into the letters "tm".
    .replace(/[™®©]/g, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '');
  for (const re of NOISE) t = t.replace(re, ' ');
  return t.replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---------------------------------------------------------------- taxonomy

// Steam tag name -> Savepoint genre (g), sub-genre (s) and feel tag (t).
export const STEAM_TAGS = {
  Action: { g: 'Action' },
  RPG: { g: 'RPG' },
  Adventure: { g: 'Adventure' },
  Strategy: { g: 'Strategy' },
  Simulation: { g: 'Simulation' },
  Puzzle: { g: 'Puzzle' },
  Platformer: { g: 'Platformer' },
  '2D Platformer': { g: 'Platformer' },
  '3D Platformer': { g: 'Platformer', s: '3D platformer' },
  'Puzzle Platformer': { g: 'Puzzle', s: 'Puzzle platformer' },
  'Precision Platformer': { g: 'Platformer', s: 'Precision platformer' },
  Racing: { g: 'Racing' },
  Sports: { g: 'Sports' },
  Fighting: { g: 'Fighting' },
  'Beat \'em up': { g: 'Action', s: 'Beat \'em up' },
  Shooter: { g: 'Shooter' },
  FPS: { g: 'Shooter', s: 'First-person shooter' },
  'Third-Person Shooter': { g: 'Shooter', s: 'Third-person shooter' },
  'Looter Shooter': { g: 'Shooter', s: 'Looter shooter' },
  'Hero Shooter': { g: 'Shooter', s: 'Hero shooter' },
  'Battle Royale': { g: 'Shooter', s: 'Battle royale' },
  Roguelike: { g: 'Roguelike' },
  Roguelite: { g: 'Roguelike', s: 'Roguelite' },
  'Action Roguelike': { g: 'Roguelike', s: 'Roguelite' },
  'Souls-like': { s: 'Soulslike' },
  Metroidvania: { s: 'Metroidvania' },
  'Open World': { s: 'Open-world' },
  'Action-Adventure': { s: 'Action-adventure' },
  'Hack and Slash': { s: 'Hack and slash' },
  'Character Action Game': { s: 'Hack and slash' },
  Deckbuilding: { s: 'Deckbuilder' },
  'Card Battler': { s: 'Deckbuilder' },
  'Bullet Hell': { s: 'Bullet hell' },
  'Colony Sim': { s: 'Colony sim' },
  'Immersive Sim': { s: 'Immersive sim' },
  CRPG: { g: 'RPG', s: 'CRPG' },
  'Party-Based RPG': { g: 'RPG', s: 'CRPG' },
  JRPG: { g: 'RPG', s: 'JRPG' },
  'Action RPG': { g: 'RPG', s: 'Action RPG' },
  MMORPG: { g: 'RPG', s: 'MMORPG' },
  'Tactical RPG': { g: 'Strategy', s: 'Turn-based tactics' },
  'Turn-Based Tactics': { g: 'Strategy', s: 'Turn-based tactics' },
  'Turn-Based Strategy': { g: 'Strategy', s: 'Turn-based' },
  'Turn-Based Combat': { s: 'Turn-based' },
  RTS: { g: 'Strategy', s: 'Real-time strategy' },
  'City Builder': { g: 'Simulation', s: 'City builder' },
  'Farming Sim': { g: 'Simulation', s: 'Farming sim' },
  'Life Sim': { g: 'Simulation', s: 'Life sim' },
  'Dating Sim': { g: 'Simulation', s: 'Social sim' },
  Management: { s: 'Management' },
  Sandbox: { s: 'Sandbox' },
  Survival: { s: 'Survival' },
  'Survival Horror': { s: 'Survival horror', t: 'horror' },
  Detective: { s: 'Detective' },
  Mystery: { s: 'Mystery' },
  'Visual Novel': { g: 'Adventure', s: 'Narrative adventure' },
  'Interactive Fiction': { g: 'Adventure', s: 'Narrative adventure' },
  'Point & Click': { g: 'Adventure', s: 'Narrative adventure' },
  'Walking Simulator': { g: 'Adventure', s: 'Exploration' },
  Rhythm: { s: 'Rhythm action', t: 'music' },
  'Auto Battler': { g: 'Strategy', s: 'Auto battler' },
  'Tower Defense': { g: 'Strategy', s: 'Tower defense' },
  'Sim Racing': { g: 'Racing', s: 'Sim racing' },
  'Arcade Racing': { s: 'Arcade racing' },
  Mechs: { s: 'Mech combat' },
  Western: { s: 'Western' },
  Difficult: { t: 'hard' },
  'Boss Rush': { t: 'boss-fights' },
  'Story Rich': { t: 'story-rich' },
  'Choices Matter': { t: 'choices-matter' },
  'Co-op': { t: 'co-op' },
  'Online Co-Op': { t: 'co-op' },
  'Local Co-Op': { t: 'couch-co-op' },
  Multiplayer: { t: 'multiplayer' },
  PvP: { t: 'competitive' },
  Competitive: { t: 'competitive' },
  Atmospheric: { t: 'atmospheric' },
  Exploration: { t: 'exploration' },
  'Pixel Graphics': { t: 'pixel-art' },
  'Hand-drawn': { t: 'hand-drawn' },
  Cute: { t: 'cute' },
  Relaxing: { t: 'relaxing' },
  Cozy: { t: 'cozy' },
  Casual: { t: 'casual' },
  Funny: { t: 'comedy' },
  Comedy: { t: 'comedy' },
  'Dark Fantasy': { t: 'dark-fantasy' },
  'Sci-fi': { t: 'sci-fi' },
  Horror: { t: 'horror' },
  Crafting: { t: 'crafting' },
  'Replay Value': { t: 'replayable' },
  Mythology: { t: 'mythology' },
  Anime: { t: 'anime' },
  'Free to Play': { t: 'free-to-play' },
  Stealth: { t: 'stealth' },
  Superhero: { t: 'superhero' },
  Historical: { t: 'historical' },
  Beautiful: { t: 'beautiful' },
  Emotional: { t: 'emotional' },
  'Family Friendly': { t: 'family' },
  Short: { t: 'short' },
  'Time Manipulation': { t: 'time-loop' },
  Magic: { t: 'magic' },
  Robots: { t: 'robots' },
  Parkour: { t: 'traversal' },
};

// Wikidata genre labels are free text ("action role-playing video game"),
// so they're matched by keyword, most specific first.
const WIKIDATA_RULES = [
  [/soulslike|souls-like/, { g: 'Action', s: 'Soulslike', t: 'hard' }],
  [/metroidvania/, { g: 'Platformer', s: 'Metroidvania' }],
  [/roguelite/, { g: 'Roguelike', s: 'Roguelite' }],
  [/roguelike/, { g: 'Roguelike' }],
  [/action role-playing/, { g: 'RPG', s: 'Action RPG' }],
  [/japanese role-playing/, { g: 'RPG', s: 'JRPG' }],
  [/tactical role-playing/, { g: 'Strategy', s: 'Turn-based tactics' }],
  [/massively multiplayer online role-playing|mmorpg/, { g: 'RPG', s: 'MMORPG' }],
  [/role-playing/, { g: 'RPG' }],
  [/action-adventure/, { g: 'Action', s: 'Action-adventure' }],
  [/survival horror/, { g: 'Adventure', s: 'Survival horror', t: 'horror' }],
  [/hack and slash|character action/, { g: 'Action', s: 'Hack and slash' }],
  [/beat 'em up/, { g: 'Action', s: 'Beat \'em up' }],
  [/battle royale/, { g: 'Shooter', s: 'Battle royale' }],
  [/first-person shooter/, { g: 'Shooter', s: 'First-person shooter' }],
  [/third-person shooter/, { g: 'Shooter', s: 'Third-person shooter' }],
  [/shooter|shoot 'em up/, { g: 'Shooter' }],
  [/platform fighter/, { g: 'Fighting', s: 'Platform fighter' }],
  [/fighting/, { g: 'Fighting' }],
  [/3d platform|collect-a-thon/, { g: 'Platformer', s: '3D platformer' }],
  [/platform/, { g: 'Platformer' }],
  [/kart racing/, { g: 'Racing', s: 'Kart racer' }],
  [/sim racing|racing simulat/, { g: 'Racing', s: 'Sim racing' }],
  [/racing/, { g: 'Racing' }],
  [/sports|football|basketball|golf|tennis/, { g: 'Sports' }],
  [/real-time strategy/, { g: 'Strategy', s: 'Real-time strategy' }],
  [/turn-based/, { g: 'Strategy', s: 'Turn-based' }],
  [/strategy/, { g: 'Strategy' }],
  [/life simulation|social simulation/, { g: 'Simulation', s: 'Life sim' }],
  [/farm/, { g: 'Simulation', s: 'Farming sim' }],
  [/simulat/, { g: 'Simulation' }],
  [/puzzle/, { g: 'Puzzle' }],
  [/rhythm|music video game/, { g: 'Action', s: 'Rhythm action', t: 'music' }],
  [/open world/, { s: 'Open-world', t: 'exploration' }],
  [/sandbox/, { s: 'Sandbox' }],
  [/survival/, { s: 'Survival' }],
  [/stealth/, { g: 'Action', t: 'stealth' }],
  [/visual novel|interactive film|point-and-click|graphic adventure|interactive fiction/, { g: 'Adventure', s: 'Narrative adventure' }],
  [/adventure/, { g: 'Adventure' }],
  [/party/, { t: 'party' }],
  [/horror/, { t: 'horror' }],
  [/action/, { g: 'Action' }],
];

/**
 * Mappings carry a weight from 0 to 1: Steam tag votes relative to the game's
 * top tag (Wikidata genres are all 1). Players add plenty of loosely related
 * tags, so sub-genres need a strong share of votes to count.
 */
/** Every genre and sub-genre name the mappings above can produce, for pickers. */
export function genreTaxonomy() {
  const maps = [...Object.values(STEAM_TAGS), ...WIKIDATA_RULES.map(([, m]) => m)];
  const sort = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { genres: sort(maps.map((m) => m.g)), subgenres: sort(maps.map((m) => m.s)) };
}

export function collect(mappings) {
  const sorted = [...mappings].sort((a, b) => b.w - a.w);
  const pick = (key, min, max) => [...new Set(sorted.filter((m) => m[key] && m.w >= min).map((m) => m[key]))].slice(0, max);
  const genres = pick('g', 0.3, 3);
  let subgenres = pick('s', 0.55, 4);
  // Keep the strongest sub-genre even when votes are spread thin.
  if (!subgenres.length) subgenres = pick('s', 0.3, 1);
  return { genres, subgenres, tags: pick('t', 0.4, 8) };
}

// ---------------------------------------------------------------- Steam

let tagNames = null;
export async function steamTagNames() {
  if (tagNames) return tagNames;
  const r = await steamApi('https://api.steampowered.com/IStoreService/GetTagList/v1/?language=english');
  if (!r.ok) throw new Error(`Steam tag list: HTTP ${r.status}`);
  const data = await r.json();
  tagNames = new Map(data.response.tags.map((t) => [t.tagid, t.name]));
  return tagNames;
}

/** Store details for up to 100 Steam apps: tags, type, developer, year, description. */
export async function steamItems(appids) {
  const out = new Map();
  if (!appids.length) return out;
  const names = await steamTagNames();
  for (let i = 0; i < appids.length; i += 100) {
    const input = {
      ids: appids.slice(i, i + 100).map((appid) => ({ appid })),
      context: { language: 'english', country_code: 'US' },
      data_request: { include_tag_count: 20, include_basic_info: true, include_release: true, include_assets: true },
    };
    const r = await steamApi(
      `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`,
    );
    if (!r.ok) continue;
    const data = await r.json();
    for (const item of data.response?.store_items ?? []) {
      if (!item.appid) continue;
      const top = Math.max(1, ...(item.tags ?? []).map((t) => t.weight));
      const mappings = (item.tags ?? [])
        .map((t) => STEAM_TAGS[names.get(t.tagid)] && { ...STEAM_TAGS[names.get(t.tagid)], w: t.weight / top })
        .filter(Boolean);
      const released = item.release?.steam_release_date ?? item.release?.original_release_date;
      out.set(item.appid, {
        type: item.type,
        name: item.name,
        mapped: collect(mappings),
        developer: item.basic_info?.developers?.[0]?.name,
        year: released ? new Date(released * 1000).getUTCFullYear() : undefined,
        blurb: item.basic_info?.short_description,
        imageUrl: steamHeader(item.assets),
        ...steamRelease(item.release),
      });
    }
  }
  return out;
}

/** Header image URL. Newer games keep it under a hashed path the old CDN URL misses. */
function steamHeader(assets) {
  if (!assets?.asset_url_format || !assets.header) return undefined;
  return `https://shared.fastly.steamstatic.com/store_item_assets/${assets.asset_url_format.replace('${FILENAME}', assets.header)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Release date plus how precisely the store announced it, as
 * { releaseDate, releaseLabel, comingSoon }. Labels: "14 Oct 2027",
 * "Oct 2027", "Q4 2027", "2027" or the store's own text ("Coming soon").
 */
export function steamRelease(release) {
  if (!release) return {};
  const ts = release.steam_release_date ?? release.original_release_date;
  const d = ts ? new Date(ts * 1000) : null;
  const upcoming = !!release.is_coming_soon || (d && d.getTime() > Date.now());
  if (!upcoming) return d ? { releaseDate: d.toISOString() } : {};
  let label;
  switch (release.coming_soon_display) {
    case 'text_comingsoon':
      label = release.custom_release_date_message || 'Coming soon';
      break;
    case 'date_year':
      label = d ? String(d.getUTCFullYear()) : 'Coming soon';
      break;
    case 'date_quarter':
      label = d ? `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}` : 'Coming soon';
      break;
    case 'date_month':
      label = d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : 'Coming soon';
      break;
    default:
      label = d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : 'Coming soon';
  }
  return { releaseDate: d?.toISOString(), releaseLabel: label, comingSoon: true };
}

// Steam's full game list, for matching titles and for search. Needs STEAM_API_KEY.
// Cached outside server/ so writing it doesn't trigger the dev server's
// restart-on-change. On Vercel it's a file in the temp dir (about 6 MB, too
// big to be worth keeping in Redis), downloaded again when an instance starts.
const CACHE_FILE = path.join(CACHE_DIR, 'steam-apps-v2.json');
const CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
let appIndex = null;
let appIndexLoading = null;

/** [appid, name] pairs for every game on Steam, from the cache or Steam. */
async function loadAppList() {
  try {
    const info = await stat(CACHE_FILE);
    if (Date.now() - info.mtimeMs < CACHE_MAX_AGE) return JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    // No cache yet.
  }
  const apps = [];
  let lastAppid = 0;
  for (let page = 0; page < 20; page++) {
    const r = await steamApi(
      `https://api.steampowered.com/IStoreService/GetAppList/v1/?key=${process.env.STEAM_API_KEY}` +
        `&max_results=50000&include_games=true&last_appid=${lastAppid}`,
    );
    if (!r.ok) throw new Error(`Steam app list: HTTP ${r.status}`);
    const { response } = await r.json();
    for (const app of response.apps ?? []) apps.push([app.appid, app.name]);
    if (!response.have_more_results) break;
    lastAppid = response.last_appid;
  }
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(apps));
  return apps;
}

/**
 * { byTitle: normalized title -> appid, list: [{ appid, name, norm }] }, or
 * null without a Steam key. Downloaded once (about 15 s), then instant.
 */
export async function steamAppIndex() {
  if (appIndex) return appIndex;
  if (!process.env.STEAM_API_KEY?.trim()) return null;
  appIndexLoading ??= loadAppList()
    .then((apps) => {
      const list = apps.map(([appid, name]) => ({ appid, name, norm: normalizeTitle(name) }));
      // Later app ids win: for shared names that's usually the modern release.
      const byTitle = new Map(list.map((a) => [a.norm, a.appid]));
      return (appIndex = { byTitle, list });
    })
    .finally(() => (appIndexLoading = null));
  return appIndexLoading;
}

/** Without a Steam key: search the store one title at a time (slow, rate-limited). */
async function steamSearch(title) {
  const r = await steamStore(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&cc=US&l=english`,
  );
  if (!r.ok) return undefined;
  const data = await r.json();
  const want = normalizeTitle(title);
  return (data.items ?? []).find((i) => i.type === 'app' && normalizeTitle(i.name) === want)?.id;
}

// ---------------------------------------------------------------- Wikidata

async function wikidataApi(params) {
  const url = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: 'json', ...params })}`;
  const r = await wikidata(url);
  if (!r.ok) throw new Error(`Wikidata: HTTP ${r.status}`);
  return r.json();
}

const VIDEO_GAME = 'Q7889';
const genreLabels = new Map();
const claimIds = (entity, prop) =>
  (entity.claims?.[prop] ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

/** Genre labels for a video game with exactly this title, if Wikidata has one. */
async function wikidataGenres(title) {
  const want = normalizeTitle(title);
  const search = await wikidataApi({
    action: 'wbsearchentities',
    search: title.replace(/[™®©]/g, ''),
    language: 'en',
    type: 'item',
    limit: '7',
  });
  const exact = (search.search ?? []).filter(
    (s) => normalizeTitle(s.label ?? '') === want || normalizeTitle(s.match?.text ?? '') === want,
  );
  if (!exact.length) return undefined;
  const entities = await wikidataApi({ action: 'wbgetentities', ids: exact.map((s) => s.id).join('|'), props: 'claims' });
  const game = exact.map((s) => entities.entities[s.id]).find((e) => claimIds(e, 'P31').includes(VIDEO_GAME));
  const genreIds = game ? claimIds(game, 'P136').slice(0, 20) : [];
  return genreIds.length ? genreNames(genreIds) : undefined;
}

/** Genre names for Wikidata genre ids, fetched 50 at a time and cached. */
async function genreNames(ids) {
  const missing = [...new Set(ids)].filter((id) => !genreLabels.has(id));
  for (let i = 0; i < missing.length; i += 50) {
    const labels = await wikidataApi({
      action: 'wbgetentities',
      ids: missing.slice(i, i + 50).join('|'),
      props: 'labels',
      languages: 'en',
    });
    for (const [id, e] of Object.entries(labels.entities ?? {})) genreLabels.set(id, e.labels?.en?.value ?? '');
  }
  return ids.map((id) => genreLabels.get(id)).filter(Boolean);
}

// Likely English Wikipedia article titles for a game, e.g. "ASTRO BOT" ->
// "Astro Bot", "Astro Bot (video game)".
function articleTitles(title) {
  const clean = title.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
  const roman = /\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii|Xiii|Xiv|Xv|Xvi)\b/g;
  const cased =
    clean === clean.toUpperCase()
      ? clean.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(roman, (r) => r.toUpperCase())
      : clean;
  return [...new Set([clean, cased])].flatMap((t) => [t, `${t} (video game)`]);
}

/**
 * Batch lookup by Wikipedia article title: one request covers about a dozen
 * games, so most console exclusives resolve in a few requests.
 * Returns game id -> genre names for the games it found.
 */
async function wikidataBatch(games) {
  // Wikipedia titles are case-sensitive after the first letter, so ask with the
  // original casing and match the answers case-insensitively.
  const candidates = games.flatMap((g) => articleTitles(g.title).map((t) => [t, g.id]));
  const byTitle = new Map(candidates.map(([t, id]) => [t.toLowerCase(), id]));
  const genreIdsFor = new Map();
  for (let i = 0; i < candidates.length; i += 50) {
    const data = await wikidataApi({
      action: 'wbgetentities',
      sites: 'enwiki',
      titles: candidates.slice(i, i + 50).map(([t]) => t).join('|'),
      props: 'claims|sitelinks',
      sitefilter: 'enwiki',
    });
    for (const e of Object.values(data.entities ?? {})) {
      const id = byTitle.get(e.sitelinks?.enwiki?.title?.toLowerCase());
      if (!id || genreIdsFor.has(id) || !claimIds(e, 'P31').includes(VIDEO_GAME)) continue;
      const genres = claimIds(e, 'P136').slice(0, 20);
      if (genres.length) genreIdsFor.set(id, genres);
    }
  }
  await genreNames([...genreIdsFor.values()].flat());
  return new Map([...genreIdsFor].map(([id, genreIds]) => [id, genreIds.map((g) => genreLabels.get(g)).filter(Boolean)]));
}

function mapWikidata(labels) {
  const mappings = [];
  for (const label of labels) {
    const l = label.toLowerCase();
    const rule = WIKIDATA_RULES.find(([re]) => re.test(l));
    if (rule) mappings.push({ ...rule[1], w: 1 });
  }
  return collect(mappings);
}

// ---------------------------------------------------------------- entry points

// One lookup at a time, so two open tabs don't double the load on Steam and
// Wikidata.
let queue = Promise.resolve();
const exclusive = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

/**
 * Steam pass.
 * @param {{ id: string, title: string, steamAppId?: number }[]} games
 * @returns {{ results: Record<string, object>, retryAfter?: number }}
 *   Only games found on Steam with usable tags are in `results`; the rest are
 *   for the Wikidata pass.
 */
export function lookupSteam(games, budgetMs = 20000) {
  return exclusive(async () => {
    const deadline = Date.now() + budgetMs;
    const index = await steamAppIndex();
    const appids = new Map();
    let retryAfter;
    for (const g of games) {
      if (g.steamAppId) appids.set(g.id, g.steamAppId);
      else if (index) {
        const appid = index.byTitle.get(normalizeTitle(g.title));
        if (appid) appids.set(g.id, appid);
      } else if (Date.now() < deadline && !retryAfter) {
        try {
          const appid = await steamSearch(g.title);
          if (appid) appids.set(g.id, appid);
        } catch (err) {
          if (err instanceof RateLimited) retryAfter = err.retryAfter;
        }
      }
    }
    const details = await steamItems([...new Set(appids.values())]);
    const results = {};
    for (const g of games) {
      const appid = appids.get(g.id);
      const d = appid && details.get(appid);
      if (d && d.mapped.genres.length + d.mapped.subgenres.length > 0) {
        results[g.id] = { ...d.mapped, source: 'steam', steamAppId: appid, developer: d.developer, year: d.year, blurb: d.blurb };
      }
    }
    return { results, retryAfter };
  });
}

/**
 * Wikidata pass for games Steam didn't cover: one batched lookup by Wikipedia
 * article title (about a dozen games per request). Games it doesn't find come
 * back as source 'none' so they don't stay pending; their page offers to add
 * genres by hand or look them up again.
 * @returns {{ results: Record<string, object>, retryAfter?: number }}
 */
export function lookupWikidata(games) {
  return exclusive(async () => {
    let batch;
    try {
      batch = await wikidataBatch(games);
    } catch (err) {
      if (err instanceof RateLimited) return { results: {}, retryAfter: err.retryAfter };
      throw err;
    }
    const results = {};
    for (const g of games) {
      const mapped = batch.has(g.id) ? mapWikidata(batch.get(g.id)) : null;
      results[g.id] =
        mapped && mapped.genres.length + mapped.subgenres.length > 0
          ? { ...mapped, source: 'wikidata' }
          : { genres: [], subgenres: [], tags: [], source: 'none' };
    }
    return { results };
  });
}

/** Single game (its page is open): the slower title search, as a last try. */
export function lookupWikidataOne(game) {
  return exclusive(async () => {
    try {
      const labels = (await wikidataBatch([game])).get(game.id) ?? (await wikidataGenres(game.title));
      const mapped = labels ? mapWikidata(labels) : null;
      return {
        results: {
          [game.id]:
            mapped && mapped.genres.length + mapped.subgenres.length > 0
              ? { ...mapped, source: 'wikidata' }
              : { genres: [], subgenres: [], tags: [], source: 'none' },
        },
      };
    } catch (err) {
      if (err instanceof RateLimited) return { results: {}, retryAfter: err.retryAfter };
      throw err;
    }
  });
}
