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
//
// Ids are saved with each account's earned badges: never rename one.

export type BadgeGroup = 'Milestones' | 'Collection' | 'Platforms' | 'Habits' | 'Rarity' | 'Ranks';
export const BADGE_GROUPS: BadgeGroup[] = ['Milestones', 'Collection', 'Platforms', 'Habits', 'Rarity', 'Ranks'];

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
  | 'medal'
  | 'books'
  | 'compass'
  | 'masks'
  | 'hourglass'
  | 'calendar'
  | 'moon'
  | 'sun'
  | 'devices'
  | 'joystick'
  | 'bolt'
  | 'coin';

export interface Facts {
  connected: Set<PlatformId>;
  platinums: number;
  golds: number;
  perfectGames: number;
  /** 100% on RetroAchievements sets (mastery). */
  retroMastered: number;
  achievements: number;
  gamerscore: number;
  hours: number;
  topGameHours: number;
  hoursOn: Partial<Record<PlatformId, number>>;
  /** Games played for at least an hour. */
  gamesPlayed: number;
  /** Platforms with at least an hour of play. */
  platformsPlayed: number;
  /** Games played on two or more platforms. */
  crossPlatformGames: number;
  genres: number;
  topGenreHours: number;
  /** Games from before 2000 played for at least an hour. */
  oldGames: number;
  decades: number;
  /** Games released this year played for at least an hour. */
  newGames: number;
  /** Different games played in the last 7 days. */
  gamesThisWeek: number;
  /** Played after midnight (before 5:00) or early in the morning (5:00–7:00), by when a platform says you last played. */
  lateNight: boolean;
  earlyMorning: boolean;
  ultra: number;
  veryRare: number;
  /** The rarest earned achievement's % of players. */
  rarestPct: number | null;
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
const has = (p: PlatformId) => (f: Facts) => f.connected.has(p);
const connectedAtLeast = (n: number) => (f: Facts) => f.connected.size >= n;

/** A badge for reaching a count. */
const goal = (
  id: string,
  name: string,
  hint: string,
  group: BadgeGroup,
  tier: BadgeTier,
  icon: BadgeIconName,
  value: (f: Facts) => number | null,
  need: number,
  available?: (f: Facts) => boolean,
): BadgeDef => ({
  id,
  name,
  hint,
  group,
  tier,
  icon,
  available,
  progress: (f) => {
    const v = value(f);
    return v == null ? null : [Math.floor(v), need];
  },
});

/** A badge for something that's either true or not. */
const once = (
  id: string,
  name: string,
  hint: string,
  group: BadgeGroup,
  tier: BadgeTier,
  icon: BadgeIconName,
  done: (f: Facts) => boolean,
  available?: (f: Facts) => boolean,
): BadgeDef => goal(id, name, hint, group, tier, icon, (f) => (done(f) ? 1 : 0), 1, available);

const PLATFORM_HOME: { platform: PlatformId; name: string }[] = [
  { platform: 'steam', name: 'Steam' },
  { platform: 'playstation', name: 'PlayStation' },
  { platform: 'xbox', name: 'Xbox' },
  { platform: 'switch', name: 'Switch' },
  { platform: 'epic', name: 'Epic' },
  { platform: 'retro', name: 'RetroAchievements' },
];

const RANK_ICON: Record<string, BadgeIconName> = {
  Regular: 'medal',
  Seasoned: 'medal',
  Veteran: 'star',
  Elite: 'star',
  Master: 'crown',
  Legend: 'crown',
};

export const BADGES: BadgeDef[] = [
  // Milestones: achievements, trophies, hours
  goal(
    'platinum-1',
    'First platinum',
    'Earn a platinum trophy.',
    'Milestones',
    1,
    'trophy',
    (f) => f.platinums,
    1,
    has('playstation'),
  ),
  goal(
    'platinum-3',
    'Platinum trio',
    'Earn 3 platinum trophies.',
    'Milestones',
    1,
    'trophy',
    (f) => f.platinums,
    3,
    has('playstation'),
  ),
  goal(
    'platinum-10',
    'Platinum shelf',
    'Earn 10 platinum trophies.',
    'Milestones',
    3,
    'trophy',
    (f) => f.platinums,
    10,
    has('playstation'),
  ),
  goal(
    'platinum-25',
    'Platinum wall',
    'Earn 25 platinum trophies.',
    'Milestones',
    3,
    'trophy',
    (f) => f.platinums,
    25,
    has('playstation'),
  ),
  goal(
    'platinum-50',
    'Platinum vault',
    'Earn 50 platinum trophies.',
    'Milestones',
    3,
    'trophy',
    (f) => f.platinums,
    50,
    has('playstation'),
  ),
  goal(
    'gold-100',
    'Gold rush',
    'Earn 100 gold trophies.',
    'Milestones',
    2,
    'coin',
    (f) => f.golds,
    100,
    has('playstation'),
  ),
  goal(
    'gamerscore-10000',
    'Ten thousand G',
    'Reach 10,000 gamerscore.',
    'Milestones',
    1,
    'coin',
    (f) => f.gamerscore,
    10000,
    has('xbox'),
  ),
  goal(
    'gamerscore-50000',
    'Fifty thousand G',
    'Reach 50,000 gamerscore.',
    'Milestones',
    2,
    'coin',
    (f) => f.gamerscore,
    50000,
    has('xbox'),
  ),
  goal(
    'gamerscore-100000',
    'Six figures',
    'Reach 100,000 gamerscore.',
    'Milestones',
    3,
    'coin',
    (f) => f.gamerscore,
    100000,
    has('xbox'),
  ),
  goal(
    'perfect-1',
    'Completionist',
    'Get every achievement in a game.',
    'Milestones',
    1,
    'check',
    (f) => f.perfectGames,
    1,
    hasAchievements,
  ),
  goal(
    'perfect-5',
    'Thorough',
    'Get every achievement in 5 games.',
    'Milestones',
    1,
    'check',
    (f) => f.perfectGames,
    5,
    hasAchievements,
  ),
  goal(
    'perfect-10',
    'Perfectionist',
    'Get every achievement in 10 games.',
    'Milestones',
    2,
    'check',
    (f) => f.perfectGames,
    10,
    hasAchievements,
  ),
  goal(
    'perfect-25',
    'Meticulous',
    'Get every achievement in 25 games.',
    'Milestones',
    2,
    'check',
    (f) => f.perfectGames,
    25,
    hasAchievements,
  ),
  goal(
    'perfect-50',
    'Flawless',
    'Get every achievement in 50 games.',
    'Milestones',
    3,
    'check',
    (f) => f.perfectGames,
    50,
    hasAchievements,
  ),
  goal(
    'perfect-100',
    'Untouchable',
    'Get every achievement in 100 games.',
    'Milestones',
    3,
    'check',
    (f) => f.perfectGames,
    100,
    hasAchievements,
  ),
  goal(
    'retro-mastery',
    'Old school',
    'Master a RetroAchievements set.',
    'Milestones',
    2,
    'joystick',
    (f) => f.retroMastered,
    1,
    has('retro'),
  ),
  goal(
    'achievements-100',
    'Hunter',
    'Unlock 100 achievements.',
    'Milestones',
    1,
    'target',
    (f) => f.achievements,
    100,
    hasAchievements,
  ),
  goal(
    'achievements-250',
    'Tracker',
    'Unlock 250 achievements.',
    'Milestones',
    1,
    'target',
    (f) => f.achievements,
    250,
    hasAchievements,
  ),
  goal(
    'achievements-1000',
    'Big game hunter',
    'Unlock 1,000 achievements.',
    'Milestones',
    2,
    'target',
    (f) => f.achievements,
    1000,
    hasAchievements,
  ),
  goal(
    'achievements-2500',
    'Seasoned hunter',
    'Unlock 2,500 achievements.',
    'Milestones',
    2,
    'target',
    (f) => f.achievements,
    2500,
    hasAchievements,
  ),
  goal(
    'achievements-5000',
    'Trophy room',
    'Unlock 5,000 achievements.',
    'Milestones',
    3,
    'target',
    (f) => f.achievements,
    5000,
    hasAchievements,
  ),
  goal(
    'achievements-10000',
    'Hall of fame',
    'Unlock 10,000 achievements.',
    'Milestones',
    3,
    'target',
    (f) => f.achievements,
    10000,
    hasAchievements,
  ),
  goal('hours-100', 'Settling in', 'Play 100 hours.', 'Milestones', 1, 'clock', (f) => f.hours, 100),
  goal('hours-250', 'Committed', 'Play 250 hours.', 'Milestones', 1, 'clock', (f) => f.hours, 250),
  goal('hours-500', 'Hooked', 'Play 500 hours.', 'Milestones', 2, 'clock', (f) => f.hours, 500),
  goal('hours-1000', 'Lifer', 'Play 1,000 hours.', 'Milestones', 3, 'clock', (f) => f.hours, 1000),
  goal('hours-2500', 'Timeless', 'Play 2,500 hours.', 'Milestones', 3, 'hourglass', (f) => f.hours, 2500),
  goal(
    'one-game-100',
    'Regular haunt',
    'Play one game for 100 hours.',
    'Milestones',
    1,
    'heart',
    (f) => f.topGameHours,
    100,
  ),
  goal('one-game-500', 'Devoted', 'Play one game for 500 hours.', 'Milestones', 2, 'heart', (f) => f.topGameHours, 500),
  goal(
    'one-game-1000',
    'Second home',
    'Play one game for 1,000 hours.',
    'Milestones',
    3,
    'heart',
    (f) => f.topGameHours,
    1000,
  ),

  // Collection: how widely you play
  goal(
    'games-10',
    'Explorer',
    'Play 10 games for at least an hour each.',
    'Collection',
    1,
    'books',
    (f) => f.gamesPlayed,
    10,
  ),
  goal(
    'games-50',
    'Collector',
    'Play 50 games for at least an hour each.',
    'Collection',
    1,
    'books',
    (f) => f.gamesPlayed,
    50,
  ),
  goal(
    'games-100',
    'Curator',
    'Play 100 games for at least an hour each.',
    'Collection',
    2,
    'books',
    (f) => f.gamesPlayed,
    100,
  ),
  goal(
    'games-250',
    'Archivist',
    'Play 250 games for at least an hour each.',
    'Collection',
    3,
    'books',
    (f) => f.gamesPlayed,
    250,
  ),
  goal('genres-5', 'Genre hopper', 'Play games from 5 different genres.', 'Collection', 1, 'masks', (f) => f.genres, 5),
  goal(
    'genres-10',
    'Renaissance gamer',
    'Play games from 10 different genres.',
    'Collection',
    2,
    'masks',
    (f) => f.genres,
    10,
  ),
  goal(
    'genre-100h',
    'Specialist',
    'Play 100 hours of one genre.',
    'Collection',
    2,
    'compass',
    (f) => f.topGenreHours,
    100,
  ),
  goal(
    'genre-500h',
    'Connoisseur',
    'Play 500 hours of one genre.',
    'Collection',
    3,
    'compass',
    (f) => f.topGenreHours,
    500,
  ),
  goal(
    'old-game',
    'Time traveller',
    'Play a game released before 2000 for an hour.',
    'Collection',
    1,
    'hourglass',
    (f) => f.oldGames,
    1,
  ),
  goal(
    'old-games-10',
    'Historian',
    'Play 10 games released before 2000 for an hour each.',
    'Collection',
    2,
    'hourglass',
    (f) => f.oldGames,
    10,
  ),
  goal(
    'decades-4',
    'Across the decades',
    'Play games from 4 different decades.',
    'Collection',
    2,
    'calendar',
    (f) => f.decades,
    4,
  ),
  goal(
    'new-games-5',
    'Fresh off the shelf',
    'Play 5 games released this year.',
    'Collection',
    1,
    'calendar',
    (f) => f.newGames,
    5,
  ),

  // Platforms
  goal(
    'platforms-2',
    'Two worlds',
    'Play for at least an hour on 2 platforms.',
    'Platforms',
    1,
    'devices',
    (f) => f.platformsPlayed,
    2,
    connectedAtLeast(2),
  ),
  goal(
    'platforms-4',
    'Multi-platform',
    'Play for at least an hour on 4 platforms.',
    'Platforms',
    2,
    'devices',
    (f) => f.platformsPlayed,
    4,
    connectedAtLeast(4),
  ),
  goal(
    'cross-platform-1',
    'Double dip',
    'Play the same game on 2 platforms.',
    'Platforms',
    1,
    'devices',
    (f) => f.crossPlatformGames,
    1,
    connectedAtLeast(2),
  ),
  goal(
    'cross-platform-5',
    'Wherever I go',
    'Play 5 games on 2 platforms or more.',
    'Platforms',
    2,
    'devices',
    (f) => f.crossPlatformGames,
    5,
    connectedAtLeast(2),
  ),
  {
    id: 'every-platform',
    name: 'Everywhere at once',
    hint: 'Play on every platform you have connected within one week.',
    group: 'Platforms',
    tier: 2,
    icon: 'world',
    available: (f) => f.playPlatforms.length >= 2,
    progress: (f) => [f.playedThisWeek, f.playPlatforms.length],
  },
  ...PLATFORM_HOME.map(({ platform, name }) =>
    goal(
      `home-${platform}`,
      `At home on ${name}`,
      `Play 100 hours on ${name}.`,
      'Platforms',
      2,
      'joystick',
      (f) => f.hoursOn[platform] ?? 0,
      100,
      has(platform),
    ),
  ),

  // Habits
  goal('streak-7', 'On a roll', 'Finish a daily quest 7 days in a row.', 'Habits', 1, 'flame', (f) => f.streak, 7),
  goal('streak-14', 'Fortnight', 'Finish a daily quest 14 days in a row.', 'Habits', 2, 'flame', (f) => f.streak, 14),
  goal('streak-30', 'Unstoppable', 'Finish a daily quest 30 days in a row.', 'Habits', 3, 'flame', (f) => f.streak, 30),
  goal('streak-60', 'Iron will', 'Finish a daily quest 60 days in a row.', 'Habits', 3, 'flame', (f) => f.streak, 60),
  goal(
    'streak-100',
    'Hundred days',
    'Finish a daily quest 100 days in a row.',
    'Habits',
    3,
    'flame',
    (f) => f.streak,
    100,
  ),
  goal('quests-25', 'Quester', 'Finish 25 quests.', 'Habits', 1, 'map', (f) => f.questsDone, 25),
  goal('quests-100', 'Questmaster', 'Finish 100 quests.', 'Habits', 2, 'map', (f) => f.questsDone, 100),
  goal('quests-250', 'Adventurer', 'Finish 250 quests.', 'Habits', 3, 'map', (f) => f.questsDone, 250),
  goal('quests-500', 'Quest legend', 'Finish 500 quests.', 'Habits', 3, 'map', (f) => f.questsDone, 500),
  goal(
    'week-5-games',
    'Busy week',
    'Play 5 different games within one week.',
    'Habits',
    1,
    'bolt',
    (f) => f.gamesThisWeek,
    5,
  ),
  goal(
    'week-10-games',
    'Sampler',
    'Play 10 different games within one week.',
    'Habits',
    2,
    'bolt',
    (f) => f.gamesThisWeek,
    10,
  ),
  once('night-owl', 'Night owl', 'Play a game after midnight.', 'Habits', 1, 'moon', (f) => f.lateNight),
  once(
    'early-bird',
    'Early bird',
    'Play a game between 5 and 7 in the morning.',
    'Habits',
    1,
    'sun',
    (f) => f.earlyMorning,
  ),

  // Rarity
  goal(
    'ultra-1',
    'Rare find',
    'Unlock an achievement fewer than 5% of players have.',
    'Rarity',
    1,
    'gem',
    (f) => f.ultra,
    1,
    hasAchievements,
  ),
  goal(
    'ultra-10',
    'Treasure hunter',
    'Unlock 10 achievements fewer than 5% of players have.',
    'Rarity',
    2,
    'gem',
    (f) => f.ultra,
    10,
    hasAchievements,
  ),
  goal(
    'ultra-50',
    'The elite few',
    'Unlock 50 achievements fewer than 5% of players have.',
    'Rarity',
    3,
    'gem',
    (f) => f.ultra,
    50,
    hasAchievements,
  ),
  goal(
    'ultra-100',
    'Rarity collector',
    'Unlock 100 achievements fewer than 5% of players have.',
    'Rarity',
    3,
    'gem',
    (f) => f.ultra,
    100,
    hasAchievements,
  ),
  goal(
    'ultra-250',
    'Mythic',
    'Unlock 250 achievements fewer than 5% of players have.',
    'Rarity',
    3,
    'gem',
    (f) => f.ultra,
    250,
    hasAchievements,
  ),
  goal(
    'very-rare-25',
    'Off the beaten path',
    'Unlock 25 achievements fewer than 10% of players have.',
    'Rarity',
    1,
    'gem',
    (f) => f.veryRare,
    25,
    hasAchievements,
  ),
  once(
    'under-1',
    'One in a hundred',
    'Unlock an achievement fewer than 1% of players have.',
    'Rarity',
    2,
    'diamond',
    (f) => f.rarestPct != null && f.rarestPct < 1,
    hasAchievements,
  ),
  once(
    'under-01',
    'One in a thousand',
    'Unlock an achievement fewer than 0.1% of players have.',
    'Rarity',
    3,
    'diamond',
    (f) => f.rarestPct != null && f.rarestPct > 0 && f.rarestPct < 0.1,
    hasAchievements,
  ),
  goal(
    'rare-completion',
    'Against the odds',
    'Get every achievement in a game fewer than 5% of players complete.',
    'Rarity',
    3,
    'diamond',
    (f) => f.rareCompletions,
    1,
    hasAchievements,
  ),
  goal(
    'rare-completion-5',
    'Beyond the odds',
    'Get every achievement in 5 games fewer than 5% of players complete.',
    'Rarity',
    3,
    'diamond',
    (f) => f.rareCompletions,
    5,
    hasAchievements,
  ),

  // Ranks
  ...RANKS.filter(([min]) => min > 1)
    .reverse()
    .map(([min, name], i) =>
      goal(
        `rank-${name.toLowerCase()}`,
        name,
        `Reach level ${min}.`,
        'Ranks',
        (i < 2 ? 1 : i < 4 ? 2 : 3) as BadgeTier,
        RANK_ICON[name] ?? 'star',
        (f) => Math.min(f.level, min),
        min,
      ),
    ),
  goal('level-100', 'Centurion', 'Reach level 100.', 'Ranks', 3, 'crown', (f) => Math.min(f.level, 100), 100),
];

export const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]));

