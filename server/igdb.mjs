import { diskCache } from './diskCache.mjs';
import { collect, normalizeTitle } from './genres.mjs';

// IGDB (Twitch's game database): genres, release dates, summaries and
// screenshots for every platform. Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.
// IGDB allows 4 requests a second.

const FIELDS =
  'name,alternative_names.name,first_release_date,summary,genres.name,themes.name,game_modes.name,' +
  'cover.image_id,artworks.image_id,screenshots.image_id,involved_companies.developer,' +
  'involved_companies.company.name,external_games.external_game_source,external_games.uid,game_type,version_parent';
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
    ...mapGenres(g),
  };
}

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
