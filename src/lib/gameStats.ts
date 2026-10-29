// Game-specific stats (My Stats, a tab per game): FINAL FANTASY XIV, read by
// the server from the character's public Lodestone pages; Guild Wars 2, read
// from ArenaNet's API with the account's own API key; League of Legends, from
// Riot's API with the app's key and the player's Riot ID.
import type { GameStatsId } from './store';

export const STATS_GAMES: { id: GameStatsId; name: string; short: string }[] = [
  { id: 'ffxiv', name: 'FINAL FANTASY XIV Online', short: 'FFXIV' },
  { id: 'gw2', name: 'Guild Wars 2', short: 'GW2' },
  { id: 'lol', name: 'League of Legends', short: 'LoL' },
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
  freeCompany: { id: string | number | null; name: string } | null;
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
  };
  mounts: FfxivCollection;
  minions: FfxivCollection;
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
  expansions: string[];
  guilds: { name: string; tag: string }[];
  permissions: string[];
  /** null: the key has no "characters" permission. */
  characters: Gw2Character[] | null;
  mastery: { region: string; earned: number; spent: number }[] | null;
  achievementsDone: number | null;
  luck: number | null;
  wallet: { id: number; name: string; icon: string | null; value: number }[] | null;
  pvp: { rank: number; wins: number; losses: number } | null;
  mounts: { owned: string[]; total: number | null } | null;
  collections: { label: string; owned: number; total: number | null }[];
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
