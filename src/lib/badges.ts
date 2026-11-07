import { notifications } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';
import type { AchievementProgress, PlatformId } from '../types';
import { isApp } from './apps';
import { useQuests } from './quests';
import { resolveGame, useStore } from './store';
import { CONFIRMED_SOURCES, RANKS, useXp } from './xp';

// Badges: small awards for milestones, kept for good once earned. Like XP,
// they only count what platforms confirm (no hours added by hand), and a
// badge only exists for an account that can earn it (no platinum badges
// without PlayStation, no "every platform" badge with only one).

export type BadgeGroup = 'Milestones' | 'Habits' | 'Rarity' | 'Ranks';
export const BADGE_GROUPS: BadgeGroup[] = ['Milestones', 'Habits', 'Rarity', 'Ranks'];

/** Bronze, silver, gold: how hard a badge is to get. */
export type BadgeTier = 1 | 2 | 3;

export type BadgeIconName =
  | 'trophy'
  | 'crown'
  | 'check'
  | 'target'
  | 'clock'
  | 'heart'
  | 'flame'
  | 'map'
  | 'world'
  | 'gem'
  | 'diamond'
  | 'star'
  | 'medal';

interface Facts {
  connected: Set<PlatformId>;
  platinums: number;
  perfectGames: number;
  achievements: number;
  hours: number;
  topGameHours: number;
  ultra: number;
  /** Games at 100% whose rarest achievement fewer than 5% of players have (so fewer than 5% completed it). */
  rareCompletions: number;
  streak: number | null;
  questsDone: number;
  level: number;
  /** Connected platforms that report when you last played (not GOG). */
  playPlatforms: PlatformId[];
  playedThisWeek: number;
}

export interface BadgeDef {
  id: string;
  name: string;
  /** How to earn it, shown while locked. */
  hint: string;
  group: BadgeGroup;
  tier: BadgeTier;
  icon: BadgeIconName;
  /** Whether this account can earn it at all. */
  available?: (f: Facts) => boolean;
  /** What you have and what it takes; null while it can't be told. */
  progress: (f: Facts) => [have: number, need: number] | null;
}

const ACHIEVEMENT_PLATFORMS: PlatformId[] = ['steam', 'playstation', 'xbox', 'epic', 'gog', 'retro'];
const hasAchievements = (f: Facts) => ACHIEVEMENT_PLATFORMS.some((p) => f.connected.has(p));
const hasPlayStation = (f: Facts) => f.connected.has('playstation');

const RANK_ICON: Record<string, BadgeIconName> = {
  Regular: 'medal',
  Seasoned: 'medal',
  Veteran: 'star',
  Elite: 'star',
  Master: 'crown',
  Legend: 'crown',
};

