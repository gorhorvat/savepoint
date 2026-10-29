// League of Legends stats from Riot's official API, with the app's key
// (RIOT_API_KEY, a Personal key: https://developer.riotgames.com). Players
// connect with their Riot ID and region only; the data is public. Champion,
// item, rune and spell names and pictures come from Data Dragon (no key).
//
// A personal key allows 100 requests every 2 minutes for the whole app, so a
// refresh reads at most every 10 minutes. Matches go into an archive
// (lol_matches) with all ten players: each refresh stores new matches and
// backfills up to BACKFILL older ones, until Riot has no more or the archive
// holds ARCHIVE_MAX. A match's timeline is fetched when someone opens it.
import express from 'express';
import { query } from './db.mjs';
import { saveSnapshot } from './snapshots.mjs';

const REFRESH_MS = 10 * 60 * 1000;
const RECENT = 20; // match ids read on connect
const PER_REFRESH = 40; // most match details fetched in one refresh
const BACKFILL_MS = 2 * 60 * 1000; // "load older matches" at most this often
const ARCHIVE_MAX = 1000;

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

const DD = 'https://ddragon.leagueoflegends.com';
const EMPTY_DD = () => ({
  at: 0,
  version: null,
  champions: new Map(),
  items: new Map(),
  spells: new Map(),
  runes: new Map(),
});
let dd = null; // { at, version, champions, items, spells, runes: Map<id, { name, image }> }
async function dataDragon() {
  if (dd && Date.now() - dd.at < 6 * 3600 * 1000) return dd;
  const get = async (path) => {
    const r = await fetch(`${DD}/${path}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Data Dragon ${r.status}`);
    return r.json();
  };
  try {
    const [version] = await get('api/versions.json');
    const cdn = `${DD}/cdn/${version}`;
    const [champs, items, spells, runes] = await Promise.all([
      get(`cdn/${version}/data/en_US/champion.json`),
      get(`cdn/${version}/data/en_US/item.json`).catch(() => ({ data: {} })),
      get(`cdn/${version}/data/en_US/summoner.json`).catch(() => ({ data: {} })),
      get(`cdn/${version}/data/en_US/runesReforged.json`).catch(() => []),
    ]);
    const runeMap = new Map();
    for (const style of runes) {
      runeMap.set(style.id, { name: style.name, image: `${DD}/cdn/img/${style.icon}` });
      for (const slot of style.slots ?? []) {
        for (const r of slot.runes ?? []) runeMap.set(r.id, { name: r.name, image: `${DD}/cdn/img/${r.icon}` });
      }
    }
    dd = {
      at: Date.now(),
      version,
      champions: new Map(
        Object.values(champs.data).map((c) => [
          Number(c.key),
          { name: c.name, image: `${cdn}/img/champion/${c.image.full}` },
        ]),
      ),
      items: new Map(
        Object.entries(items.data).map(([id, it]) => [
          Number(id),
          { name: it.name, image: `${cdn}/img/item/${it.image.full}` },
        ]),
      ),
      spells: new Map(
        Object.values(spells.data).map((sp) => [
          Number(sp.key),
          { name: sp.name, image: `${cdn}/img/spell/${sp.image.full}` },
        ]),
      ),
      runes: runeMap,
    };
  } catch {
    dd ??= EMPTY_DD();
  }
  return dd;
}

// Stat shards aren't in Data Dragon.
const SHARDS = {
  5001: 'Health scaling',
  5002: 'Armor',
  5003: 'Magic resist',
  5005: 'Attack speed',
  5007: 'Ability haste',
  5008: 'Adaptive force',
  5010: 'Move speed',
  5011: 'Health',
  5013: 'Tenacity and slow resist',
};

