// League of Legends stats from Riot's official API, with the app's key
// (RIOT_API_KEY, a Personal key: https://developer.riotgames.com). Players
// connect with their Riot ID and region only; the data is public. Champion
// names and pictures come from Data Dragon, which needs no key.
//
// A personal key allows 100 requests every 2 minutes for the whole app, so a
// refresh reads at most every 10 minutes and only fetches matches it hasn't
// stored yet.
import express from 'express';
import { query } from './db.mjs';

const REFRESH_MS = 10 * 60 * 1000;
const MATCHES = 20;

// Platform -> [label, regional route for match-v5, regional route for account-v1]
export const LOL_REGIONS = {
  euw1: ['Europe West', 'europe', 'europe'],
  eun1: ['Europe Nordic & East', 'europe', 'europe'],
  tr1: ['Türkiye', 'europe', 'europe'],
  ru: ['Russia', 'europe', 'europe'],
  me1: ['Middle East', 'europe', 'europe'],
  na1: ['North America', 'americas', 'americas'],
  br1: ['Brazil', 'americas', 'americas'],
  la1: ['Latin America North', 'americas', 'americas'],
  la2: ['Latin America South', 'americas', 'americas'],
  kr: ['Korea', 'asia', 'asia'],
  jp1: ['Japan', 'asia', 'asia'],
  oc1: ['Oceania', 'sea', 'asia'],
  sg2: ['Southeast Asia', 'sea', 'asia'],
  tw2: ['Taiwan', 'sea', 'asia'],
  vn2: ['Vietnam', 'sea', 'asia'],
};

export class RiotError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const riotKey = () => process.env.RIOT_API_KEY?.trim() || null;

async function riot(host, path, { allow404 = false } = {}) {
  const key = riotKey();
  if (!key) throw new RiotError("League of Legends stats aren't set up on this server yet.", 503);
  let r;
  try {
    r = await fetch(`https://${host}.api.riotgames.com${path}`, {
      headers: { 'X-Riot-Token': key },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new RiotError("Couldn't reach Riot. Try again in a moment.");
  }
  if (r.status === 404 && allow404) return null;
  if (r.status === 404) throw new RiotError('No player with that Riot ID in this region.', 404);
  if (r.status === 429) throw new RiotError('Riot is busy with other requests. Try again in a minute or two.', 429);
  if (r.status === 401 || r.status === 403) {
    console.error('Riot API: key rejected', r.status, path.split('/').slice(0, 4).join('/'));
    throw new RiotError("Riot didn't accept Savepoint's API key. The app owner needs to renew it.", 503);
  }
  if (!r.ok) throw new RiotError(`Riot answered ${r.status}.`);
  return r.json();
}

// ---------------------------------------------------------------- Data Dragon

let dd = null; // { at, version, champions: Map<id, { name, image }> }
async function dataDragon() {
  if (dd && Date.now() - dd.at < 6 * 3600 * 1000) return dd;
  try {
    const versions = await (
      await fetch('https://ddragon.leagueoflegends.com/api/versions.json', { signal: AbortSignal.timeout(10000) })
    ).json();
    const version = versions[0];
    const champs = await (
      await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`, {
        signal: AbortSignal.timeout(15000),
      })
    ).json();
    const champions = new Map(
      Object.values(champs.data).map((c) => [
        Number(c.key),
        { name: c.name, image: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.image.full}` },
      ]),
    );
    dd = { at: Date.now(), version, champions };
  } catch {
    dd ??= { at: 0, version: null, champions: new Map() };
  }
  return dd;
}

const QUEUES = {
  0: 'Custom',
  400: 'Normal Draft',
  420: 'Ranked Solo/Duo',
  430: 'Normal Blind',
  440: 'Ranked Flex',
  450: 'ARAM',
  480: 'Swiftplay',
  490: 'Quickplay',
  700: 'Clash',
  720: 'ARAM Clash',
  830: 'Co-op vs AI',
  840: 'Co-op vs AI',
  850: 'Co-op vs AI',
  870: 'Co-op vs AI',
  880: 'Co-op vs AI',
  890: 'Co-op vs AI',
  900: 'ARURF',
  1020: 'One for All',
  1300: 'Nexus Blitz',
  1700: 'Arena',
  1710: 'Arena',
  1900: 'URF',
  2300: 'Brawl',
};

