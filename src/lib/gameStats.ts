// Game-specific stats (My Stats, a tab per game): FINAL FANTASY XIV, read by
// the server from the character's public Lodestone pages; Guild Wars 2, read
// from ArenaNet's API with the account's own API key; League of Legends, from
// Riot's API with the app's key and the player's Riot ID; Counter-Strike 2
// and Dota 2, from the account's linked Steam (Steam, Leetify and OpenDota).
import type { GameStatsId } from './store';

export const STATS_GAMES: { id: GameStatsId; name: string; short: string }[] = [
  { id: 'ffxiv', name: 'FINAL FANTASY XIV Online', short: 'FFXIV' },
  { id: 'gw2', name: 'Guild Wars 2', short: 'GW2' },
  { id: 'lol', name: 'League of Legends', short: 'LoL' },
  { id: 'cs2', name: 'Counter-Strike 2', short: 'CS2' },
  { id: 'dota2', name: 'Dota 2', short: 'Dota 2' },
];

export interface FfxivJob {
  key: string;
  name: string;
  role: 'Tank' | 'Healer' | 'Melee' | 'Ranged' | 'Caster' | 'Limited' | 'Crafter' | 'Gatherer';
  level: number;
  /** The job's icon from the Lodestone (missing on data read before icons were added). */
  icon?: string | null;
  exp: { current: number; max: number } | null;
}

export interface FfxivCollection {
  public: boolean;
  count: number;
  list: { name: string; icon: string | null }[];
}

export interface FfxivGear {
  key: string;
  slot: string;
  name: string;
  itemLevel: number | null;
  icon: string | null;
  glamour: string | null;
  dye: string | null;
  crafter: string | null;
  classes: string | null;
  materia: string[];
}

export interface FfxivFreeCompany {
  id: string;
  name: string;
  tag: string | null;
  slogan: string | null;
  crest: string[];
  formed: string | null;
  rank: number | null;
  members: number | null;
  active: string | null;
  recruiting: string | null;
  grandCompany: { name: string; rank: string | null } | null;
  world: string | null;
  estate: { name: string | null; plot: string | null; greeting: string | null } | null;
  ranking: { weekly: number | null; monthly: number | null };
  focus: { name: string; icon: string | null; on: boolean }[];
  reputation: { name: string; rank: string | null; progress: number | null }[];
}

export interface FfxivSnapshot {
  achievements: number | null;
  points: number | null;
  mounts: number | null;
  minions: number | null;
  itemLevel: number | null;
  levels: number | null;
  maxed: number | null;
  combatMaxed: number | null;
}

export interface FfxivCharacter {
  id: string;
  name: string;
  title: string | null;
  world: string | null;
  dataCenter: string | null;
  race: string | null;
  clan: string | null;
  gender: string | null;
  nameday: string | null;
  guardian: string | null;
  cityState: string | null;
  grandCompany: { name: string; rank: string } | null;
  freeCompany: { id: string | number | null; name: string; crest?: string[] } | null;
  freeCompanyPage?: FfxivFreeCompany | null;
  pvpTeam?: { id: string | number | null; name: string; crest: string[] } | null;
  bio?: string | null;
  gear?: FfxivGear[];
  itemLevel?: number | null;
  attributes?: {
    hp: number | null;
    resource: { name: string; value: number } | null;
    list: { name: string; group: string; value: number }[];
  };
  levelCap?: number;
  avatar: string | null;
  portrait: string | null;
  activeJob: { icon: string | null; level: number | null };
  jobs: FfxivJob[];
  fieldOperations: {
    bozja: { name: string; level: number | null; mettle: number | null } | null;
    eureka: { name: string; level: number | null; exp: { current: number | null; max: number | null } | null } | null;
  };
  achievements: {
    public: boolean;
    total: number | null;
    points: number | null;
    recent: { id: number | null; name: string; time: string | null }[];
    pages?: number;
    pagesRead?: number;
    listed?: number;
  };
  mounts: FfxivCollection;
  minions: FfxivCollection;
}

