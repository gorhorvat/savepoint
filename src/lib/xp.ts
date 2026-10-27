import { useMemo } from 'react';
import type { AchievementProgress, Game, PlatformId, PlayEntry } from '../types';
import { isApp } from './apps';
import { resolveGame, useStore } from './store';

// Savepoint XP: earned only from things a platform confirms through its API.
// - PlayStation trophies use Sony's own level points per grade.
// - Steam achievements have no grades, so each is worth the same, and
//   completing every achievement in a game earns a platinum-sized bonus.
// - Xbox achievements are worth their gamerscore (a full game is 1,000 G,
//   close to what a platinum PlayStation game earns).
// - Play time counts only when Steam, PlayStation or Xbox reported it; hours
//   added by hand (Switch, Epic) and non-game apps earn nothing.

export const XP = {
  bronze: 15,
  silver: 30,
  gold: 90,
  platinum: 300,
  /** A PlayStation trophy from before grades were saved: roughly the average. */
  ungradedTrophy: 25,
  steamAchievement: 20,
  steamPerfect: 300,
  perGamerscore: 1,
  perHour: 10,
} as const;

const CONFIRMED_SOURCES = new Set<PlayEntry['source']>(['steam', 'psn', 'xbox']);

export interface XpBreakdown {
  total: number;
  trophies: { bronze: number; silver: number; gold: number; platinum: number; ungraded: number; xp: number };
  steam: { achievements: number; perfectGames: number; xp: number };
  xbox: { achievements: number; gamerscore: number; xp: number };
  hours: { confirmed: number; unconfirmed: number; xp: number };
}

export interface Level {
  level: number;
  /** XP gathered towards the next level, and what that level needs. */
  into: number;
  needed: number;
  rank: string;
}

/** XP to go from `level` to the next: each level asks a little more than the last. */
export const xpToNext = (level: number) => Math.round(100 * Math.pow(level, 1.2));

const RANKS: [minLevel: number, name: string][] = [
  [90, 'Legend'],
  [70, 'Master'],
  [50, 'Elite'],
  [35, 'Veteran'],
  [20, 'Seasoned'],
  [10, 'Regular'],
  [1, 'Newcomer'],
];

export const rankFor = (level: number) => RANKS.find(([min]) => level >= min)![1];

/** The next rank up and the level it starts at, or nothing at the top. */
export function nextRank(level: number): { name: string; level: number } | undefined {
  const next = [...RANKS].reverse().find(([min]) => min > level);
  return next && { name: next[1], level: next[0] };
}

export function levelFor(total: number): Level {
  let level = 1;
  let rest = total;
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, needed: xpToNext(level), rank: rankFor(level) };
}

export function computeXp(
  entries: PlayEntry[],
  achievements: Record<string, Partial<Record<PlatformId, AchievementProgress>>>,
  gameOf: (id: string) => Game | undefined,
): XpBreakdown {
  const isGame = (id: string) => {
    const g = gameOf(id);
    return !!g && !isApp(g);
  };

  const trophies = { bronze: 0, silver: 0, gold: 0, platinum: 0, ungraded: 0, xp: 0 };
  const steam = { achievements: 0, perfectGames: 0, xp: 0 };
  const xbox = { achievements: 0, gamerscore: 0, xp: 0 };
  for (const [id, per] of Object.entries(achievements)) {
    if (!isGame(id)) continue;
    const ps = per.playstation;
    if (ps?.grades) {
      trophies.bronze += ps.grades.bronze;
      trophies.silver += ps.grades.silver;
      trophies.gold += ps.grades.gold;
      trophies.platinum += ps.grades.platinum;
    } else if (ps?.earned) {
      const plat = ps.platinum ? 1 : 0;
      trophies.platinum += plat;
      trophies.ungraded += ps.earned - plat;
    }
    const st = per.steam;
    if (st?.earned) {
      steam.achievements += st.earned;
      if (st.total > 0 && st.earned === st.total) steam.perfectGames++;
    }
    const xb = per.xbox;
    if (xb) {
      xbox.achievements += xb.earned;
      xbox.gamerscore += xb.gamerscore ?? 0;
    }
  }
  trophies.xp =
    trophies.bronze * XP.bronze +
    trophies.silver * XP.silver +
    trophies.gold * XP.gold +
    trophies.platinum * XP.platinum +
    trophies.ungraded * XP.ungradedTrophy;
  steam.xp = steam.achievements * XP.steamAchievement + steam.perfectGames * XP.steamPerfect;
  xbox.xp = xbox.gamerscore * XP.perGamerscore;

  let confirmed = 0;
  let unconfirmed = 0;
  for (const e of entries) {
    if (!isGame(e.gameId)) continue;
    if (CONFIRMED_SOURCES.has(e.source)) confirmed += e.minutes;
    else unconfirmed += e.minutes;
  }
  const hours = {
    confirmed: confirmed / 60,
    unconfirmed: unconfirmed / 60,
    xp: Math.floor(confirmed / 60) * XP.perHour,
  };

  return { total: trophies.xp + steam.xp + xbox.xp + hours.xp, trophies, steam, xbox, hours };
}

/** Your XP and level, from your own data. */
export function useXp(): XpBreakdown & Level {
  const entries = useStore((s) => s.entries);
  const achievements = useStore((s) => s.achievements);
  const customGames = useStore((s) => s.customGames);
  const overrides = useStore((s) => s.genreOverrides);
  const details = useStore((s) => s.details);
  return useMemo(() => {
    const xp = computeXp(entries, achievements, (id) => resolveGame(id, customGames, overrides, details));
    return { ...xp, ...levelFor(xp.total) };
  }, [entries, achievements, customGames, overrides, details]);
}