// ---------------------------------------------------------------- reading

/** One of the player's matches, kept small. */
function matchSummary(m, puuid) {
  const p = m.info?.participants?.find((x) => x.puuid === puuid);
  if (!p) return null;
  return {
    id: m.metadata.matchId,
    queue: QUEUES[m.info.queueId] ?? m.info.gameMode ?? 'Other',
    queueId: m.info.queueId,
    end: new Date(m.info.gameEndTimestamp ?? m.info.gameCreation + m.info.gameDuration * 1000).toISOString(),
    minutes: Math.round((m.info.gameDuration ?? 0) / 60),
    championId: p.championId,
    role: p.teamPosition || p.individualPosition || null,
    win: !!p.win,
    remake: !!p.gameEndedInEarlySurrender,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
    damage: p.totalDamageDealtToChampions ?? 0,
    gold: p.goldEarned ?? 0,
  };
}

/** Everything shown in the LoL tab for one player. `previous` saves re-reading old matches. */
export async function readPlayer(puuid, platform, previous) {
  const [, matchRoute, accountRoute] = LOL_REGIONS[platform];
  const [account, summoner, ranked, masteries, score, challenges, live, matchIds, dragon] = await Promise.all([
    riot(accountRoute, `/riot/account/v1/accounts/by-puuid/${puuid}`),
    riot(platform, `/lol/summoner/v4/summoners/by-puuid/${puuid}`),
    riot(platform, `/lol/league/v4/entries/by-puuid/${puuid}`).catch(() => []),
    riot(platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`).catch(() => []),
    riot(platform, `/lol/champion-mastery/v4/scores/by-puuid/${puuid}`).catch(() => null),
    riot(platform, `/lol/challenges/v1/player-data/${puuid}`, { allow404: true }).catch(() => null),
    riot(platform, `/lol/spectator/v5/active-games/by-summoner/${puuid}`, { allow404: true }).catch(() => null),
    riot(matchRoute, `/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${MATCHES}`).catch(() => []),
    dataDragon(),
  ]);

  // New matches in small batches: a personal key allows 20 requests a second.
  const known = new Map((previous?.matches ?? []).map((m) => [m.id, m]));
  const missing = matchIds.filter((id) => !known.has(id));
  for (let i = 0; i < missing.length; i += 8) {
    const batch = await Promise.all(
      missing
        .slice(i, i + 8)
        .map((id) => riot(matchRoute, `/lol/match/v5/matches/${id}`, { allow404: true }).catch(() => null)),
    );
    for (const m of batch) {
      const s = m && matchSummary(m, puuid);
      if (s) known.set(s.id, s);
    }
    if (i + 8 < missing.length) await new Promise((r) => setTimeout(r, 1000));
  }
  const matches = matchIds.map((id) => known.get(id)).filter(Boolean);

  const champ = (id) => dragon.champions.get(id) ?? { name: `Champion ${id}`, image: null };
  const icon =
    dragon.version && summoner.profileIconId != null
      ? `https://ddragon.leagueoflegends.com/cdn/${dragon.version}/img/profileicon/${summoner.profileIconId}.png`
      : null;
  const me = live?.participants?.find((p) => p.puuid === puuid);

  return {
    puuid,
    platform,
    gameName: account.gameName,
    tagLine: account.tagLine,
    level: summoner.summonerLevel ?? null,
    icon,
    ranked: (ranked ?? [])
      .filter((r) => r.queueType === 'RANKED_SOLO_5x5' || r.queueType === 'RANKED_FLEX_SR')
      .map((r) => ({
        queue: r.queueType === 'RANKED_SOLO_5x5' ? 'Solo/Duo' : 'Flex',
        tier: r.tier,
        division: r.rank,
        lp: r.leaguePoints,
        wins: r.wins,
        losses: r.losses,
        hotStreak: !!r.hotStreak,
      })),
    mastery: {
      score: typeof score === 'number' ? score : null,
      champions: masteries.length,
      points: masteries.reduce((n, m) => n + (m.championPoints ?? 0), 0),
      top: masteries.slice(0, 15).map((m) => ({
        championId: m.championId,
        name: champ(m.championId).name,
        image: champ(m.championId).image,
        level: m.championLevel,
        points: m.championPoints,
        lastPlayed: m.lastPlayTime ? new Date(m.lastPlayTime).toISOString() : null,
      })),
    },
    challenges: challenges?.totalPoints
      ? {
          level: challenges.totalPoints.level ?? null,
          points: challenges.totalPoints.current ?? 0,
          max: challenges.totalPoints.max ?? null,
          percentile: challenges.totalPoints.percentile ?? null,
          categories: Object.entries(challenges.categoryPoints ?? {}).map(([k, v]) => ({
            name: k.charAt(0) + k.slice(1).toLowerCase(),
            level: v.level ?? null,
            points: v.current ?? 0,
            max: v.max ?? null,
          })),
        }
      : null,
    live: live
      ? {
          queue: QUEUES[live.gameQueueConfigId] ?? live.gameMode ?? 'Game',
          champion: me ? champ(me.championId).name : null,
          image: me ? champ(me.championId).image : null,
          since: live.gameStartTime ? new Date(live.gameStartTime).toISOString() : null,
        }
      : null,
    matches: matches.map((m) => ({ ...m, champion: champ(m.championId).name, image: champ(m.championId).image })),
  };
}

// ---------------------------------------------------------------- routes

export const lolRouter = express.Router();

function failed(res, err, what) {
  if (err instanceof RiotError) return res.status(err.status).json({ error: err.message });
  console.error(what, err);
  res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
}

async function save(userId, player) {
  const { rows } = await query(
    `INSERT INTO game_connections ("user_id", "game", "external_id", "name", "data", "fetched_at")
     VALUES ($1, 'lol', $2, $3, $4, now())
     ON CONFLICT ("user_id", "game") DO UPDATE SET "external_id" = EXCLUDED."external_id",
       "name" = EXCLUDED."name", "data" = EXCLUDED."data", "fetched_at" = now()
     RETURNING "fetched_at"`,
    [userId, player.puuid, `${player.gameName}#${player.tagLine}`, JSON.stringify(player)],
  );
  return { game: 'lol', externalId: player.puuid, name: player.gameName, data: player, fetchedAt: rows[0].fetched_at };
}

// -> { configured, regions: [{ value, label }] }
lolRouter.get('/api/games/lol/setup', (_req, res) => {
  res.json({
    configured: !!riotKey(),
    regions: Object.entries(LOL_REGIONS).map(([value, [label]]) => ({ value, label })),
  });
});

// Body: { riotId: "Name#TAG", region: "eun1" } -> the connection
lolRouter.post('/api/games/lol/connect', express.json({ limit: '10kb' }), async (req, res) => {
  const [gameName, tagLine] = String(req.body?.riotId ?? '')
    .trim()
    .split('#')
    .map((s) => s?.trim());
  const platform = String(req.body?.region ?? '');
  if (!gameName || !tagLine) return res.status(400).json({ error: 'Type your Riot ID as Name#TAG.' });
  if (!LOL_REGIONS[platform]) return res.status(400).json({ error: 'Pick your region.' });
  try {
    const account = await riot(
      LOL_REGIONS[platform][2],
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    );
    res.json(await save(req.userId, await readPlayer(account.puuid, platform, null)));
  } catch (err) {
    failed(res, err, 'LoL connect:');
  }
});

// Reads the player again (at most every 10 minutes). -> the connection
lolRouter.post('/api/games/lol/refresh', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT "external_id", "data", "fetched_at" FROM game_connections WHERE "user_id" = $1 AND "game" = 'lol'`,
      [req.userId],
    );
    const current = rows[0];
    if (!current) return res.status(404).json({ error: 'Connect your Riot ID first.' });
    if (Date.now() - new Date(current.fetched_at).getTime() < REFRESH_MS) {
      return res.json({
        game: 'lol',
        externalId: current.external_id,
        name: current.data.gameName,
        data: current.data,
        fetchedAt: current.fetched_at,
      });
    }
    res.json(await save(req.userId, await readPlayer(current.external_id, current.data.platform, current.data)));
  } catch (err) {
    failed(res, err, 'LoL refresh:');
  }
});

lolRouter.delete('/api/games/lol', async (req, res) => {
  try {
    await query(`DELETE FROM game_connections WHERE "user_id" = $1 AND "game" = 'lol'`, [req.userId]);
    res.status(204).end();
  } catch (err) {
    failed(res, err, 'LoL disconnect:');
  }
});