/** Names and descriptions of every challenge, per platform, for half a day. */
const challengeConfigs = new Map(); // platform -> { at, map }
async function challengeConfig(platform) {
  const cached = challengeConfigs.get(platform);
  if (cached && Date.now() - cached.at < 12 * 3600 * 1000) return cached.map;
  try {
    const list = await riot(platform, '/lol/challenges/v1/challenges/config');
    const map = new Map(
      list.map((c) => {
        const en = c.localizedNames?.en_US ?? Object.values(c.localizedNames ?? {})[0] ?? {};
        return [
          c.id,
          {
            name: en.name ?? `Challenge ${c.id}`,
            description: en.description ?? en.shortDescription ?? '',
            thresholds: c.thresholds ?? {},
          },
        ];
      }),
    );
    challengeConfigs.set(platform, { at: Date.now(), map });
    return map;
  } catch {
    return cached?.map ?? new Map();
  }
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
const queueName = (id, mode) => QUEUES[id] ?? (mode ? mode.charAt(0) + mode.slice(1).toLowerCase() : 'Other');

const TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
];
const DIVISIONS = ['IV', 'III', 'II', 'I'];
const CHALLENGE_LEVELS = [
  'NONE',
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
];

/** A rank as one number for graphs: 400 per tier, 100 per division, plus LP. Master and up share one LP scale. */
function ladder(r) {
  if (!r) return null;
  const t = TIERS.indexOf(r.tier);
  if (t < 0) return null;
  if (t >= 7) return 2800 + r.lp;
  return t * 400 + Math.max(0, DIVISIONS.indexOf(r.division)) * 100 + r.lp;
}

// ---------------------------------------------------------------- matches

function perks(p) {
  if (!p?.styles) return null;
  const primary = p.styles.find((s) => s.description === 'primaryStyle') ?? p.styles[0];
  const sub = p.styles.find((s) => s.description === 'subStyle') ?? p.styles[1];
  return {
    p: primary?.style ?? null,
    s: sub?.style ?? null,
    r: [...(primary?.selections ?? []), ...(sub?.selections ?? [])].map((x) => x.perk),
    shards: p.statPerks ? [p.statPerks.offense, p.statPerks.flex, p.statPerks.defense] : [],
  };
}

/** A match as stored: all ten players, without Riot's hundreds of extra fields. */
function compactMatch(m) {
  const i = m?.info;
  if (!i?.participants?.length) return null;
  const objectives = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, v?.kills ?? 0]));
  return {
    id: m.metadata.matchId,
    queueId: i.queueId,
    mode: i.gameMode ?? null,
    end: i.gameEndTimestamp ?? i.gameCreation + (i.gameDuration ?? 0) * 1000,
    seconds: i.gameDuration ?? 0,
    version: i.gameVersion ? i.gameVersion.split('.').slice(0, 2).join('.') : null,
    teams: (i.teams ?? []).map((t) => ({
      id: t.teamId,
      win: !!t.win,
      bans: (t.bans ?? []).map((b) => b.championId).filter((id) => id > 0),
      obj: objectives(t.objectives),
    })),
    players: i.participants.map((p) => ({
      puuid: p.puuid,
      name: p.riotIdGameName || p.summonerName || null,
      tag: p.riotIdTagline || null,
      champ: p.championId,
      lvl: p.champLevel ?? null,
      team: p.teamId,
      role: p.teamPosition || p.individualPosition || null,
      win: !!p.win,
      remake: !!p.gameEndedInEarlySurrender,
      k: p.kills ?? 0,
      d: p.deaths ?? 0,
      a: p.assists ?? 0,
      cs: (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
      gold: p.goldEarned ?? 0,
      dmg: p.totalDamageDealtToChampions ?? 0,
      taken: p.totalDamageTaken ?? 0,
      mitigated: p.damageSelfMitigated ?? 0,
      heal: p.totalHealsOnTeammates ?? 0,
      shield: p.totalDamageShieldedOnTeammates ?? 0,
      vision: p.visionScore ?? 0,
      wards: p.wardsPlaced ?? 0,
      wardsKilled: p.wardsKilled ?? 0,
      pinks: p.visionWardsBoughtInGame ?? 0,
      items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6].map((x) => x ?? 0),
      spells: [p.summoner1Id ?? 0, p.summoner2Id ?? 0],
      perks: perks(p.perks),
      multi: [p.doubleKills ?? 0, p.tripleKills ?? 0, p.quadraKills ?? 0, p.pentaKills ?? 0],
      spree: p.largestKillingSpree ?? 0,
      fb: !!p.firstBloodKill,
      cc: p.timeCCingOthers ?? 0,
      towers: p.damageDealtToBuildings ?? 0,
      objectives: p.damageDealtToObjectives ?? 0,
      kp: p.challenges?.killParticipation ?? null,
      dmgShare: p.challenges?.teamDamagePercentage ?? null,
      solo: p.challenges?.soloKills ?? 0,
      placement: p.placement || p.subteamPlacement || null,
    })),
  };
}

