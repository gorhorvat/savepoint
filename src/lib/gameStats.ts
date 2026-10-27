// Game-specific stats (My Stats, a tab per game): FINAL FANTASY XIV, read by
// the server from the character's public Lodestone pages, and Guild Wars 2,
// read from ArenaNet's API with the account's own API key.
import type { GameStatsId } from './store';

export const STATS_GAMES: { id: GameStatsId; name: string; short: string }[] = [
  { id: 'ffxiv', name: 'FINAL FANTASY XIV Online', short: 'FFXIV' },
  { id: 'gw2', name: 'Guild Wars 2', short: 'GW2' },
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
