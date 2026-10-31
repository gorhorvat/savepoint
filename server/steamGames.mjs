// Stats tabs for games played through the account's linked Steam, so there's
// nothing to type in: Counter-Strike 2 and Dota 2.
//
// Counter-Strike 2: lifetime numbers (kills, weapons, maps, last match) and
// play time from the Steam Web API (STEAM_API_KEY; the Steam profile's Game
// details must be public). Valve keeps these as they were in CS:GO and hasn't
// kept every one up to date since CS2, and shares no Premier rating, so when
// the player uses Leetify (leetify.com) its free public API adds the Premier,
// FACEIT and Wingman ranks, Leetify's skill ratings and recent matches.
// LEETIFY_API_KEY is optional; without it Leetify only allows fewer requests.
//
// Dota 2: rank medal, wins and losses, heroes, lifetime totals and recent
// matches from OpenDota's free API (no key). The player needs "Expose Public
// Match Data" on in Dota 2's settings for matches to show.
//
//   POST   /api/games/:game/connect   reads the linked Steam account's stats  -> connection
//   POST   /api/games/:game/refresh   reads them again (at most every few minutes)
//   DELETE /api/games/:game
// with :game cs2 or dota2.
import express from 'express';
import { query } from './db.mjs';
import { saveSnapshot } from './snapshots.mjs';

const REFRESH_MS = 5 * 60_000;
const STEAM64_BASE = 76561197960265728n;

export class SteamGameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function getJson(url, { headers, notFound } = {}) {
  let r;
  try {
    r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new SteamGameError("Couldn't reach the stats service. Try again in a moment.", 502);
  }
  if (r.status === 404 && notFound !== undefined) return notFound;
  if (r.status === 429) throw new SteamGameError('The stats service is busy. Try again in a minute.', 503);
  if (!r.ok) return { __status: r.status };
  return r.json();
}

// ---------------------------------------------------------------- Counter-Strike 2

const WEAPONS = {
  ak47: 'AK-47',
  m4a1: 'M4A4 / M4A1-S',
  awp: 'AWP',
  deagle: 'Desert Eagle',
  glock: 'Glock-18',
  hkp2000: 'P2000 / USP-S',
  p250: 'P250',
  fiveseven: 'Five-SeveN',
  tec9: 'Tec-9',
  elite: 'Dual Berettas',
  aug: 'AUG',
  sg556: 'SG 553',
  famas: 'FAMAS',
  galilar: 'Galil AR',
  ssg08: 'SSG 08',
  scar20: 'SCAR-20',
  g3sg1: 'G3SG1',
  mac10: 'MAC-10',
  mp9: 'MP9',
  mp7: 'MP7',
  ump45: 'UMP-45',
  p90: 'P90',
  bizon: 'PP-Bizon',
  nova: 'Nova',
  xm1014: 'XM1014',
  mag7: 'MAG-7',
  sawedoff: 'Sawed-Off',
  m249: 'M249',
  negev: 'Negev',
  knife: 'Knife',
  hegrenade: 'HE Grenade',
  molotov: 'Molotov',
  taser: 'Zeus x27',
};

const MAP_NAMES = { dust2: 'Dust II', cbble: 'Cobblestone', stmarc: 'St. Marc', shorttrain: 'Short Train' };