export interface Gw2Gear {
  buildName: string | null;
  gearName: string | null;
  buildTabs: number | null;
  gearTabs: number | null;
  specializations: { id: number; traits: number[] }[];
  skills: { heal: number | null; utilities: (number | null)[]; elite: number | null } | null;
  legends: string[] | null;
  pets: number[] | null;
  equipment: { slot: string; id: number }[];
  bags: { bags: number; slots: number; used: number } | null;
}

export interface Gw2Character {
  name: string;
  race: string | null;
  gender: string | null;
  profession: string | null;
  icon: string | null;
  level: number | null;
  hours: number;
  deaths: number;
  created: string | null;
  lastPlayed: string | null;
  crafting: { discipline: string; rating: number; active: boolean }[];
  /** Missing on data read before gear was added. */
  gear?: Gw2Gear;
}

export interface Gw2Thing {
  id: number;
  name: string;
  icon: string | null;
}

export interface Gw2CharacterDetails {
  equipment: {
    slot: string;
    name: string;
    icon: string | null;
    skin: string | null;
    rarity: string | null;
    level: number | null;
    stats: string | null;
    upgrades: (Gw2Thing | null)[];
    infusions: (Gw2Thing | null)[];
  }[];
  specializations: (Gw2Thing & { elite: boolean; traits: (Gw2Thing | null)[] })[];
  skills: { heal: Gw2Thing | null; utilities: (Gw2Thing | null)[]; elite: Gw2Thing | null } | null;
}

export interface Gw2Done {
  name: string;
  done: boolean;
}

export interface Gw2Vault {
  current: number | null;
  complete: number | null;
  claimed: boolean;
  objectives: { title: string; track: string; acclaim: number; progress: number; complete: number; claimed: boolean }[];
}

export interface Gw2Value {
  buy: number;
  sell: number;
  parts: { label: string; buy: number; sell: number; stacks: number }[];
  top: {
    id: number;
    name: string;
    icon: string | null;
    rarity: string | null;
    count: number;
    buy: number;
    sell: number;
  }[];
  tp: { selling: { count: number; value: number }; buying: { count: number; value: number } };
}

export interface Gw2Account {
  id: string;
  name: string;
  world: string | null;
  created: string | null;
  hours: number | null;
  commander: boolean;
  fractalLevel: number | null;
  wvwRank: number | null;
  wvwTitle?: string | null;
  expansions: string[];
  guilds: { name: string; tag: string }[];
  permissions: string[];
  /** null: the key has no "characters" permission. */
  characters: Gw2Character[] | null;
  mastery: { region: string; earned: number; spent: number }[] | null;
  masteryTracks?: { name: string; region: string; level: number; max: number | null }[] | null;
  achievementsDone: number | null;
  ap?: { total: number; fromAchievements: number; daily: number; monthly: number } | null;
  achievementGroups?:
    | {
        name: string;
        categories: { id: number; name: string; icon: string | null; done: number; total: number }[];
      }[]
    | null;
  nearlyDone?:
    | {
        id: number;
        name: string;
        requirement: string;
        current: number;
        max: number;
        points: number;
        icon: string | null;
      }[]
    | null;
  luck: number | null;
  progression?: { name: string; value: number }[] | null;
  wallet: { id: number; name: string; icon: string | null; value: number }[] | null;
  pvp: {
    rank: number;
    wins: number;
    losses: number;
    desertions?: number;
    byes?: number;
    forfeits?: number;
    ladders?: { name: string; wins: number; losses: number }[];
    professions?: { name: string; icon: string | null; wins: number; losses: number }[];
    games?: {
      id: string;
      map: number;
      started: string;
      ended: string;
      result: string;
      team: string;
      profession: string;
      scores: { red: number; blue: number } | null;
      type: string | null;
      ratingChange: number | null;
    }[];
    standing?: {
      season: string;
      rating: number | null;
      division: number | null;
      tier: number | null;
      best: number | null;
    } | null;
  } | null;
  mounts: { owned: string[]; total: number | null } | null;
  collections: { label: string; owned: number; total: number | null }[];
  legendaries?: { id: number; count: number; name: string; icon: string | null; type: string | null }[] | null;
  weekly?: {
    raids: { name: string; wings: { name: string; events: (Gw2Done & { boss: boolean })[] }[] }[] | null;
    dungeons: { name: string; paths: Gw2Done[] }[] | null;
    worldBosses: Gw2Done[] | null;
    mapChests: Gw2Done[] | null;
    crafting: Gw2Done[] | null;
    vault: { daily: Gw2Vault | null; weekly: Gw2Vault | null; special: Gw2Vault | null };
    home: {
      nodes: { owned: number; total: number | null } | null;
      cats: { owned: number; total: number | null } | null;
    };
  } | null;
  value?: Gw2Value | null;
}

