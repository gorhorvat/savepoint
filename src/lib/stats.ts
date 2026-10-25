import type { AchievementProgress, PhysicalItem, PhysicalPlatform, PlatformId, PlayLogEntry, Progress } from '../types';
import { platformTotals, type LibraryGame } from './library';

export interface Share {
  label: string;
  minutes: number;
  games: number;
}

export interface Stats {
  totalMinutes: number;
  /** Games with any play time (apps excluded). */
  gamesPlayed: number;
  averageMinutes: number;
  medianMinutes: number;
  appMinutes: number;
  appCount: number;
  platforms: Record<PlatformId, number>;
  /** Hours split evenly across each game's genres, so shares add up to the total. */
  genres: Share[];
  subgenres: Share[];
  developers: Share[];
  decades: Share[];
  top: LibraryGame[];
  /** Share of all play time in the five most-played games, 0..1. */
  topFiveShare: number;
  /** Games by total hours: under 1 h, 1-5, 5-20, 20-50, 50-100, 100+. */
  depth: { label: string; games: number }[];
  year: {
    year: number;
    /** Games last played this year. */
    played: LibraryGame[];
    /** Games by the month they were last played (this year). */
    byMonth: number[];
    /** Lifetime hours of the games played this year. */
    minutes: number;
    /**
     * Hours recorded since tracking began (only what changed between syncs;
     * platforms report lifetime totals, so earlier hours can't be dated).
     */
    recorded?: { since: string; minutes: number };
    /** Real hours per month this year: only once tracking covers the whole year. */
    tracked?: {
      since: string;
      minutes: number;
      byMonth: number[];
      top: { item: LibraryGame; minutes: number }[];
    };
  };
  /** Finished/completed games, by status set per game. */
  finishedThisYear: number;
  achievements: { earned: number; total: number; platinums: number; perfect: number; games: number };
  collection: {
    copies: number;
    byPlatform: { platform: PhysicalPlatform; copies: number }[];
    spent: number;
    unplayed: LibraryGame[];
  };
}

function addShare(map: Map<string, Share>, label: string, minutes: number) {
  const s = map.get(label) ?? { label, minutes: 0, games: 0 };
  s.minutes += minutes;
  s.games += 1;
  map.set(label, s);
}

const byMinutes = (a: Share, b: Share) => b.minutes - a.minutes;

export interface StatsInput {
  log?: PlayLogEntry[];
  since?: string;
  progress?: Record<string, Progress>;
  achievements?: Record<string, Partial<Record<PlatformId, AchievementProgress>>>;
}