function mapName(key) {
  const bare = key.replace(/^(de|cs|ar|gd)_/, '');
  return MAP_NAMES[bare] ?? bare.charAt(0).toUpperCase() + bare.slice(1);
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
/** Leetify sends some numbers as fractions (0.52) and some as percentages (52). */
const asPercent = (v) =>
  typeof v !== 'number' ? null : Math.abs(v) <= 1 ? Math.round(v * 1000) / 10 : Math.round(v * 10) / 10;
/** Leetify ratings are fractions shown ×100 (0.0235 is +2.35). */
const asRating = (v) => (typeof v !== 'number' ? null : Math.round((Math.abs(v) < 1 ? v * 100 : v) * 100) / 100);

async function steamStats(steamId, appid) {
  const key = process.env.STEAM_API_KEY?.trim();
  if (!key) throw new SteamGameError('Steam isn’t set up on this server (STEAM_API_KEY).', 503);
  const data = await getJson(
    `https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/?appid=${appid}&key=${key}&steamid=${steamId}`,
  );
  // Steam answers 403 or 500 for a private profile or a game never played.
  if (data.__status) return null;
  return Object.fromEntries((data.playerstats?.stats ?? []).map((s) => [s.name, Number(s.value) || 0]));
}

async function playtime(steamId, appid) {
  const key = process.env.STEAM_API_KEY?.trim();
  const data = await getJson(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_played_free_games=1&appids_filter%5B0%5D=${appid}`,
  );
  const g = data.response?.games?.[0];
  return g ? { minutes: g.playtime_forever ?? 0, twoWeeks: g.playtime_2weeks ?? 0 } : null;
}

async function leetifyProfile(steamId) {
  const key = process.env.LEETIFY_API_KEY?.trim();
  const p = await getJson(`https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${steamId}`, {
    headers: key ? { _leetify_key: key } : undefined,
    notFound: null,
  }).catch(() => null);
  if (!p || p.__status) return null;
  const ranks = p.ranks ?? {};
  return {
    name: p.name ?? null,
    winrate: asPercent(p.winrate),
    matches: p.total_matches ?? null,
    since: p.first_match_date ?? null,
    premier: ranks.premier ?? null,
    faceit: ranks.faceit ?? null,
    faceitElo: ranks.faceit_elo ?? null,
    wingman: ranks.wingman ?? null,
    renown: ranks.renown ?? null,
    leetify: asRating(ranks.leetify),
    competitive: (ranks.competitive ?? [])
      .filter((c) => c.rank > 0)
      .map((c) => ({ map: mapName(c.map_name ?? ''), rank: c.rank })),
    ratings: p.rating
      ? {
          aim: p.rating.aim ?? null,
          positioning: p.rating.positioning ?? null,
          utility: p.rating.utility ?? null,
          clutch: asPercent(p.rating.clutch),
          opening: asPercent(p.rating.opening),
          ct: asRating(p.rating.ct_leetify),
          t: asRating(p.rating.t_leetify),
        }
      : null,
    aim: p.stats
      ? {
          headshot: asPercent(p.stats.accuracy_head),
          spotted: asPercent(p.stats.accuracy_enemy_spotted),
          spray: asPercent(p.stats.spray_accuracy),
          preaim: typeof p.stats.preaim === 'number' ? Math.round(p.stats.preaim * 10) / 10 : null,
          reaction: typeof p.stats.reaction_time_ms === 'number' ? Math.round(p.stats.reaction_time_ms) : null,
          counterStrafe: asPercent(p.stats.counter_strafing_good_shots_ratio),
        }
      : null,
    recent: (p.recent_matches ?? []).slice(0, 15).map((m) => ({
      id: m.id,
      at: m.finished_at,
      source: m.data_source,
      outcome: m.outcome,
      map: mapName(m.map_name ?? ''),
      score: Array.isArray(m.score) ? m.score : null,
      rating: asRating(m.leetify_rating),
      rank: m.rank || null,
      rankType: m.rank_type ?? null,
    })),
    url: `https://leetify.com/app/profile/${steamId}`,
  };
}

export async function readCs2(steamId) {
  const [s, time, leetify] = await Promise.all([
    steamStats(steamId, 730),
    playtime(steamId, 730).catch(() => null),
    leetifyProfile(steamId),
  ]);
  if (!s && !time && !leetify) {
    throw new SteamGameError(
      'Steam shares no Counter-Strike 2 stats for this account. Make Game details public in your Steam privacy settings, then try again.',
      404,
    );
  }
  const v = (k) => s?.[k] ?? 0;
  const weapons = s
    ? Object.entries(WEAPONS)
        .map(([key, name]) => ({
          key,
          name,
          kills: v(`total_kills_${key}`),
          accuracy: pct(v(`total_hits_${key}`), v(`total_shots_${key}`)),
        }))
        .filter((w) => w.kills > 0)
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 12)
    : [];
  const maps = s
    ? Object.keys(s)
        .map((k) => /^total_rounds_map_(.+)$/.exec(k)?.[1])
        .filter(Boolean)
        .map((key) => ({
          key,
          name: mapName(key),
          rounds: v(`total_rounds_map_${key}`),
          wins: v(`total_wins_map_${key}`),
        }))
        .filter((m) => m.rounds > 0)
        .sort((a, b) => b.rounds - a.rounds)
        .slice(0, 10)
    : [];
  return {
    steamId,
    hours: time ? Math.round(time.minutes / 6) / 10 : null,
    hoursTwoWeeks: time ? Math.round(time.twoWeeks / 6) / 10 : null,
    lifetime: s
      ? {
          kills: v('total_kills'),
          deaths: v('total_deaths'),
          kd: v('total_deaths') ? Math.round((v('total_kills') / v('total_deaths')) * 100) / 100 : null,
          headshots: pct(v('total_kills_headshot'), v('total_kills')),
          accuracy: pct(v('total_shots_hit'), v('total_shots_fired')),
          roundsWon: v('total_wins'),
          rounds: v('total_rounds_played'),
          matchesWon: v('total_matches_won'),
          matches: v('total_matches_played'),
          mvps: v('total_mvps'),
          damage: v('total_damage_done'),
          money: v('total_money_earned'),
          planted: v('total_planted_bombs'),
          defused: v('total_defused_bombs'),
          hostages: v('total_rescued_hostages'),
          knifeKills: v('total_kills_knife'),
          enemyWeaponKills: v('total_kills_enemy_weapon'),
          blinded: v('total_kills_enemy_blinded'),
          zoomedSnipers: v('total_kills_against_zoomed_sniper'),
          dominations: v('total_dominations'),
          revenges: v('total_revenges'),
          timePlayed: v('total_time_played') ? Math.round(v('total_time_played') / 360) / 10 : null,
        }
      : null,
    weapons,
    maps,
    lastMatch:
      s && v('last_match_rounds')
        ? {
            kills: v('last_match_kills'),
            deaths: v('last_match_deaths'),
            mvps: v('last_match_mvps'),
            damage: v('last_match_damage'),
            roundsWon: v('last_match_wins'),
            rounds: v('last_match_rounds'),
            money: v('last_match_money_spent'),
          }
        : null,
    leetify,
  };
}