export interface Gw2Snapshot {
  hours: number | null;
  ap: number | null;
  achievements: number | null;
  coins: number | null;
  valueBuy: number | null;
  valueSell: number | null;
  fractal: number | null;
  wvwRank: number | null;
  pvpRank: number | null;
  luck: number | null;
  masteryPoints: number | null;
  legendaries: number | null;
  skins: number | null;
  characters: number | null;
}

export interface LolMatch {
  id: string;
  queue: string;
  queueId: number;
  end: string;
  minutes: number;
  championId: number;
  champion: string;
  image: string | null;
  role: string | null;
  win: boolean;
  remake: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damage: number;
  gold: number;
  vision?: number;
  /** Kill participation, 0-1. */
  kp?: number | null;
  /** Biggest multikill: 0, or 2 (double) to 5 (penta). */
  multikill?: number;
  /** Arena placement. */
  placement?: number | null;
  /** Item pictures, slots 0-6 (6 is the trinket). */
  items?: (string | null)[];
}

export interface LolRank {
  queue: 'Solo/Duo' | 'Flex';
  tier: string;
  division: string;
  lp: number;
  wins: number;
  losses: number;
  hotStreak: boolean;
  veteran?: boolean;
  freshBlood?: boolean;
  /** Promotion series progress such as "WLN", when in one. */
  series?: string | null;
}

export interface LolMastery {
  championId: number;
  name: string;
  image: string | null;
  level: number;
  points: number;
  sinceLevel?: number | null;
  untilLevel?: number | null;
  marks?: number | null;
  milestone?: number | null;
  lastPlayed: string | null;
}

export interface LolChallenge {
  id: number;
  name: string;
  description: string;
  level: string;
  value: number;
  percentile: number | null;
  achieved: string | null;
  next: { level: string; value: number } | null;
}

export interface LolPlayer {
  puuid: string;
  platform: string;
  gameName: string;
  tagLine: string;
  level: number | null;
  icon: string | null;
  ranked: LolRank[];
  mastery: {
    score: number | null;
    champions: number;
    points: number;
    /** Every champion played, highest mastery first. */
    top: LolMastery[];
  };
  challenges: {
    level: string | null;
    points: number;
    max: number | null;
    percentile: number | null;
    categories: {
      name: string;
      level: string | null;
      points: number;
      max: number | null;
      percentile?: number | null;
    }[];
    list?: LolChallenge[];
  } | null;
  live: { queue: string; champion: string | null; image: string | null; since: string | null } | null;
  /** The 20 most recent archived matches. */
  matches: LolMatch[];
  archive?: { count: number; complete: boolean; backfilledAt: string | null };
}

export interface LolThing {
  id: number;
  name: string;
  image: string | null;
}