const champOf = (dragon, id) => dragon.champions.get(id) ?? { name: `Champion ${id}`, image: null };

/** One line of the match list: the player's own numbers in a stored match. */
function summary(match, puuid, dragon) {
  const p = match.players.find((x) => x.puuid === puuid);
  if (!p) return null;
  const teamKills = match.players.filter((x) => x.team === p.team).reduce((n, x) => n + x.k, 0);
  const c = champOf(dragon, p.champ);
  return {
    id: match.id,
    queue: queueName(match.queueId, match.mode),
    queueId: match.queueId,
    end: new Date(match.end).toISOString(),
    minutes: Math.round(match.seconds / 60),
    championId: p.champ,
    champion: c.name,
    image: c.image,
    role: p.role,
    win: p.win,
    remake: p.remake,
    kills: p.k,
    deaths: p.d,
    assists: p.a,
    cs: p.cs,
    damage: p.dmg,
    gold: p.gold,
    vision: p.vision,
    kp: p.kp ?? (teamKills ? (p.k + p.a) / teamKills : null),
    multikill: p.multi[3] ? 5 : p.multi[2] ? 4 : p.multi[1] ? 3 : p.multi[0] ? 2 : 0,
    placement: p.placement,
    items: p.items.map((id) => (id ? (dragon.items.get(id)?.image ?? null) : null)),
  };
}

/** A stored match with names and pictures, for the match page. */
function resolveMatch(match, puuid, dragon) {
  const thing = (map, id) => (id ? { id, ...(map.get(id) ?? { name: String(id), image: null }) } : null);
  return {
    id: match.id,
    queue: queueName(match.queueId, match.mode),
    queueId: match.queueId,
    end: new Date(match.end).toISOString(),
    seconds: match.seconds,
    version: match.version,
    teams: match.teams.map((t) => ({
      ...t,
      bans: t.bans.map((id) => ({ id, ...champOf(dragon, id) })),
    })),
    players: match.players.map(({ puuid: id, champ, items, spells, perks: pk, ...p }) => ({
      ...p,
      me: id === puuid,
      championId: champ,
      champion: champOf(dragon, champ).name,
      image: champOf(dragon, champ).image,
      items: items.map((x) => thing(dragon.items, x)),
      spells: spells.map((x) => thing(dragon.spells, x)),
      runes: pk
        ? {
            primary: thing(dragon.runes, pk.p),
            secondary: thing(dragon.runes, pk.s),
            list: pk.r.map((x) => thing(dragon.runes, x)),
            shards: pk.shards.map((x) => SHARDS[x] ?? String(x)),
          }
        : null,
    })),
  };
}

/** Riot's timeline, kept to per-minute gold, CS, XP and level, kills, objectives, items and skills. */
function compactTimeline(t, match) {
  const tl = t?.info;
  if (!tl?.frames) return null;
  // Timeline participant ids, in the stored match's player order.
  const order = match.players.map(
    (pl, i) => tl.participants?.find((x) => x.puuid === pl.puuid)?.participantId ?? i + 1,
  );
  const index = new Map(order.map((id, i) => [id, i]));
  const who = (id) => index.get(id) ?? -1;
  const frame = (f, pick) => order.map((id) => pick(f.participantFrames?.[id] ?? {}));
  const events = [];
  for (const f of tl.frames) {
    for (const e of f.events ?? []) {
      const at = Math.round((e.timestamp ?? 0) / 1000);
      if (e.type === 'CHAMPION_KILL') {
        events.push({
          at,
          type: 'kill',
          by: who(e.killerId),
          victim: who(e.victimId),
          assists: (e.assistingParticipantIds ?? []).map(who),
        });
      } else if (e.type === 'ELITE_MONSTER_KILL') {
        events.push({
          at,
          type: 'monster',
          by: who(e.killerId),
          team: e.killerTeamId,
          monster: e.monsterSubType || e.monsterType,
        });
      } else if (e.type === 'BUILDING_KILL') {
        // teamId is the team that lost the building.
        events.push({
          at,
          type: 'building',
          by: who(e.killerId),
          team: e.teamId,
          building: e.towerType || e.buildingType,
          lane: e.laneType,
        });
      } else if (e.type === 'ITEM_PURCHASED') {
        events.push({ at, type: 'item', by: who(e.participantId), item: e.itemId });
      } else if (e.type === 'SKILL_LEVEL_UP' && e.levelUpType === 'NORMAL') {
        events.push({ at, type: 'skill', by: who(e.participantId), skill: e.skillSlot });
      }
    }
  }
  return {
    gold: tl.frames.map((f) => frame(f, (p) => p.totalGold ?? 0)),
    cs: tl.frames.map((f) => frame(f, (p) => (p.minionsKilled ?? 0) + (p.jungleMinionsKilled ?? 0))),
    xp: tl.frames.map((f) => frame(f, (p) => p.xp ?? 0)),
    level: tl.frames.map((f) => frame(f, (p) => p.level ?? 0)),
    events,
  };
}