const cs2Snapshot = (d) => ({
  premier: d.leetify?.premier ?? null,
  faceitElo: d.leetify?.faceitElo ?? null,
  leetify: d.leetify?.leetify ?? null,
  hours: d.hours,
  kills: d.lifetime?.kills ?? null,
  kd: d.lifetime?.kd ?? null,
});

// ---------------------------------------------------------------- Dota 2

const OPENDOTA = 'https://api.opendota.com/api';
let heroes = { at: 0, byId: new Map() };

async function heroList() {
  if (heroes.byId.size && Date.now() - heroes.at < 24 * 3600_000) return heroes.byId;
  const data = await getJson(`${OPENDOTA}/constants/heroes`);
  if (data && !data.__status) {
    heroes = {
      at: Date.now(),
      byId: new Map(
        Object.values(data).map((h) => [
          h.id,
          {
            name: h.localized_name,
            image: h.img ? `https://cdn.cloudflare.steamstatic.com${h.img.replace(/\?$/, '')}` : null,
          },
        ]),
      ),
    };
  }
  return heroes.byId;
}

const MEDALS = ['', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'];
const GAME_MODES = {
  1: 'All Pick',
  2: 'Captains Mode',
  3: 'Random Draft',
  4: 'Single Draft',
  5: 'All Random',
  12: 'Least Played',
  16: 'Captains Draft',
  18: 'Ability Draft',
  19: 'Event',
  20: 'All Random Deathmatch',
  21: '1v1 Mid',
  22: 'All Pick',
  23: 'Turbo',
  24: 'Mutation',
};

function medal(rankTier, leaderboard) {
  if (!rankTier) return null;
  const m = Math.floor(rankTier / 10);
  const stars = rankTier % 10;
  return {
    tier: rankTier,
    name: MEDALS[m] ?? null,
    stars: m === 8 ? null : stars || null,
    leaderboard: leaderboard ?? null,
  };
}

export async function readDota(steamId) {
  const accountId = String(BigInt(steamId) - STEAM64_BASE);
  const [player, wl, heroStats, recent, totals, byId] = await Promise.all([
    getJson(`${OPENDOTA}/players/${accountId}`),
    getJson(`${OPENDOTA}/players/${accountId}/wl`),
    getJson(`${OPENDOTA}/players/${accountId}/heroes`),
    getJson(`${OPENDOTA}/players/${accountId}/recentMatches`),
    getJson(`${OPENDOTA}/players/${accountId}/totals`),
    heroList(),
  ]);
  if (player.__status || !player.profile) {
    throw new SteamGameError(
      'OpenDota has no Dota 2 profile for this Steam account yet. Play a match with "Expose Public Match Data" on in Dota 2’s settings, then try again.',
      404,
    );
  }
  const hero = (id) => byId.get(Number(id)) ?? { name: `Hero ${id}`, image: null };
  const total = (field) => (Array.isArray(totals) ? totals.find((t) => t.field === field) : null);
  const avg = (field) => {
    const t = total(field);
    return t?.n ? Math.round((t.sum / t.n) * 10) / 10 : null;
  };
  const sum = (field) => total(field)?.sum ?? null;
  const wins = wl.win ?? 0;
  const losses = wl.lose ?? 0;
  return {
    steamId,
    accountId,
    name: player.profile.personaname ?? null,
    avatar: player.profile.avatarfull ?? null,
    plus: !!player.profile.plus,
    medal: medal(player.rank_tier, player.leaderboard_rank),
    wins,
    losses,
    winRate: pct(wins, wins + losses),
    heroes: Array.isArray(heroStats)
      ? heroStats
          .filter((h) => h.games > 0)
          .slice(0, 12)
          .map((h) => ({
            id: Number(h.hero_id),
            ...hero(h.hero_id),
            games: h.games,
            wins: h.win,
            winRate: pct(h.win, h.games),
            lastPlayed: h.last_played ? new Date(h.last_played * 1000).toISOString() : null,
          }))
      : [],
    totals: {
      kills: sum('kills'),
      deaths: sum('deaths'),
      assists: sum('assists'),
      kda: avg('kda'),
      gpm: avg('gold_per_min'),
      xpm: avg('xp_per_min'),
      lastHits: avg('last_hits'),
      denies: avg('denies'),
      heroDamage: avg('hero_damage'),
      towerDamage: avg('tower_damage'),
      healing: avg('hero_healing'),
      hours: sum('duration') ? Math.round(sum('duration') / 360) / 10 : null,
    },
    recent: Array.isArray(recent)
      ? recent.slice(0, 20).map((m) => ({
          id: String(m.match_id),
          at: new Date(m.start_time * 1000).toISOString(),
          hero: { id: m.hero_id, ...hero(m.hero_id) },
          won: m.radiant_win === m.player_slot < 128,
          kills: m.kills,
          deaths: m.deaths,
          assists: m.assists,
          minutes: Math.round(m.duration / 60),
          mode: GAME_MODES[m.game_mode] ?? 'Match',
          ranked: m.lobby_type === 7,
          gpm: m.gold_per_min ?? null,
          xpm: m.xp_per_min ?? null,
          lastHits: m.last_hits ?? null,
          heroDamage: m.hero_damage ?? null,
        }))
      : [],
    url: `https://www.opendota.com/players/${accountId}`,
  };
}

const dotaSnapshot = (d) => ({
  rankTier: d.medal?.tier ?? null,
  wins: d.wins,
  losses: d.losses,
  winRate: d.winRate,
});

// ---------------------------------------------------------------- routes

const GAMES = {
  cs2: { read: readCs2, snapshot: cs2Snapshot, name: (d) => d.leetify?.name ?? null },
  dota2: { read: readDota, snapshot: dotaSnapshot, name: (d) => d.name },
};

const row = (r) => ({ game: r.game, externalId: r.external_id, name: r.name, data: r.data, fetchedAt: r.fetched_at });

async function linkedSteam(userId) {
  const { rows } = await query('SELECT "steam_id" FROM users WHERE "id" = $1', [userId]);
  const id = rows[0]?.steam_id;
  if (!id) throw new SteamGameError('Connect Steam in Settings, Platforms first: these stats come from it.', 409);
  return id;
}

async function readAndSave(userId, game) {
  const steamId = await linkedSteam(userId);
  const g = GAMES[game];
  const data = await g.read(steamId);
  const { rows } = await query(
    `INSERT INTO game_connections ("user_id", "game", "external_id", "name", "data", "fetched_at")
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT ("user_id", "game") DO UPDATE SET "external_id" = EXCLUDED."external_id",
       "name" = EXCLUDED."name", "data" = EXCLUDED."data", "fetched_at" = now()
     RETURNING "game", "external_id", "name", "data", "fetched_at"`,
    [userId, game, steamId, g.name(data), JSON.stringify(data)],
  );
  await saveSnapshot(userId, game, g.snapshot(data));
  return row(rows[0]);
}

function failed(res, err, what) {
  if (err instanceof SteamGameError) return res.status(err.status).json({ error: err.message });
  console.error(what, err);
  res.status(502).json({ error: "Couldn't read the stats. Try again in a moment." });
}

export const steamGamesRouter = express.Router();

steamGamesRouter.post('/api/games/:game/connect', async (req, res, next) => {
  if (!GAMES[req.params.game]) return next();
  try {
    res.json(await readAndSave(req.userId, req.params.game));
  } catch (err) {
    failed(res, err, `${req.params.game} connect:`);
  }
});

steamGamesRouter.post('/api/games/:game/refresh', async (req, res, next) => {
  const game = req.params.game;
  if (!GAMES[game]) return next();
  try {
    const { rows } = await query(
      `SELECT "game", "external_id", "name", "data", "fetched_at" FROM game_connections WHERE "user_id" = $1 AND "game" = $2`,
      [req.userId, game],
    );
    const current = rows[0];
    if (!current) return res.status(404).json({ error: 'Show your stats first.' });
    if (Date.now() - new Date(current.fetched_at).getTime() < REFRESH_MS) return res.json(row(current));
    res.json(await readAndSave(req.userId, game));
  } catch (err) {
    failed(res, err, `${game} refresh:`);
  }
});

steamGamesRouter.delete('/api/games/:game', async (req, res, next) => {
  if (!GAMES[req.params.game]) return next();
  try {
    await query('DELETE FROM game_connections WHERE "user_id" = $1 AND "game" = $2', [req.userId, req.params.game]);
    res.status(204).end();
  } catch (err) {
    failed(res, err, `${req.params.game} disconnect:`);
  }
});