export interface LolMatchPlayer {
  me: boolean;
  name: string | null;
  tag: string | null;
  championId: number;
  champion: string;
  image: string | null;
  lvl: number | null;
  team: number;
  role: string | null;
  win: boolean;
  remake: boolean;
  k: number;
  d: number;
  a: number;
  cs: number;
  gold: number;
  dmg: number;
  taken: number;
  mitigated: number;
  heal: number;
  shield: number;
  vision: number;
  wards: number;
  wardsKilled: number;
  pinks: number;
  items: (LolThing | null)[];
  spells: (LolThing | null)[];
  runes: { primary: LolThing | null; secondary: LolThing | null; list: (LolThing | null)[]; shards: string[] } | null;
  multi: [number, number, number, number];
  spree: number;
  fb: boolean;
  cc: number;
  towers: number;
  objectives: number;
  kp: number | null;
  dmgShare: number | null;
  solo: number;
  placement: number | null;
}

export interface LolMatchDetail {
  id: string;
  queue: string;
  queueId: number;
  end: string;
  seconds: number;
  version: string | null;
  teams: { id: number; win: boolean; bans: (LolThing & { id: number })[]; obj: Record<string, number> }[];
  players: LolMatchPlayer[];
}

export type LolEvent =
  | { at: number; type: 'kill'; by: number; victim: number; assists: number[] }
  | { at: number; type: 'monster'; by: number; team: number; monster: string }
  | { at: number; type: 'building'; by: number; team: number; building: string; lane: string }
  | { at: number; type: 'item'; by: number; item: number }
  | { at: number; type: 'skill'; by: number; skill: number };

/** Per minute, one value per player in the match's player order. */
export interface LolTimeline {
  gold: number[][];
  cs: number[][];
  xp: number[][];
  level: number[][];
  events: LolEvent[];
  items: Record<string, { name: string; image: string | null }>;
}

export interface LolGroupStats {
  games: number;
  wins: number;
  k: number;
  d: number;
  a: number;
  cs: number;
  minutes: number;
  dmg: number;
  gold: number;
  vision: number;
  kp: number | null;
  pentas: number;
  last: string | null;
}

export interface LolChampionStats {
  games: number;
  champions: (LolGroupStats & { championId: number; name: string; image: string | null })[];
  roles: (LolGroupStats & { role: string })[];
  queues: (LolGroupStats & { queueId: number; name: string })[];
}

export interface LolLive {
  queue: string;
  since: string | null;
  bans: { team: number; name: string; image: string | null }[];
  players: {
    me: boolean;
    name: string | null;
    tag: string | null;
    team: number;
    bot: boolean;
    championId: number;
    champion: string;
    image: string | null;
    spells: (LolThing | null)[];
    keystone: LolThing | null;
    secondary: LolThing | null;
    rank: { tier: string; division: string; lp: number; wins: number; losses: number } | null;
  }[];
}

export interface Snapshot<T> {
  day: string;
  data: T;
}

export interface LolSnapshot {
  level: number | null;
  solo: number | null;
  flex: number | null;
  soloGames: number | null;
  mastery: number | null;
  masteryPoints: number | null;
  champions: number | null;
  challenges: number | null;
  matches: number | null;
}

export interface GameConnection<T = FfxivCharacter> {
  game: GameStatsId;
  externalId: string;
  name: string;
  data: T;
  fetchedAt: string;
}