const WEEK = 7 * 24 * 60 * 60 * 1000;
const HOUR = 60;

/** The current time, refreshed every hour (for "within a week"). */
function useHourlyNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The year a game came out, when known. */
const yearOf = (g: { year?: number; releaseDate?: string }) =>
  g.year ?? (g.releaseDate ? Number(g.releaseDate.slice(0, 4)) || undefined : undefined);

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
    const gameOf = (id: string) => {
      const g = resolveGame(id, customGames, overrides, details);
      return g && !isApp(g) ? g : undefined;
    };
    const connected = new Set(
      (Object.entries(connections) as [PlatformId, { lastSync?: string } | undefined][])
        .filter(([, c]) => c?.lastSync)
        .map(([p]) => p),
    );

    let platinums = 0;
    let golds = 0;
    let perfectGames = 0;
    let retroMastered = 0;
    let earned = 0;
    let gamerscore = 0;
    let ultra = 0;
    let veryRare = 0;
    let rarestPct: number | null = null;
    let rareCompletions = 0;
    for (const [id, per] of Object.entries(achievements)) {
      if (!gameOf(id)) continue;
      for (const [platform, a] of Object.entries(per) as [PlatformId, AchievementProgress | undefined][]) {
        if (!a) continue;
        earned += a.earned;
        if (a.platinum) platinums++;
        golds += a.grades?.gold ?? 0;
        gamerscore += a.gamerscore ?? 0;
        const perfect = a.total > 0 && a.earned === a.total;
        if (perfect) perfectGames++;
        if (perfect && platform === 'retro') retroMastered++;
        ultra += a.rarity?.ultra ?? 0;
        veryRare += (a.rarity?.ultra ?? 0) + (a.rarity?.very ?? 0);
        const rarest = a.rarity?.rarest[0]?.rarity;
        if (rarest != null && (rarestPct == null || rarest < rarestPct)) rarestPct = rarest;
        // Nobody can complete a game more often than its rarest achievement is earned.
        if (perfect && rarest != null && rarest < 5 && a.rarity?.earned === a.earned) rareCompletions++;
      }
    }

    const perGame = new Map<string, number>();
    const platformsOf = new Map<string, Set<PlatformId>>();
    const hoursOn: Partial<Record<PlatformId, number>> = {};
    const playedAt = new Map<PlatformId, number>();
    const thisWeek = new Set<string>();
    let lateNight = false;
    let earlyMorning = false;
    for (const e of entries) {
      if (!CONFIRMED_SOURCES.has(e.source) || !gameOf(e.gameId) || e.minutes <= 0) continue;
      perGame.set(e.gameId, (perGame.get(e.gameId) ?? 0) + e.minutes);
      hoursOn[e.platform] = (hoursOn[e.platform] ?? 0) + e.minutes / 60;
      platformsOf.set(e.gameId, (platformsOf.get(e.gameId) ?? new Set()).add(e.platform));
      if (!e.lastPlayed) continue;
      const t = Date.parse(e.lastPlayed);
      if (t > (playedAt.get(e.platform) ?? 0)) playedAt.set(e.platform, t);
      if (now - t < WEEK) thisWeek.add(e.gameId);
      // Time of day only from platforms that give the exact time (Nintendo logs days).
      const d = new Date(t);
      if (e.source !== 'nintendo' && (d.getMinutes() || d.getSeconds())) {
        const h = d.getHours();
        if (h < 5) lateNight = true;
        else if (h < 7) earlyMorning = true;
      }
    }

    const played = [...perGame].filter(([, m]) => m >= HOUR);
    const genreMinutes = new Map<string, number>();
    const decades = new Set<number>();
    let oldGames = 0;
    let newGames = 0;
    const year = new Date(now).getFullYear();
    for (const [id, minutes] of played) {
      const g = gameOf(id)!;
      for (const genre of g.genres) genreMinutes.set(genre, (genreMinutes.get(genre) ?? 0) + minutes);
      const y = yearOf(g);
      if (!y) continue;
      decades.add(Math.floor(y / 10));
      if (y < 2000) oldGames++;
      if (y === year) newGames++;
    }

    const minutes = [...perGame.values()];
    const playPlatforms = [...connected].filter((p) => p !== 'gog');
    return {
      connected,
      platinums,
      golds,
      perfectGames,
      retroMastered,
      achievements: earned,
      gamerscore,
      hours: minutes.reduce((sum, m) => sum + m, 0) / 60,
      topGameHours: Math.max(0, ...minutes) / 60,
      hoursOn,
      gamesPlayed: played.length,
      platformsPlayed: (Object.values(hoursOn) as number[]).filter((h) => h >= 1).length,
      crossPlatformGames: [...platformsOf.values()].filter((s) => s.size >= 2).length,
      genres: genreMinutes.size,
      topGenreHours: Math.max(0, ...genreMinutes.values()) / 60,
      oldGames,
      decades: decades.size,
      newGames,
      gamesThisWeek: thisWeek.size,
      lateNight,
      earlyMorning,
      ultra,
      veryRare,
      rarestPct,
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
      title: news.length === 1 ? 'Badge earned' : `${news.length} badges earned`,
      message:
        news.length === 1
          ? news[0].name
          : news.length <= 4
            ? `${news.map((b) => b.name).join(', ')}. See them on your Profile.`
            : `${news
                .slice(0, 3)
                .map((b) => b.name)
                .join(', ')} and ${news.length - 3} more. See them on your Profile.`,
      autoClose: 6000,
    });
  }, [facts, saved, addBadges]);
}