/** Item names and pictures for a timeline's purchases. */
function resolveTimeline(timeline, dragon) {
  const items = {};
  for (const e of timeline.events) {
    if (e.type === 'item' && !items[e.item])
      items[e.item] = dragon.items.get(e.item) ?? { name: String(e.item), image: null };
  }
  return { ...timeline, items };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetches and stores matches by id, 8 at a time (a personal key allows 20 a second). -> how many were stored */
async function storeMatches(userId, route, ids) {
  let stored = 0;
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(
      ids.slice(i, i + 8).map((id) => riot(route, `/lol/match/v5/matches/${id}`, { allow404: true }).catch(() => null)),
    );
    for (const raw of batch) {
      const m = compactMatch(raw);
      if (!m) continue;
      await query(
        `INSERT INTO lol_matches ("user_id", "match_id", "ended_at", "data") VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [userId, m.id, new Date(m.end).toISOString(), JSON.stringify(m)],
      );
      stored++;
    }
    if (i + 8 < ids.length) await sleep(1000);
  }
  return stored;
}

/**
 * Brings the archive up to date: matches newer than the newest stored one
 * first (oldest of those first, so a long gap fills in order on later
 * refreshes), then older ones, PER_REFRESH at most. -> { count, complete, backfilledAt }
 */
async function syncMatches(userId, puuid, route, archive, { olderOnly = false } = {}) {
  const { rows } = await query(
    `SELECT count(*)::int AS n, min("ended_at") AS oldest, max("ended_at") AS newest FROM lol_matches WHERE "user_id" = $1`,
    [userId],
  );
  const { n, oldest, newest } = rows[0];
  const ids = `/lol/match/v5/matches/by-puuid/${puuid}/ids`;
  const sec = (d) => Math.floor(new Date(d).getTime() / 1000);

  let newer = [];
  if (!olderOnly) {
    newer = newest
      ? await riot(route, `${ids}?startTime=${sec(newest) + 1}&count=100`).catch(() => [])
      : await riot(route, `${ids}?start=0&count=${RECENT}`).catch(() => []);
    newer.reverse();
  }
  let complete = archive?.complete ?? false;
  let older = [];
  if (!complete && n && n < ARCHIVE_MAX) {
    const got = await riot(route, `${ids}?endTime=${sec(oldest) - 1}&count=100`).catch(() => null);
    if (got && !got.length) complete = true;
    older = got ?? [];
  }

  const wanted = [...new Set([...newer, ...older])];
  let have = new Set();
  if (wanted.length) {
    const { rows: known } = await query(
      'SELECT "match_id" FROM lol_matches WHERE "user_id" = $1 AND "match_id" = ANY($2)',
      [userId, wanted],
    );
    have = new Set(known.map((r) => r.match_id));
  }
  const missing = wanted.filter((id) => !have.has(id)).slice(0, PER_REFRESH);
  const stored = missing.length ? await storeMatches(userId, route, missing) : 0;
  return {
    count: n + stored,
    complete: complete || n + stored >= ARCHIVE_MAX,
    backfilledAt: olderOnly ? new Date().toISOString() : (archive?.backfilledAt ?? null),
  };
}

async function recentSummaries(userId, puuid, limit) {
  const [{ rows }, dragon] = await Promise.all([
    query('SELECT "data" FROM lol_matches WHERE "user_id" = $1 ORDER BY "ended_at" DESC LIMIT $2', [userId, limit]),
    dataDragon(),
  ]);
  return rows.map((r) => summary(r.data, puuid, dragon)).filter(Boolean);
}

// ---------------------------------------------------------------- reading

/** Profile, ranked, every champion's mastery, every challenge and the live game. */
export async function readPlayer(puuid, platform) {
  const [, , accountRoute] = LOL_REGIONS[platform];
  const [account, summoner, ranked, masteries, score, challenges, live, dragon, config] = await Promise.all([
    riot(accountRoute, `/riot/account/v1/accounts/by-puuid/${puuid}`),
    riot(platform, `/lol/summoner/v4/summoners/by-puuid/${puuid}`),
    riot(platform, `/lol/league/v4/entries/by-puuid/${puuid}`).catch(() => []),
    riot(platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}`).catch(() => []),
    riot(platform, `/lol/champion-mastery/v4/scores/by-puuid/${puuid}`).catch(() => null),
    riot(platform, `/lol/challenges/v1/player-data/${puuid}`, { allow404: true }).catch(() => null),
    riot(platform, `/lol/spectator/v5/active-games/by-summoner/${puuid}`, { allow404: true }).catch(() => null),
    dataDragon(),
    challengeConfig(platform),
  ]);

  const champ = (id) => champOf(dragon, id);
  const icon =
    dragon.version && summoner.profileIconId != null
      ? `${DD}/cdn/${dragon.version}/img/profileicon/${summoner.profileIconId}.png`
      : null;
  const me = live?.participants?.find((p) => p.puuid === puuid);

  const nextTier = (cfg, level, value) => {
    const at = CHALLENGE_LEVELS.indexOf(level);
    for (const tier of CHALLENGE_LEVELS.slice(Math.max(1, at + 1))) {
      const need = cfg.thresholds?.[tier];
      if (need != null && need > value) return { level: tier, value: need };
    }
    return null;
  };

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
        veteran: !!r.veteran,
        freshBlood: !!r.freshBlood,
        series: r.miniSeries ? r.miniSeries.progress : null,
      })),
    mastery: {
      score: typeof score === 'number' ? score : null,
      champions: masteries.length,
      points: masteries.reduce((n, m) => n + (m.championPoints ?? 0), 0),
      // Every champion played (the field stays "top" for older clients).
      top: masteries.map((m) => ({
        championId: m.championId,
        name: champ(m.championId).name,
        image: champ(m.championId).image,
        level: m.championLevel,
        points: m.championPoints,
        sinceLevel: m.championPointsSinceLastLevel ?? null,
        untilLevel: m.championPointsUntilNextLevel ?? null,
        marks: m.tokensEarned ?? m.markRequiredForNextLevel ?? null,
        milestone: m.championSeasonMilestone ?? null,
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
            percentile: v.percentile ?? null,
          })),
          list: (challenges.challenges ?? [])
            .filter((c) => c.challengeId > 10 && config.has(c.challengeId))
            .map((c) => {
              const cfg = config.get(c.challengeId);
              return {
                id: c.challengeId,
                name: cfg.name,
                description: cfg.description,
                level: c.level ?? 'NONE',
                value: c.value ?? 0,
                percentile: c.percentile ?? null,
                achieved: c.achievedTime ? new Date(c.achievedTime).toISOString() : null,
                next: nextTier(cfg, c.level ?? 'NONE', c.value ?? 0),
              };
            }),
        }
      : null,
    live: live
      ? {
          queue: queueName(live.gameQueueConfigId, live.gameMode),
          champion: me ? champ(me.championId).name : null,
          image: me ? champ(me.championId).image : null,
          since: live.gameStartTime ? new Date(live.gameStartTime).toISOString() : null,
        }
      : null,
  };
}