export interface FfxivSearchResult {
  id: string;
  name: string;
  world: string | null;
  dataCenter: string | null;
  avatar: string | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch {
    throw new Error("Can't reach the Savepoint server.");
  }
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Failed (${r.status}).`);
  return data as T;
}

export async function fetchGameConnections(): Promise<GameConnection<unknown>[]> {
  return (await call<{ connections: GameConnection<unknown>[] }>('/api/games/connections')).connections;
}

export async function searchFfxivCharacters(name: string, world: string): Promise<FfxivSearchResult[]> {
  const qs = new URLSearchParams({ name, ...(world.trim() ? { world: world.trim() } : {}) });
  return (await call<{ results: FfxivSearchResult[] }>(`/api/games/ffxiv/search?${qs}`)).results;
}

/** `character` is a Lodestone character link or ID. */
export function connectFfxiv(character: string): Promise<GameConnection> {
  return call('/api/games/ffxiv/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character }),
  });
}

export function refreshFfxiv(): Promise<GameConnection> {
  return call('/api/games/ffxiv/refresh', { method: 'POST' });
}

export async function disconnectFfxiv(): Promise<void> {
  await call('/api/games/ffxiv', { method: 'DELETE' });
}

export function fetchFfxivAchievements(): Promise<{
  achievements: { id: number | null; name: string; time: string | null }[];
  complete: boolean;
}> {
  return call('/api/games/ffxiv/achievements');
}

export const lodestoneUrl = (id: string) => `https://na.finalfantasyxiv.com/lodestone/character/${id}/`;

/** `key` is an API key from https://account.arena.net/applications. */
export function connectGw2(key: string): Promise<GameConnection<Gw2Account>> {
  return call('/api/games/gw2/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

export function refreshGw2(): Promise<GameConnection<Gw2Account>> {
  return call('/api/games/gw2/refresh', { method: 'POST' });
}

export function fetchGw2Character(name: string): Promise<Gw2CharacterDetails> {
  return call(`/api/games/gw2/characters/${encodeURIComponent(name)}`);
}

export async function disconnectGw2(): Promise<void> {
  await call('/api/games/gw2', { method: 'DELETE' });
}

/** "5 min ago", "3 h ago", or the date. */
export function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fetchLolSetup(): Promise<{ configured: boolean; regions: { value: string; label: string }[] }> {
  return call('/api/games/lol/setup');
}

export function connectLol(riotId: string, region: string): Promise<GameConnection<LolPlayer>> {
  return call('/api/games/lol/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ riotId, region }),
  });
}

export function refreshLol(): Promise<GameConnection<LolPlayer>> {
  return call('/api/games/lol/refresh', { method: 'POST' });
}

export async function disconnectLol(): Promise<void> {
  await call('/api/games/lol', { method: 'DELETE' });
}

export function fetchLolMatches(opts: {
  before?: string;
  queue?: number | null;
  champion?: number | null;
  limit?: number;
}): Promise<{ matches: LolMatch[]; more: boolean }> {
  const qs = new URLSearchParams();
  if (opts.before) qs.set('before', opts.before);
  if (opts.queue) qs.set('queue', String(opts.queue));
  if (opts.champion) qs.set('champion', String(opts.champion));
  if (opts.limit) qs.set('limit', String(opts.limit));
  return call(`/api/games/lol/matches?${qs}`);
}

export function fetchLolMatch(id: string): Promise<LolMatchDetail> {
  return call(`/api/games/lol/matches/${encodeURIComponent(id)}`);
}

export function fetchLolTimeline(id: string): Promise<LolTimeline> {
  return call(`/api/games/lol/matches/${encodeURIComponent(id)}/timeline`);
}

export function fetchLolChampions(queue?: number | null): Promise<LolChampionStats> {
  return call(`/api/games/lol/champions${queue ? `?queue=${queue}` : ''}`);
}

export async function fetchLolLive(): Promise<LolLive | null> {
  return (await call<{ live: LolLive | null }>('/api/games/lol/live')).live;
}

export async function backfillLol(): Promise<NonNullable<LolPlayer['archive']>> {
  return (await call<{ archive: NonNullable<LolPlayer['archive']> }>('/api/games/lol/backfill', { method: 'POST' }))
    .archive;
}

export async function fetchGameHistory<T>(game: GameStatsId): Promise<Snapshot<T>[]> {
  return (await call<{ days: Snapshot<T>[] }>(`/api/games/${game}/history`)).days;
}

// ---------------------------------------------------------------- Counter-Strike 2 and Dota 2 (server/steamGames.mjs)

export interface Cs2Leetify {
  name: string | null;
  winrate: number | null;
  matches: number | null;
  since: string | null;
  premier: number | null;
  faceit: number | null;
  faceitElo: number | null;
  wingman: number | null;
  renown: number | null;
  leetify: number | null;
  competitive: { map: string; rank: number }[];
  ratings: {
    aim: number | null;
    positioning: number | null;
    utility: number | null;
    clutch: number | null;
    opening: number | null;
    ct: number | null;
    t: number | null;
  } | null;
  aim: {
    headshot: number | null;
    spotted: number | null;
    spray: number | null;
    preaim: number | null;
    reaction: number | null;
    counterStrafe: number | null;
  } | null;
  recent: {
    id: string;
    at: string;
    source: string;
    outcome: string;
    map: string;
    score: [number, number] | null;
    rating: number | null;
    rank: number | null;
    rankType: number | null;
  }[];
  url: string;
}

export interface Cs2Data {
  steamId: string;
  hours: number | null;
  hoursTwoWeeks: number | null;
  lifetime: {
    kills: number;
    deaths: number;
    kd: number | null;
    headshots: number | null;
    accuracy: number | null;
    roundsWon: number;
    rounds: number;
    matchesWon: number;
    matches: number;
    mvps: number;
    damage: number;
    money: number;
    planted: number;
    defused: number;
    hostages: number;
    knifeKills: number;
    enemyWeaponKills: number;
    blinded: number;
    zoomedSnipers: number;
    dominations: number;
    revenges: number;
    timePlayed: number | null;
  } | null;
  weapons: { key: string; name: string; kills: number; accuracy: number | null }[];
  maps: { key: string; name: string; rounds: number; wins: number }[];
  lastMatch: {
    kills: number;
    deaths: number;
    mvps: number;
    damage: number;
    roundsWon: number;
    rounds: number;
    money: number;
  } | null;
  leetify: Cs2Leetify | null;
}

export interface Cs2Snapshot {
  premier: number | null;
  faceitElo: number | null;
  leetify: number | null;
  hours: number | null;
  kills: number | null;
  kd: number | null;
}

export interface DotaHero {
  id: number;
  name: string;
  image: string | null;
}

export interface DotaData {
  steamId: string;
  accountId: string;
  name: string | null;
  avatar: string | null;
  plus: boolean;
  medal: { tier: number; name: string | null; stars: number | null; leaderboard: number | null } | null;
  wins: number;
  losses: number;
  winRate: number | null;
  heroes: (DotaHero & { games: number; wins: number; winRate: number | null; lastPlayed: string | null })[];
  totals: {
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    kda: number | null;
    gpm: number | null;
    xpm: number | null;
    lastHits: number | null;
    denies: number | null;
    heroDamage: number | null;
    towerDamage: number | null;
    healing: number | null;
    hours: number | null;
  };
  recent: {
    id: string;
    at: string;
    hero: DotaHero;
    won: boolean;
    kills: number;
    deaths: number;
    assists: number;
    minutes: number;
    mode: string;
    ranked: boolean;
    gpm: number | null;
    xpm: number | null;
    lastHits: number | null;
    heroDamage: number | null;
  }[];
  url: string;
}

export interface DotaSnapshot {
  rankTier: number | null;
  wins: number;
  losses: number;
  winRate: number | null;
}

/** Reads the linked Steam account's stats for the first time. */
export function connectSteamGame<T>(game: 'cs2' | 'dota2'): Promise<GameConnection<T>> {
  return call(`/api/games/${game}/connect`, { method: 'POST' });
}

export function refreshSteamGame<T>(game: 'cs2' | 'dota2'): Promise<GameConnection<T>> {
  return call(`/api/games/${game}/refresh`, { method: 'POST' });
}

export async function disconnectSteamGame(game: 'cs2' | 'dota2'): Promise<void> {
  await call(`/api/games/${game}`, { method: 'DELETE' });
}
