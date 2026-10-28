import { diskCache } from './diskCache.mjs';
import { collect, normalizeTitle } from './genres.mjs';

// IGDB (Twitch's game database): genres, release dates, summaries and
// screenshots for every platform. Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.
// IGDB allows 4 requests a second.

const FIELDS =
  'name,alternative_names.name,first_release_date,summary,genres.name,themes.name,game_modes.name,' +
  'cover.image_id,artworks.image_id,screenshots.image_id,involved_companies.developer,' +
  'involved_companies.company.name,external_games.external_game_source,external_games.uid,game_type,version_parent,' +
  'platforms.name';
const cache = diskCache('igdb', 30 * 24 * 3600 * 1000);
let auth = null;
let next = 0;

export const igdbConfigured = () =>
  Boolean(process.env.TWITCH_CLIENT_ID?.trim() && process.env.TWITCH_CLIENT_SECRET?.trim());

async function token() {
  if (auth && auth.expiresAt > Date.now() + 60_000) return auth.token;
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID.trim()}` +
      `&client_secret=${process.env.TWITCH_CLIENT_SECRET.trim()}&grant_type=client_credentials`,
    { method: 'POST', signal: AbortSignal.timeout(10000) },
  );
  if (!r.ok) throw new Error(`Twitch sign-in: HTTP ${r.status}`);
  const j = await r.json();
  auth = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return auth.token;
}

async function query(endpoint, body, attempt = 0) {
  const wait = next - Date.now();
  next = Math.max(Date.now(), next) + 260;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  let r;
  try {
    r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID.trim(), Authorization: `Bearer ${await token()}` },
      body,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    // IGDB sometimes drops reused connections (ECONNRESET); a quick retry gets through.
    if (attempt < 3) {
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
      return query(endpoint, body, attempt + 1);
    }
    throw err;
  }
  if (r.status === 401) auth = null;
  if (!r.ok) throw new Error(`IGDB: HTTP ${r.status}`);
  return r.json();
}

// IGDB genre, theme and mode names -> Savepoint genre (g), sub-genre (s), tag (t).
const IGDB_MAP = {
  'Role-playing (RPG)': { g: 'RPG' },
  Strategy: { g: 'Strategy' },
  'Turn-based strategy (TBS)': { g: 'Strategy', s: 'Turn-based' },
  'Real Time Strategy (RTS)': { g: 'Strategy', s: 'Real-time strategy' },
  Adventure: { g: 'Adventure' },
  Shooter: { g: 'Shooter' },
  Platform: { g: 'Platformer' },
  Puzzle: { g: 'Puzzle' },
  Racing: { g: 'Racing' },
  Sport: { g: 'Sports' },
  Fighting: { g: 'Fighting' },
  Simulator: { g: 'Simulation' },
  "Hack and slash/Beat 'em up": { g: 'Action', s: 'Hack and slash' },
  Arcade: { g: 'Action' },
  'Visual Novel': { g: 'Adventure', s: 'Narrative adventure' },
  'Point-and-click': { g: 'Adventure', s: 'Narrative adventure' },
  'Card & Board Game': { t: 'tabletop' },
  Music: { s: 'Rhythm action', t: 'music' },
  MOBA: { g: 'Strategy' },
  Action: { g: 'Action' },
  'Open world': { s: 'Open-world', t: 'exploration' },
  Survival: { s: 'Survival' },
  Sandbox: { s: 'Sandbox' },
  Mystery: { s: 'Mystery' },
  '4X (explore, expand, exploit, and exterminate)': { g: 'Strategy' },
  Horror: { t: 'horror' },
  'Science fiction': { t: 'sci-fi' },
  Stealth: { t: 'stealth' },
  Comedy: { t: 'comedy' },
  Historical: { t: 'historical' },
  Party: { t: 'party' },
  'Co-operative': { t: 'co-op' },
  Multiplayer: { t: 'multiplayer' },
};

function mapGenres(g) {
  const names = [...(g.genres ?? []), ...(g.themes ?? []), ...(g.game_modes ?? [])].map((x) => x.name);
  const rpg = names.includes('Role-playing (RPG)');
  // "Tactical" means tactics in RPGs and strategy games, but squads in shooters.
  const tactics = names.includes('Tactical') && (rpg || names.includes('Turn-based strategy (TBS)'));
  const mappings = names
    .map((n) => {
      const m = IGDB_MAP[n];
      // On RPGs IGDB's strategy labels describe the combat system (Pokémon is
      // "turn-based strategy", Xenoblade "real-time strategy"), not the genre.
      if (m && rpg && !tactics) {
        if (n === 'Real Time Strategy (RTS)' || n === 'MOBA' || n === 'Strategy') return null;
        if (n === 'Turn-based strategy (TBS)') return { s: 'Turn-based' };
      }
      return m;
    })
    .filter(Boolean)
    .map((m) => ({ ...m, w: 1 }));
  if (tactics) mappings.push({ g: 'Strategy', s: 'Turn-based tactics', w: 1 });
  return collect(mappings);
}

const image = (id, size) => (id ? `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg` : undefined);

function toInfo(g) {
  const dev = g.involved_companies?.find((c) => c.developer)?.company?.name;
  const landscape = g.artworks?.[0]?.image_id ?? g.screenshots?.[0]?.image_id;
  return {
    igdbId: g.id,
    title: g.name,
    summary: g.summary,
    developer: dev,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : undefined,
    releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString() : undefined,
    imageUrl: image(landscape, 't_screenshot_big'),
    screenshots: (g.screenshots ?? []).slice(0, 10).map((s) => ({
      thumb: image(s.image_id, 't_screenshot_med'),
      full: image(s.image_id, 't_1080p'),
    })),
    steamAppId: Number(g.external_games?.find((e) => e.external_game_source === 1)?.uid) || undefined,
    availableOn: digitalPlatforms(g.platforms),
    ...mapGenres(g),
  };
}

/** Savepoint's digital platforms a game is on, from IGDB platform names. */
function digitalPlatforms(platforms = []) {
  const out = new Set();
  for (const { name = '' } of platforms) {
    if (/^PC \(Microsoft Windows\)$/i.test(name)) out.add('steam');
    else if (/^PlayStation [45]$/i.test(name)) out.add('playstation');
    else if (/^Xbox (One|Series)/i.test(name)) out.add('xbox');
    else if (/^Nintendo Switch/i.test(name)) out.add('switch');
  }
  return [...out];
}

/** Everything IGDB knows about one game by its IGDB id (Twitch categories carry it). Cached. */
export async function igdbGameById(id) {
  if (!igdbConfigured() || !Number.isInteger(Number(id)) || Number(id) <= 0) return null;
  const key = `id:${id}`;
  const cached = await cache.get(key);
  if (cached !== undefined) return cached;
  const found = (await query('games', `fields ${FIELDS}; where id = ${Number(id)};`))[0] ?? null;
  const info = found ? toInfo(found) : null;
  await cache.set(key, info);
  return info;
}

/** An app token for Twitch's own API (Helix), shared with IGDB. */
export const twitchAppToken = () => token();

/** Main games, remakes, remasters, expanded games and ports: no DLC, bundles, mods or updates. */
const MAIN = 'game_type = (0,8,9,10,11) & version_parent = null';

function pickBest(list, title) {
  const key = normalizeTitle(title);
  return (
    list.find((g) => normalizeTitle(g.name) === key) ??
    list.find((g) => g.alternative_names?.some((a) => normalizeTitle(a.name) === key)) ??
    null
  );
}

/** Everything IGDB knows about one game, by Steam app id when given, else by title. Cached. */
export async function igdbGame({ title, steamAppId }) {
  if (!igdbConfigured()) return null;
  const key = steamAppId ? `steam:${steamAppId}` : `t:${normalizeTitle(title)}`;
  const cached = await cache.get(key);
  if (cached !== undefined) return cached;
  let found = null;
  if (steamAppId) {
    const ext = await query('external_games', `fields game; where external_game_source = 1 & uid = "${steamAppId}"; limit 1;`);
    if (ext[0]?.game) found = (await query('games', `fields ${FIELDS}; where id = ${ext[0].game};`))[0] ?? null;
  }
  if (!found && title) {
    const safe = title.replace(/[™®©]/g, '').replace(/["\\]/g, ' ').trim();
    // Exact name first (case-insensitive): search ranks fan mods and remixes
    // above the real game, e.g. "Super Mario Odyssey 64" before Super Mario Odyssey.
    // An exact name may also be a bundle (Spyro Reignited Trilogy is three remakes in one).
    const exact = await query(
      'games',
      `fields ${FIELDS}; where name ~ "${safe}" & game_type = (0,3,8,9,10,11) & version_parent = null; limit 5;`,
    );
    found =
      exact.find((g) => g.game_type === 0) ??
      exact[0] ??
      pickBest(await query('games', `search "${safe}"; fields ${FIELDS}; where ${MAIN}; limit 20;`), title);
  }
  const info = found ? toInfo(found) : null;
  await cache.set(key, info);
  return info;
}

/** Genre results for the /api/genres "igdb" pass, in the same shape as the others. */
export async function lookupIgdb(games) {
  const results = {};
  for (const g of games) {
    try {
      const info = await igdbGame(g);
      if (info && info.genres.length + info.subgenres.length > 0) {
        results[g.id] = { genres: info.genres, subgenres: info.subgenres, tags: info.tags, source: 'igdb' };
      }
    } catch {
      // Left out: the Wikidata pass gets a turn.
    }
  }
  return { results };
}

// ---------------------------------------------------------------- search (older platforms)

/** IGDB platform names -> Savepoint physical platforms. Checked in order. */
const PHYSICAL_BY_NAME = [
  [/^PlayStation 5$/i, 'PS5'],
  [/^PlayStation 4$/i, 'PS4'],
  [/^PlayStation 3$/i, 'PS3'],
  [/^PlayStation 2$/i, 'PS2'],
  [/^PlayStation$/i, 'PS1'],
  [/^PlayStation Vita$/i, 'PS Vita'],
  [/^PlayStation Portable$/i, 'PSP'],
  [/^Xbox Series/i, 'Xbox Series X|S'],
  [/^Xbox One$/i, 'Xbox One'],
  [/^Xbox 360$/i, 'Xbox 360'],
  [/^Xbox$/i, 'Xbox'],
  [/^Nintendo Switch 2$/i, 'Switch 2'],
  [/^Nintendo Switch$/i, 'Switch'],
  [/^Wii U$/i, 'Wii U'],
  [/^Wii$/i, 'Wii'],
  [/GameCube/i, 'GameCube'],
  [/^Nintendo 64$/i, 'N64'],
  [/^Super Nintendo/i, 'SNES'],
  [/^Nintendo Entertainment System/i, 'NES'],
  [/3DS$/i, '3DS'],
  [/^Nintendo DS$/i, 'DS'],
  [/^Game Boy Advance$/i, 'Game Boy Advance'],
  [/^Game Boy Color$/i, 'Game Boy Color'],
  [/^Game Boy$/i, 'Game Boy'],
  [/Mega Drive|Genesis/i, 'Mega Drive'],
  [/Saturn/i, 'Saturn'],
  [/Dreamcast/i, 'Dreamcast'],
  [/Master System/i, 'Master System'],
  [/Game Gear/i, 'Game Gear'],
  [/^PC \(Microsoft Windows\)$|^DOS$/i, 'PC'],
];

/** Digital platform ids Savepoint knows, for the platform icons. */
const DIGITAL_BY_PHYSICAL = { PS5: 'playstation', PS4: 'playstation', 'Xbox Series X|S': 'xbox', 'Xbox One': 'xbox', Switch: 'switch', 'Switch 2': 'switch' };

function physicalPlatforms(platforms = []) {
  const out = [];
  for (const p of platforms) {
    const hit = PHYSICAL_BY_NAME.find(([re]) => re.test(p.name ?? ''));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
  }
  return out;
}

const SEARCH_FIELDS =
  'name,first_release_date,platforms.name,genres.name,themes.name,game_modes.name,cover.image_id,' +
  'artworks.image_id,screenshots.image_id,involved_companies.developer,involved_companies.company.name';
const searchCache = new Map();

/**
 * Games on every platform IGDB knows, old consoles included, in the same shape
 * as store search results plus `physicalPlatforms` (e.g. ['SNES', 'Wii']).
 * Results are kept for a day.
 */
export async function igdbSearch(text) {
  if (!igdbConfigured()) return [];
  const key = text.trim().toLowerCase();
  const hit = searchCache.get(key);
  if (hit && hit.at > Date.now() - 24 * 3600 * 1000) return hit.results;
  const safe = text.replace(/[™®©]/g, '').replace(/["\\]/g, ' ').trim();
  const list = await query('games', `search "${safe}"; fields ${SEARCH_FIELDS}; where ${MAIN}; limit 30;`);
  const results = list
    .map((g) => {
      const platforms = physicalPlatforms(g.platforms);
      const dev = g.involved_companies?.find((c) => c.developer)?.company?.name;
      const landscape = g.artworks?.[0]?.image_id ?? g.screenshots?.[0]?.image_id;
      const released = g.first_release_date ? new Date(g.first_release_date * 1000) : null;
      const upcoming = released && released.getTime() > Date.now();
      return {
        title: g.name.replace(/[™®©]/g, '').trim(),
        igdbId: g.id,
        availableOn: [...new Set(platforms.map((p) => DIGITAL_BY_PHYSICAL[p]).filter(Boolean))],
        physicalPlatforms: platforms,
        imageUrl: image(landscape, 't_screenshot_med'),
        developer: dev,
        year: released && !upcoming ? released.getUTCFullYear() : undefined,
        releaseDate: released?.toISOString(),
        ...mapGenres(g),
      };
    })
    // Only games released on something you could own a copy of.
    .filter((g) => g.physicalPlatforms.length);
  searchCache.set(key, { at: Date.now(), results });
  return results;
}