export const BADGES: BadgeDef[] = [
  // Milestones
  {
    id: 'platinum-1',
    name: 'First platinum',
    hint: 'Earn a platinum trophy.',
    group: 'Milestones',
    tier: 1,
    icon: 'trophy',
    available: hasPlayStation,
    progress: (f) => [f.platinums, 1],
  },
  {
    id: 'platinum-10',
    name: 'Platinum shelf',
    hint: 'Earn 10 platinum trophies.',
    group: 'Milestones',
    tier: 3,
    icon: 'trophy',
    available: hasPlayStation,
    progress: (f) => [f.platinums, 10],
  },
  {
    id: 'perfect-1',
    name: 'Completionist',
    hint: 'Get every achievement in a game.',
    group: 'Milestones',
    tier: 1,
    icon: 'check',
    available: hasAchievements,
    progress: (f) => [f.perfectGames, 1],
  },
  {
    id: 'perfect-10',
    name: 'Perfectionist',
    hint: 'Get every achievement in 10 games.',
    group: 'Milestones',
    tier: 2,
    icon: 'check',
    available: hasAchievements,
    progress: (f) => [f.perfectGames, 10],
  },
  {
    id: 'perfect-50',
    name: 'Flawless',
    hint: 'Get every achievement in 50 games.',
    group: 'Milestones',
    tier: 3,
    icon: 'check',
    available: hasAchievements,
    progress: (f) => [f.perfectGames, 50],
  },
  {
    id: 'achievements-100',
    name: 'Hunter',
    hint: 'Unlock 100 achievements.',
    group: 'Milestones',
    tier: 1,
    icon: 'target',
    available: hasAchievements,
    progress: (f) => [f.achievements, 100],
  },
  {
    id: 'achievements-1000',
    name: 'Big game hunter',
    hint: 'Unlock 1,000 achievements.',
    group: 'Milestones',
    tier: 2,
    icon: 'target',
    available: hasAchievements,
    progress: (f) => [f.achievements, 1000],
  },
  {
    id: 'achievements-5000',
    name: 'Trophy room',
    hint: 'Unlock 5,000 achievements.',
    group: 'Milestones',
    tier: 3,
    icon: 'target',
    available: hasAchievements,
    progress: (f) => [f.achievements, 5000],
  },
  {
    id: 'hours-100',
    name: 'Settling in',
    hint: 'Play 100 hours.',
    group: 'Milestones',
    tier: 1,
    icon: 'clock',
    progress: (f) => [Math.floor(f.hours), 100],
  },
  {
    id: 'hours-1000',
    name: 'Lifer',
    hint: 'Play 1,000 hours.',
    group: 'Milestones',
    tier: 3,
    icon: 'clock',
    progress: (f) => [Math.floor(f.hours), 1000],
  },
  {
    id: 'one-game-500',
    name: 'Devoted',
    hint: 'Play one game for 500 hours.',
    group: 'Milestones',
    tier: 2,
    icon: 'heart',
    progress: (f) => [Math.floor(f.topGameHours), 500],
  },
  // Habits
  {
    id: 'streak-7',
    name: 'On a roll',
    hint: 'Finish a daily quest 7 days in a row.',
    group: 'Habits',
    tier: 1,
    icon: 'flame',
    progress: (f) => (f.streak == null ? null : [f.streak, 7]),
  },
  {
    id: 'streak-30',
    name: 'Unstoppable',
    hint: 'Finish a daily quest 30 days in a row.',
    group: 'Habits',
    tier: 3,
    icon: 'flame',
    progress: (f) => (f.streak == null ? null : [f.streak, 30]),
  },
  {
    id: 'quests-25',
    name: 'Quester',
    hint: 'Finish 25 quests.',
    group: 'Habits',
    tier: 1,
    icon: 'map',
    progress: (f) => [f.questsDone, 25],
  },
  {
    id: 'quests-100',
    name: 'Questmaster',
    hint: 'Finish 100 quests.',
    group: 'Habits',
    tier: 2,
    icon: 'map',
    progress: (f) => [f.questsDone, 100],
  },
  {
    id: 'every-platform',
    name: 'Everywhere at once',
    hint: 'Play on every platform you have connected within one week.',
    group: 'Habits',
    tier: 2,
    icon: 'world',
    available: (f) => f.playPlatforms.length >= 2,
    progress: (f) => [f.playedThisWeek, f.playPlatforms.length],
  },
  // Rarity
  {
    id: 'ultra-1',
    name: 'Rare find',
    hint: 'Unlock an achievement fewer than 5% of players have.',
    group: 'Rarity',
    tier: 1,
    icon: 'gem',
    available: hasAchievements,
    progress: (f) => [f.ultra, 1],
  },
  {
    id: 'ultra-10',
    name: 'Treasure hunter',
    hint: 'Unlock 10 achievements fewer than 5% of players have.',
    group: 'Rarity',
    tier: 2,
    icon: 'gem',
    available: hasAchievements,
    progress: (f) => [f.ultra, 10],
  },
  {
    id: 'ultra-50',
    name: 'The elite few',
    hint: 'Unlock 50 achievements fewer than 5% of players have.',
    group: 'Rarity',
    tier: 3,
    icon: 'gem',
    available: hasAchievements,
    progress: (f) => [f.ultra, 50],
  },
  {
    id: 'rare-completion',
    name: 'Against the odds',
    hint: 'Get every achievement in a game fewer than 5% of players complete.',
    group: 'Rarity',
    tier: 3,
    icon: 'diamond',
    available: hasAchievements,
    progress: (f) => [f.rareCompletions, 1],
  },
  // Ranks
  ...RANKS.filter(([min]) => min > 1)
    .reverse()
    .map(([min, name], i): BadgeDef => ({
      id: `rank-${name.toLowerCase()}`,
      name,
      hint: `Reach level ${min}.`,
      group: 'Ranks',
      tier: (i < 2 ? 1 : i < 4 ? 2 : 3) as BadgeTier,
      icon: RANK_ICON[name] ?? 'star',
      progress: (f) => [Math.min(f.level, min), min],
    })),
];