/** Today's numbers for the progress graphs. */
function snapshotOf(p) {
  const solo = p.ranked.find((r) => r.queue === 'Solo/Duo');
  const flex = p.ranked.find((r) => r.queue === 'Flex');
  return {
    level: p.level,
    solo: ladder(solo),
    flex: ladder(flex),
    soloGames: solo ? solo.wins + solo.losses : null,
    mastery: p.mastery.score,
    masteryPoints: p.mastery.points,
    champions: p.mastery.champions,
    challenges: p.challenges?.points ?? null,
    matches: p.archive?.count ?? null,
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

/** Reads the player, brings the match archive up to date, saves both and today's snapshot. */
async function readAndSave(userId, puuid, platform, previous) {
  const player = await readPlayer(puuid, platform);
  player.archive = await syncMatches(userId, puuid, LOL_REGIONS[platform][1], previous?.archive);
  player.matches = await recentSummaries(userId, puuid, RECENT);
  const conn = await save(userId, player);
  await saveSnapshot(userId, 'lol', snapshotOf(player));
  return conn;
}

/** The connected player, or a 404 answer. */
async function connected(req, res) {
  const { rows } = await query(
    `SELECT "external_id", "data", "fetched_at" FROM game_connections WHERE "user_id" = $1 AND "game" = 'lol'`,
    [req.userId],
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Connect your Riot ID first.' });
    return null;
  }
  return rows[0];
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
    // A different Riot ID starts a new archive and new graphs.
    const { rows } = await query(`SELECT "external_id" FROM game_connections WHERE "user_id" = $1 AND "game" = 'lol'`, [
      req.userId,
    ]);
    if (rows[0]?.external_id !== account.puuid) {
      await query('DELETE FROM lol_matches WHERE "user_id" = $1', [req.userId]);
      await query(`DELETE FROM game_snapshots WHERE "user_id" = $1 AND "game" = 'lol'`, [req.userId]);
    }
    res.json(await readAndSave(req.userId, account.puuid, platform, null));
  } catch (err) {
    failed(res, err, 'LoL connect:');
  }
});

