// Comparing a game's stats with someone else (server/compare.mjs): a friend on
// Savepoint, or any player found by name where the game allows it. Every game
// lists its headline metrics here; the generic view shows them side by side,
// and a game can add its own sections (src/components/compare/*).
import { coinText } from '../components/gw2/format';
import { ladderName, TIERS } from '../components/lol/format';
import type {
  Cs2Data,
  Cs2Snapshot,
  DotaData,
  DotaSnapshot,
  FfxivCharacter,
  FfxivSnapshot,
  Gw2Account,
  Gw2Snapshot,
  LolPlayer,
  LolRank,
  LolSnapshot,
  Snapshot,
  WowData,
  WowSnapshot,
} from './gameStats';
import type { GameStatsId } from './store';

export interface CompareFriend {
  id: number;
  username: string;
  avatar: string | null;
  /** Their character or account name in the game. */
  name: string | null;
  fetchedAt: string | null;
}

export interface LookupResult {
  id: string;
  name: string;
  note: string;
  avatar: string | null;
}

export interface Side<T = unknown> {
  id: string;
  name: string | null;
  data: T;
  fetchedAt: string | null;
}

export interface Comparison<T = unknown, S = unknown> {
  game: GameStatsId;
  me: Side<T> & { user: { id: number; username: string; avatar: string | null } };
  them: Side<T> &
    ({ kind: 'friend'; user: { id: number; username: string; avatar: string | null } } | { kind: 'lookup' });
  history: { me: Snapshot<S>[]; them: Snapshot<S>[] | null };
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch {
    throw new Error("Can't reach the Savepoint server.");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Failed (${r.status}).`);
  return data as T;
}

export const fetchCompareFriends = (game: GameStatsId) =>
  call<{ lookup: string | null; friends: CompareFriend[] }>(`/api/games/${game}/compare/friends`);

export async function searchPlayers(game: GameStatsId, q: string, world = ''): Promise<LookupResult[]> {
  const qs = new URLSearchParams({ q, ...(world ? { world } : {}) });
  return (await call<{ results: LookupResult[] }>(`/api/games/${game}/compare/search?${qs}`)).results;
}

export const fetchComparison = <T, S>(game: GameStatsId, withWho: string) =>
  call<Comparison<T, S>>(`/api/games/${game}/compare?with=${encodeURIComponent(withWho)}`);

export const setShareStats = (on: boolean) =>
  call<{ shareStats: boolean }>('/api/account/share-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on }),
  });

// ---------------------------------------------------------------- metrics

export interface Metric<T = unknown> {
  key: string;
  label: string;
  /** Tiles are grouped under this heading when set. */
  group?: string;
  value: (data: T) => number | null | undefined;
  format?: (v: number) => string;
  /** Who is ahead: the higher number (default), the lower, or neither (just numbers). */
  better?: 'higher' | 'lower' | 'none';
}

export interface HistoryLine<S = unknown> {
  key: string;
  label: string;
  value: (snapshot: S) => number | null | undefined;
  format?: (v: number) => string;
  tickFormat?: (v: number) => string;
  yTicks?: number[];
}

export interface CompareSpec<T = unknown, S = unknown> {
  /** What a side is called: "character", "account", "player". */
  noun: string;
  /** A line under the name: world, level, region... */
  subtitle: (data: T) => string | null;
  avatar?: (data: T) => string | null;
  metrics: Metric<T>[];
  history: HistoryLine<S>[];
  /** What to type to find someone, for games with a public search. */
  search?: { placeholder: string; extra?: { key: 'world'; label: string; placeholder: string } };
}

const n = (v: number) => v.toLocaleString();
const hours = (v: number) => `${Math.round(v).toLocaleString()} h`;
const pct = (v: number) => `${Math.round(v)}%`;
const one = (v: number) => v.toFixed(1);
const two = (v: number) => v.toFixed(2);

const FFXIV_CAP = (c: FfxivCharacter) => c.levelCap ?? Math.max(100, ...c.jobs.map((j) => j.level));
const LIMITED = new Set(['BLUEMAGE', 'BEASTMASTER']);
const ffxivRole = (j: FfxivCharacter['jobs'][number]) => (LIMITED.has(j.key) ? 'Limited' : j.role);
const combat = (c: FfxivCharacter) => c.jobs.filter((j) => !['Crafter', 'Gatherer', 'Limited'].includes(ffxivRole(j)));
const handLand = (c: FfxivCharacter) => c.jobs.filter((j) => ['Crafter', 'Gatherer'].includes(ffxivRole(j)));

const ffxiv: CompareSpec<FfxivCharacter, FfxivSnapshot> = {
  noun: 'character',
  subtitle: (c) => [c.world, c.dataCenter ? `[${c.dataCenter}]` : null, c.title].filter(Boolean).join(' '),
  avatar: (c) => c.avatar,
  metrics: [
    {
      key: 'combatMaxed',
      label: 'Combat jobs at cap',
      value: (c) => combat(c).filter((j) => j.level >= FFXIV_CAP(c)).length,
    },
    {
      key: 'maxed',
      label: 'Crafters & gatherers at cap',
      value: (c) => handLand(c).filter((j) => j.level >= FFXIV_CAP(c)).length,
    },
    { key: 'levels', label: 'Total job levels', value: (c) => c.jobs.reduce((s, j) => s + j.level, 0) },
    { key: 'itemLevel', label: 'Item level', value: (c) => c.itemLevel },
    { key: 'achievements', label: 'Achievements', value: (c) => (c.achievements.public ? c.achievements.total : null) },
    {
      key: 'points',
      label: 'Achievement points',
      value: (c) => (c.achievements.public ? c.achievements.points : null),
    },
    { key: 'mounts', label: 'Mounts', value: (c) => (c.mounts.public ? c.mounts.count : null) },
    { key: 'minions', label: 'Minions', value: (c) => (c.minions.public ? c.minions.count : null) },
  ],
  history: [
    { key: 'achievements', label: 'Achievements', value: (s) => s.achievements },
    { key: 'points', label: 'Achievement points', value: (s) => s.points },
    { key: 'mounts', label: 'Mounts', value: (s) => s.mounts },
    { key: 'minions', label: 'Minions', value: (s) => s.minions },
    { key: 'itemLevel', label: 'Item level', value: (s) => s.itemLevel },
    { key: 'levels', label: 'Total job levels', value: (s) => s.levels },
    { key: 'combatMaxed', label: 'Combat jobs at cap', value: (s) => s.combatMaxed },
  ],
  search: {
    placeholder: 'Character name',
    extra: { key: 'world', label: 'World', placeholder: 'e.g. Cerberus (optional)' },
  },
};

const gw2: CompareSpec<Gw2Account, Gw2Snapshot> = {
  noun: 'account',
  subtitle: (a) =>
    [a.world, a.created ? `since ${new Date(a.created).getFullYear()}` : null].filter(Boolean).join(' · '),
  metrics: [
    { key: 'hours', label: 'Hours played', value: (a) => a.hours, format: hours },
    { key: 'ap', label: 'Achievement points', value: (a) => a.ap?.total },
    { key: 'achievements', label: 'Achievements done', value: (a) => a.achievementsDone },
    {
      key: 'mastery',
      label: 'Mastery points',
      value: (a) => (a.mastery ? a.mastery.reduce((s, m) => s + m.earned, 0) : null),
    },
    { key: 'fractal', label: 'Fractal level', value: (a) => a.fractalLevel },
    { key: 'wvw', label: 'WvW rank', value: (a) => a.wvwRank },
    { key: 'pvp', label: 'PvP rank', value: (a) => a.pvp?.rank },
    { key: 'legendaries', label: 'Legendaries', value: (a) => a.legendaries?.length },
    { key: 'luck', label: 'Luck', value: (a) => a.luck },
    { key: 'coins', label: 'Wallet gold', value: (a) => a.wallet?.find((w) => w.id === 1)?.value, format: coinText },
    { key: 'value', label: 'Account value (sell)', value: (a) => a.value?.sell, format: coinText },
    { key: 'characters', label: 'Characters', value: (a) => a.characters?.length, better: 'none' },
  ],
  history: [
    { key: 'ap', label: 'Achievement points', value: (s) => s.ap },
    { key: 'achievements', label: 'Achievements done', value: (s) => s.achievements },
    { key: 'hours', label: 'Hours played', value: (s) => s.hours, format: hours },
    { key: 'masteryPoints', label: 'Mastery points', value: (s) => s.masteryPoints },
    { key: 'fractal', label: 'Fractal level', value: (s) => s.fractal },
    { key: 'wvwRank', label: 'WvW rank', value: (s) => s.wvwRank },
    {
      key: 'coins',
      label: 'Wallet gold',
      value: (s) => s.coins,
      format: coinText,
      tickFormat: (v) => `${Math.round(v / 10000).toLocaleString()}g`,
    },
    {
      key: 'valueSell',
      label: 'Account value',
      value: (s) => s.valueSell,
      format: coinText,
      tickFormat: (v) => `${Math.round(v / 10000).toLocaleString()}g`,
    },
  ],
};

const DIVISIONS = ['IV', 'III', 'II', 'I'];
/** The same number the server graphs ranks with: 400 per tier, 100 per division, plus LP. */
function ladder(r: LolRank | undefined): number | null {
  if (!r) return null;
  const t = TIERS.indexOf(r.tier);
  if (t < 0) return null;
  if (t >= 7) return 2800 + r.lp;
  return t * 400 + Math.max(0, DIVISIONS.indexOf(r.division)) * 100 + r.lp;
}
const queue = (p: LolPlayer, q: LolRank['queue']) => p.ranked.find((r) => r.queue === q);
const LADDER_TICKS = Array.from({ length: 29 }, (_, i) => i * 100);

const lol: CompareSpec<LolPlayer, LolSnapshot> = {
  noun: 'player',
  subtitle: (p) => [`#${p.tagLine}`, p.level != null ? `level ${p.level}` : null].filter(Boolean).join(' · '),
  avatar: (p) => p.icon,
  metrics: [
    { key: 'solo', label: 'Solo/Duo', value: (p) => ladder(queue(p, 'Solo/Duo')), format: ladderName },
    { key: 'flex', label: 'Flex', value: (p) => ladder(queue(p, 'Flex')), format: ladderName },
    {
      key: 'soloWinRate',
      label: 'Solo/Duo win rate',
      value: (p) => {
        const r = queue(p, 'Solo/Duo');
        return r && r.wins + r.losses ? (r.wins / (r.wins + r.losses)) * 100 : null;
      },
      format: pct,
    },
    { key: 'level', label: 'Level', value: (p) => p.level },
    { key: 'mastery', label: 'Mastery score', value: (p) => p.mastery.score },
    { key: 'masteryPoints', label: 'Mastery points', value: (p) => p.mastery.points },
    { key: 'champions', label: 'Champions played', value: (p) => p.mastery.champions },
    { key: 'challenges', label: 'Challenge points', value: (p) => p.challenges?.points },
  ],
  history: [
    {
      key: 'solo',
      label: 'Solo/Duo rank',
      value: (s) => s.solo,
      format: ladderName,
      tickFormat: ladderName,
      yTicks: LADDER_TICKS,
    },
    {
      key: 'flex',
      label: 'Flex rank',
      value: (s) => s.flex,
      format: ladderName,
      tickFormat: ladderName,
      yTicks: LADDER_TICKS,
    },
    { key: 'level', label: 'Level', value: (s) => s.level },
    { key: 'mastery', label: 'Mastery score', value: (s) => s.mastery },
    { key: 'masteryPoints', label: 'Mastery points', value: (s) => s.masteryPoints },
    { key: 'challenges', label: 'Challenge points', value: (s) => s.challenges },
  ],
  search: {
    placeholder: 'Riot ID, e.g. Name#EUNE',
    extra: { key: 'world', label: 'Region', placeholder: 'Region, e.g. euw1 (yours when empty)' },
  },
};

const cs2: CompareSpec<Cs2Data, Cs2Snapshot> = {
  noun: 'player',
  subtitle: (d) => (d.leetify?.name ? `Leetify: ${d.leetify.name}` : null),
  metrics: [
    { key: 'premier', label: 'Premier rating', value: (d) => d.leetify?.premier },
    { key: 'faceitElo', label: 'FACEIT Elo', value: (d) => d.leetify?.faceitElo },
    { key: 'leetify', label: 'Leetify rating', value: (d) => d.leetify?.leetify, format: two },
    { key: 'hours', label: 'Hours played', value: (d) => d.hours, format: hours },
    { key: 'kills', label: 'Kills', value: (d) => d.lifetime?.kills },
    { key: 'kd', label: 'K/D', value: (d) => d.lifetime?.kd, format: two },
    {
      key: 'headshots',
      label: 'Headshot %',
      value: (d) =>
        d.lifetime?.headshots != null && d.lifetime.kills ? (d.lifetime.headshots / d.lifetime.kills) * 100 : null,
      format: pct,
    },
    {
      key: 'winRate',
      label: 'Match win rate',
      value: (d) => (d.lifetime?.matches ? (d.lifetime.matchesWon / d.lifetime.matches) * 100 : null),
      format: pct,
    },
    { key: 'mvps', label: 'MVPs', value: (d) => d.lifetime?.mvps },
  ],
  history: [
    { key: 'premier', label: 'Premier rating', value: (s) => s.premier },
    { key: 'faceitElo', label: 'FACEIT Elo', value: (s) => s.faceitElo },
    { key: 'leetify', label: 'Leetify rating', value: (s) => s.leetify, format: two },
    { key: 'kills', label: 'Kills', value: (s) => s.kills },
    { key: 'kd', label: 'K/D', value: (s) => s.kd, format: two },
    { key: 'hours', label: 'Hours played', value: (s) => s.hours, format: hours },
  ],
};

const MEDALS = ['', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'];
const medal = (v: number) => {
  const m = Math.floor(v / 10);
  return MEDALS[m] ? `${MEDALS[m]}${m < 8 && v % 10 ? ` ${v % 10}` : ''}` : 'Uncalibrated';
};

const dota2: CompareSpec<DotaData, DotaSnapshot> = {
  noun: 'player',
  subtitle: (d) => (d.plus ? 'Dota Plus' : null),
  avatar: (d) => d.avatar,
  metrics: [
    { key: 'medal', label: 'Rank', value: (d) => (d.medal ? d.medal.tier : null), format: medal },
    { key: 'wins', label: 'Wins', value: (d) => d.wins },
    { key: 'losses', label: 'Losses', value: (d) => d.losses, better: 'lower' },
    { key: 'winRate', label: 'Win rate', value: (d) => d.winRate, format: pct },
    { key: 'kda', label: 'KDA', value: (d) => d.totals.kda, format: two },
    { key: 'gpm', label: 'GPM', value: (d) => d.totals.gpm },
    { key: 'xpm', label: 'XPM', value: (d) => d.totals.xpm },
    { key: 'hours', label: 'Hours played', value: (d) => d.totals.hours, format: hours },
    { key: 'heroes', label: 'Heroes played', value: (d) => d.heroes.length },
  ],
  history: [
    { key: 'rankTier', label: 'Rank', value: (s) => s.rankTier, format: medal, tickFormat: medal },
    { key: 'wins', label: 'Wins', value: (s) => s.wins },
    { key: 'winRate', label: 'Win rate', value: (s) => s.winRate, format: pct },
  ],
};

const best = (d: WowData, pick: (c: WowData['characters'][number]) => number | null | undefined) => {
  const vals = d.characters.map(pick).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
};
const wowBest = (s: WowSnapshot, key: 'itemLevel' | 'mythic' | 'achievements' | 'mounts') => {
  const vals = Object.values(s.characters ?? {})
    .map((c) => c[key])
    .filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
};

const wow: CompareSpec<WowData, WowSnapshot> = {
  noun: 'account',
  subtitle: (d) => {
    const c = d.characters[0];
    return c
      ? `${d.characters.length} ${d.characters.length === 1 ? 'character' : 'characters'} · ${c.region.toUpperCase()}`
      : null;
  },
  avatar: (d) => d.characters[0]?.images.avatar ?? null,
  metrics: [
    { key: 'itemLevel', label: 'Best item level', value: (d) => best(d, (c) => c.itemLevel) },
    { key: 'mythic', label: 'Best Mythic+ score', value: (d) => best(d, (c) => c.mythic.score), format: one },
    { key: 'achievements', label: 'Achievement points', value: (d) => best(d, (c) => c.achievementPoints) },
    { key: 'mounts', label: 'Mounts', value: (d) => best(d, (c) => c.collections?.mounts) },
    { key: 'pets', label: 'Pets', value: (d) => best(d, (c) => c.collections?.pets) },
    { key: 'toys', label: 'Toys', value: (d) => best(d, (c) => c.collections?.toys) },
    {
      key: 'maxLevel',
      label: 'Characters at max level',
      value: (d) =>
        d.characters.filter((c) => c.level != null && c.level >= Math.max(...d.characters.map((x) => x.level ?? 0)))
          .length,
    },
    { key: 'characters', label: 'Characters', value: (d) => d.characters.length, better: 'none' },
  ],
  history: [
    { key: 'itemLevel', label: 'Best item level', value: (s) => wowBest(s, 'itemLevel') },
    { key: 'mythic', label: 'Best Mythic+ score', value: (s) => wowBest(s, 'mythic'), format: one },
    { key: 'achievements', label: 'Achievement points', value: (s) => wowBest(s, 'achievements') },
    { key: 'mounts', label: 'Mounts', value: (s) => wowBest(s, 'mounts') },
  ],
  search: {
    placeholder: 'Character name',
    extra: { key: 'world', label: 'Realm', placeholder: 'Realm, e.g. Draenor or "us Illidan"' },
  },
};

export const COMPARE: Record<GameStatsId, CompareSpec<never, never>> = {
  ffxiv: ffxiv as CompareSpec<never, never>,
  gw2: gw2 as CompareSpec<never, never>,
  lol: lol as CompareSpec<never, never>,
  cs2: cs2 as CompareSpec<never, never>,
  dota2: dota2 as CompareSpec<never, never>,
  wow: wow as CompareSpec<never, never>,
};

export const formatMetric = (m: { format?: (v: number) => string }, v: number | null | undefined) =>
  v == null ? '—' : (m.format ?? n)(v);

/** -1, 0 or 1: who is ahead on a metric, from the left side's point of view. */
export function ahead(m: Metric<never>, a: number | null | undefined, b: number | null | undefined): -1 | 0 | 1 {
  if (a == null || b == null || a === b || m.better === 'none') return 0;
  const higher = (m.better ?? 'higher') === 'higher';
  return a > b === higher ? 1 : -1;
}