export const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]));

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** The current time, refreshed every hour (for "within a week"). */
function useHourlyNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** What the badges are judged on, from your own data. */
function useFacts(): Facts {
  const entries = useStore((s) => s.entries);
  const achievements = useStore((s) => s.achievements);
  const connections = useStore((s) => s.connections);
  const customGames = useStore((s) => s.customGames);
  const overrides = useStore((s) => s.genreOverrides);
  const details = useStore((s) => s.details);
  const questsDone = useStore((s) => s.questXp?.done ?? 0);
  const streak = useQuests((s) => s.data?.streak ?? null);
  const { level } = useXp();
  const now = useHourlyNow();

  return useMemo(() => {
    const isGame = (id: string) => {
      const g = resolveGame(id, customGames, overrides, details);
      return !!g && !isApp(g);
    };
    const connected = new Set(
      (Object.entries(connections) as [PlatformId, { lastSync?: string } | undefined][])
        .filter(([, c]) => c?.lastSync)
        .map(([p]) => p),
    );
    let platinums = 0;
    let perfectGames = 0;
    let earned = 0;
    let ultra = 0;
    let rareCompletions = 0;
    for (const [id, per] of Object.entries(achievements)) {
      if (!isGame(id)) continue;
      for (const a of Object.values(per) as (AchievementProgress | undefined)[]) {
        if (!a) continue;
        earned += a.earned;
        if (a.platinum) platinums++;
        const perfect = a.total > 0 && a.earned === a.total;
        if (perfect) perfectGames++;
        ultra += a.rarity?.ultra ?? 0;
        // Nobody can complete a game more often than its rarest achievement is earned.
        const rarest = a.rarity?.rarest[0]?.rarity;
        if (perfect && rarest != null && rarest < 5 && a.rarity?.earned === a.earned) rareCompletions++;
      }
    }

    const perGame = new Map<string, number>();
    const playedAt = new Map<PlatformId, number>();
    for (const e of entries) {
      if (!CONFIRMED_SOURCES.has(e.source) || !isGame(e.gameId)) continue;
      perGame.set(e.gameId, (perGame.get(e.gameId) ?? 0) + e.minutes);
      const t = e.lastPlayed ? Date.parse(e.lastPlayed) : 0;
      if (t > (playedAt.get(e.platform) ?? 0)) playedAt.set(e.platform, t);
    }
    const minutes = [...perGame.values()];
    const playPlatforms = [...connected].filter((p) => p !== 'gog');
    return {
      connected,
      platinums,
      perfectGames,
      achievements: earned,
      hours: minutes.reduce((n, m) => n + m, 0) / 60,
      topGameHours: Math.max(0, ...minutes) / 60,
      ultra,
      rareCompletions,
      streak,
      questsDone,
      level,
      playPlatforms,
      playedThisWeek: playPlatforms.filter((p) => now - (playedAt.get(p) ?? 0) < WEEK).length,
    };
  }, [entries, achievements, connections, customGames, overrides, details, questsDone, streak, level, now]);
}

export interface BadgeStatus extends BadgeDef {
  earnedAt: string | null;
  have: number | null;
  need: number | null;
}

/** Every badge this account can earn, with when it was earned or how far along it is. */
export function useBadges(): BadgeStatus[] {
  const facts = useFacts();
  const saved = useStore((s) => s.badges);
  return useMemo(
    () =>
      BADGES.filter((b) => saved?.[b.id] || !b.available || b.available(facts)).map((b) => {
        const p = b.progress(facts);
        return {
          ...b,
          earnedAt: saved?.[b.id] ?? null,
          have: p ? Math.min(p[0], p[1]) : null,
          need: p ? p[1] : null,
        };
      }),
    [facts, saved],
  );
}

/** Earned badges, newest first. */
export const earnedBadges = (all: BadgeStatus[]) =>
  all.filter((b) => b.earnedAt).sort((a, b) => b.earnedAt!.localeCompare(a.earnedAt!));

// Badges already announced in this tab, so one is never announced twice.
const announced = new Set<string>();

/** Saves badges as they're earned, with a short note. Badges stay once earned. */
export function useBadgeSync() {
  const facts = useFacts();
  const saved = useStore((s) => s.badges);
  const addBadges = useStore((s) => s.addBadges);
  useEffect(() => {
    const fresh = BADGES.filter((b) => {
      if (saved?.[b.id] || (b.available && !b.available(facts))) return false;
      const p = b.progress(facts);
      return !!p && p[1] > 0 && p[0] >= p[1];
    });
    if (!fresh.length) return;
    addBadges(fresh.map((b) => b.id));
    const news = fresh.filter((b) => !announced.has(b.id));
    for (const b of news) announced.add(b.id);
    if (!news.length) return;
    notifications.show({
      color: 'yellow',
      title: fresh.length === 1 ? 'Badge earned' : `${fresh.length} badges earned`,
      message: fresh.length === 1 ? fresh[0].name : `${fresh.map((b) => b.name).join(', ')}. See them on your Profile.`,
      autoClose: 6000,
    });
  }, [facts, saved, addBadges]);
}