// Reads the player again (at most every 10 minutes). -> the connection
lolRouter.post('/api/games/lol/refresh', async (req, res) => {
  try {
    const current = await connected(req, res);
    if (!current) return;
    if (Date.now() - new Date(current.fetched_at).getTime() < REFRESH_MS) {
      return res.json({
        game: 'lol',
        externalId: current.external_id,
        name: current.data.gameName,
        data: current.data,
        fetchedAt: current.fetched_at,
      });
    }
    res.json(await readAndSave(req.userId, current.external_id, current.data.platform, current.data));
  } catch (err) {
    failed(res, err, 'LoL refresh:');
  }
});

// Fetches up to PER_REFRESH older matches into the archive. -> { archive }
lolRouter.post('/api/games/lol/backfill', async (req, res) => {
  try {
    const current = await connected(req, res);
    if (!current) return;
    const archive = current.data.archive ?? null;
    if (archive?.complete) return res.json({ archive });
    if (archive?.backfilledAt && Date.now() - new Date(archive.backfilledAt).getTime() < BACKFILL_MS) {
      return res.status(429).json({ error: 'Riot allows only so many requests. Try again in a couple of minutes.' });
    }
    const next = await syncMatches(req.userId, current.external_id, LOL_REGIONS[current.data.platform][1], archive, {
      olderOnly: true,
    });
    await query(
      `UPDATE game_connections SET "data" = jsonb_set("data", '{archive}', $2::jsonb) WHERE "user_id" = $1 AND "game" = 'lol'`,
      [req.userId, JSON.stringify(next)],
    );
    res.json({ archive: next });
  } catch (err) {
    failed(res, err, 'LoL backfill:');
  }
});