export function computeStats(
  all: LibraryGame[],
  physical: PhysicalItem[],
  { log = [], since, progress = {}, achievements = {} }: StatsInput = {},
  now = new Date(),
): Stats {
  const apps = all.filter((l) => l.isApp);
  const games = all.filter((l) => !l.isApp);
  const played = games.filter((l) => l.totalMinutes > 0);
  const totalMinutes = played.reduce((n, l) => n + l.totalMinutes, 0);
  const sorted = [...played].sort((a, b) => b.totalMinutes - a.totalMinutes);
  const mid = sorted.length / 2;
  const medianMinutes = !sorted.length
    ? 0
    : sorted.length % 2
      ? sorted[Math.floor(mid)].totalMinutes
      : (sorted[mid - 1].totalMinutes + sorted[mid].totalMinutes) / 2;

  const genres = new Map<string, Share>();
  const subgenres = new Map<string, Share>();
  const developers = new Map<string, Share>();
  const decades = new Map<string, Share>();
  for (const l of played) {
    const g = l.game.genres.length ? l.game.genres : ['No genre yet'];
    for (const name of g) addShare(genres, name, l.totalMinutes / g.length);
    const s = l.game.subgenres;
    for (const name of s) addShare(subgenres, name, l.totalMinutes / s.length);
    if (l.game.developer) addShare(developers, l.game.developer, l.totalMinutes);
    if (l.game.year) addShare(decades, `${Math.floor(l.game.year / 10) * 10}s`, l.totalMinutes);
  }

  const buckets = [
    { label: 'Under 1 h', max: 60 },
    { label: '1–5 h', max: 300 },
    { label: '5–20 h', max: 1200 },
    { label: '20–50 h', max: 3000 },
    { label: '50–100 h', max: 6000 },
    { label: '100 h+', max: Infinity },
  ];
  const depth = buckets.map((b, i) => ({
    label: b.label,
    games: played.filter((l) => l.totalMinutes < b.max && l.totalMinutes >= (i ? buckets[i - 1].max : 0)).length,
  }));

  const year = now.getFullYear();
  const thisYear = played.filter((l) => l.lastPlayed && new Date(l.lastPlayed).getFullYear() === year);
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const l of thisYear) byMonth[new Date(l.lastPlayed!).getMonth()] += 1;

  const prefix = `${year}-`;
  const yearLog = log.filter((l) => l.date.startsWith(prefix));
  let tracked: Stats['year']['tracked'];
  // A year's hours are only real if tracking began by its first week; a
  // partial year would show a few days as if they were the whole year.
  const coversYear = !!since && since.slice(0, 10) <= `${year}-01-07`;
  const recordedMinutes = log.filter((l) => !since || l.date >= since.slice(0, 10)).reduce((n, l) => n + l.minutes, 0);
  if (since && coversYear && yearLog.length) {
    const byId = new Map(all.map((l) => [l.game.id, l]));
    const perGame = new Map<string, number>();
    const monthly = Array.from({ length: 12 }, () => 0);
    for (const l of yearLog) {
      const item = byId.get(l.gameId);
      if (!item || item.isApp) continue;
      monthly[Number(l.date.slice(5, 7)) - 1] += l.minutes;
      perGame.set(l.gameId, (perGame.get(l.gameId) ?? 0) + l.minutes);
    }
    tracked = {
      since,
      minutes: monthly.reduce((a, b) => a + b, 0),
      byMonth: monthly,
      top: [...perGame]
        .map(([id, minutes]) => ({ item: byId.get(id)!, minutes }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 5),
    };
  }

  const ach = { earned: 0, total: 0, platinums: 0, perfect: 0, games: 0 };
  for (const perPlatform of Object.values(achievements)) {
    for (const a of Object.values(perPlatform)) {
      if (!a?.total) continue;
      ach.games++;
      ach.earned += a.earned;
      ach.total += a.total;
      if (a.platinum) ach.platinums++;
      if (a.earned >= a.total) ach.perfect++;
    }
  }

  const copiesBy = new Map<PhysicalPlatform, number>();
  for (const p of physical) copiesBy.set(p.platform, (copiesBy.get(p.platform) ?? 0) + 1);

  return {
    totalMinutes,
    gamesPlayed: played.length,
    averageMinutes: played.length ? totalMinutes / played.length : 0,
    medianMinutes,
    appMinutes: apps.reduce((n, l) => n + l.totalMinutes, 0),
    appCount: apps.length,
    platforms: platformTotals(played),
    genres: [...genres.values()].sort(byMinutes),
    subgenres: [...subgenres.values()].sort(byMinutes),
    developers: [...developers.values()].sort(byMinutes),
    decades: [...decades.values()].sort((a, b) => a.label.localeCompare(b.label)),
    top: sorted.slice(0, 10),
    topFiveShare: totalMinutes ? sorted.slice(0, 5).reduce((n, l) => n + l.totalMinutes, 0) / totalMinutes : 0,
    depth,
    year: {
      year,
      played: [...thisYear].sort((a, b) => b.totalMinutes - a.totalMinutes),
      byMonth,
      minutes: thisYear.reduce((n, l) => n + l.totalMinutes, 0),
      recorded: since ? { since, minutes: recordedMinutes } : undefined,
      tracked,
    },
    finishedThisYear: Object.values(progress).filter(
      (p) => (p.status === 'finished' || p.status === 'completed') && p.finishedAt?.startsWith(prefix),
    ).length,
    achievements: ach,
    collection: {
      copies: physical.length,
      byPlatform: [...copiesBy].map(([platform, copies]) => ({ platform, copies })).sort((a, b) => b.copies - a.copies),
      spent: physical.reduce((n, p) => n + (p.pricePaid ?? 0), 0),
      unplayed: games.filter((l) => l.physical.length && l.totalMinutes === 0),
    },
  };
}