// ?before=ISO&queue=420&champion=103&limit=20 -> { matches: [summary], more }
lolRouter.get('/api/games/lol/matches', async (req, res) => {
  try {
    const current = await connected(req, res);
    if (!current) return;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const params = [req.userId, current.external_id];
    const where = ['m."user_id" = $1'];
    if (req.query.before) {
      params.push(new Date(String(req.query.before)).toISOString());
      where.push(`m."ended_at" < $${params.length}`);
    }
    if (req.query.queue) {
      params.push(Number(req.query.queue));
      where.push(`(m."data"->>'queueId')::int = $${params.length}`);
    }
    if (req.query.champion) {
      params.push(Number(req.query.champion));
      where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(m."data"->'players') p
                          WHERE p->>'puuid' = $2 AND (p->>'champ')::int = $${params.length})`);
    }
    params.push(limit + 1);
    const [{ rows }, dragon] = await Promise.all([
      query(
        `SELECT m."data" FROM lol_matches m WHERE ${where.join(' AND ')}
         AND $2::text IS NOT NULL ORDER BY m."ended_at" DESC LIMIT $${params.length}`,
        params,
      ),
      dataDragon(),
    ]);
    res.json({
      matches: rows
        .slice(0, limit)
        .map((r) => summary(r.data, current.external_id, dragon))
        .filter(Boolean),
      more: rows.length > limit,
    });
  } catch (err) {
    failed(res, err, 'LoL matches:');
  }
});

// -> the match with all ten players, names and pictures
lolRouter.get('/api/games/lol/matches/:id', async (req, res) => {
  try {
    const current = await connected(req, res);
    if (!current) return;
    const [{ rows }, dragon] = await Promise.all([
      query('SELECT "data" FROM lol_matches WHERE "user_id" = $1 AND "match_id" = $2', [req.userId, req.params.id]),
      dataDragon(),
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'That match isn’t in your archive.' });
    res.json(resolveMatch(rows[0].data, current.external_id, dragon));
  } catch (err) {
    failed(res, err, 'LoL match:');
  }
});

// -> the match's timeline (fetched from Riot the first time, then kept)
lolRouter.get('/api/games/lol/matches/:id/timeline', async (req, res) => {
  try {
    const current = await connected(req, res);
    if (!current) return;
    const { rows } = await query(
      'SELECT "data", "timeline" FROM lol_matches WHERE "user_id" = $1 AND "match_id" = $2',
      [req.userId, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'That match isn’t in your archive.' });
    let timeline = rows[0].timeline;
    if (!timeline) {
      const raw = await riot(LOL_REGIONS[current.data.platform][1], `/lol/match/v5/matches/${req.params.id}/timeline`, {
        allow404: true,
      });
      timeline = raw && compactTimeline(raw, rows[0].data);
      if (!timeline) return res.status(404).json({ error: 'Riot has no timeline for this match.' });
      await query('UPDATE lol_matches SET "timeline" = $3 WHERE "user_id" = $1 AND "match_id" = $2', [
        req.userId,
        req.params.id,
        JSON.stringify(timeline),
      ]);
    }
    res.json(resolveTimeline(timeline, await dataDragon()));
  } catch (err) {
    failed(res, err, 'LoL timeline:');
  }
});

// ?queue=420 -> per champion, per role and per queue, from every archived match
lolRouter.get('/api/games/lol/champions', async (req, res) => {
  try {
    const current = await connected(req, res);
    if (!current) return;
    const params = [req.userId, current.external_id];
    let queueFilter = '';
    if (req.query.queue) {
      params.push(Number(req.query.queue));
      queueFilter = `AND (m."data"->>'queueId')::int = $3`;
    }
    const [{ rows }, dragon] = await Promise.all([
      query(
        `SELECT (m."data"->>'queueId')::int AS queue, m."data"->>'mode' AS mode, (m."data"->>'seconds')::int AS seconds,
                m."ended_at", p AS me
         FROM lol_matches m, jsonb_array_elements(m."data"->'players') p
         WHERE m."user_id" = $1 AND p->>'puuid' = $2 ${queueFilter}`,
        params,
      ),
      dataDragon(),
    ]);
    const groups = { champions: new Map(), roles: new Map(), queues: new Map() };
    const add = (map, key, base, r) => {
      const g = map.get(key) ?? {
        ...base,
        games: 0,
        wins: 0,
        k: 0,
        d: 0,
        a: 0,
        cs: 0,
        minutes: 0,
        dmg: 0,
        gold: 0,
        vision: 0,
        kp: 0,
        kpGames: 0,
        pentas: 0,
        last: null,
      };
      const p = r.me;
      g.games++;
      if (p.win) g.wins++;
      g.k += p.k;
      g.d += p.d;
      g.a += p.a;
      g.cs += p.cs;
      g.minutes += r.seconds / 60;
      g.dmg += p.dmg;
      g.gold += p.gold;
      g.vision += p.vision;
      if (p.kp != null) {
        g.kp += p.kp;
        g.kpGames++;
      }
      g.pentas += p.multi?.[3] ?? 0;
      const end = new Date(r.ended_at).toISOString();
      if (!g.last || end > g.last) g.last = end;
      map.set(key, g);
    };
    let remakes = 0;
    for (const r of rows) {
      if (r.me.remake) {
        remakes++;
        continue;
      }
      const c = champOf(dragon, r.me.champ);
      add(groups.champions, r.me.champ, { championId: r.me.champ, name: c.name, image: c.image }, r);
      if (r.me.role && r.me.role !== 'Invalid') add(groups.roles, r.me.role, { role: r.me.role }, r);
      add(groups.queues, r.queue, { queueId: r.queue, name: queueName(r.queue, r.mode) }, r);
    }
    const out = (map) =>
      [...map.values()]
        .map(({ kp, kpGames, minutes, ...g }) => ({
          ...g,
          minutes: Math.round(minutes),
          kp: kpGames ? kp / kpGames : null,
        }))
        .sort((a, b) => b.games - a.games);
    res.json({
      games: rows.length - remakes,
      champions: out(groups.champions),
      roles: out(groups.roles),
      queues: out(groups.queues),
    });
  } catch (err) {
    failed(res, err, 'LoL champions:');
  }
});

// The live game with all ten players and their ranks, cached for 2 minutes.
const liveCache = new Map(); // userId -> { at, body }
lolRouter.get('/api/games/lol/live', async (req, res) => {
  try {
    const current = await connected(req, res);
    if (!current) return;
    const cached = liveCache.get(req.userId);
    if (cached && Date.now() - cached.at < 2 * 60 * 1000) return res.json(cached.body);
    const platform = current.data.platform;
    const [live, dragon] = await Promise.all([
      riot(platform, `/lol/spectator/v5/active-games/by-summoner/${current.external_id}`, { allow404: true }),
      dataDragon(),
    ]);
    let body = { live: null };
    if (live) {
      const ranks = await Promise.all(
        (live.participants ?? []).map((p) =>
          p.puuid ? riot(platform, `/lol/league/v4/entries/by-puuid/${p.puuid}`).catch(() => []) : [],
        ),
      );
      const thing = (map, id) => (id ? { id, ...(map.get(id) ?? { name: String(id), image: null }) } : null);
      body = {
        live: {
          queue: queueName(live.gameQueueConfigId, live.gameMode),
          since: live.gameStartTime ? new Date(live.gameStartTime).toISOString() : null,
          bans: (live.bannedChampions ?? [])
            .filter((b) => b.championId > 0)
            .map((b) => ({ team: b.teamId, ...champOf(dragon, b.championId) })),
          players: (live.participants ?? []).map((p, i) => {
            const solo = ranks[i].find((r) => r.queueType === 'RANKED_SOLO_5x5');
            return {
              me: p.puuid === current.external_id,
              name: p.riotId ? p.riotId.split('#')[0] : null,
              tag: p.riotId?.split('#')[1] ?? null,
              team: p.teamId,
              bot: !!p.bot,
              championId: p.championId,
              champion: champOf(dragon, p.championId).name,
              image: champOf(dragon, p.championId).image,
              spells: [thing(dragon.spells, p.spell1Id), thing(dragon.spells, p.spell2Id)],
              keystone: thing(dragon.runes, p.perks?.perkIds?.[0]),
              secondary: thing(dragon.runes, p.perks?.perkSubStyle),
              rank: solo
                ? { tier: solo.tier, division: solo.rank, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses }
                : null,
            };
          }),
        },
      };
    }
    liveCache.set(req.userId, { at: Date.now(), body });
    res.json(body);
  } catch (err) {
    failed(res, err, 'LoL live:');
  }
});

lolRouter.delete('/api/games/lol', async (req, res) => {
  try {
    await query(`DELETE FROM game_connections WHERE "user_id" = $1 AND "game" = 'lol'`, [req.userId]);
    await query('DELETE FROM lol_matches WHERE "user_id" = $1', [req.userId]);
    await query(`DELETE FROM game_snapshots WHERE "user_id" = $1 AND "game" = 'lol'`, [req.userId]);
    res.status(204).end();
  } catch (err) {
    failed(res, err, 'LoL disconnect:');
  }
});
