import { notifications } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';
import type { AchievementProgress, PlatformId } from '../types';
import { isApp } from './apps';
import { MAX_LEVEL, RANKS } from './levels';
import { useQuests } from './quests';
import { resolveGame, useStore } from './store';
import { CONFIRMED_SOURCES, useXp } from './xp';

// Badges: awards for milestones, kept for good once earned, each worth XP by
// tier. Like XP they only count what platforms confirm (no hours added by
// hand), and a badge only exists for an account that can earn it (no
// platinum badges without PlayStation, no "every platform" badge with one).
//
// Most badges come in series (`series()`): one metric, many steps, with tiers
// rising along the way. Icons are from game-icons.net (CC BY 3.0); every
// gi('…') name below is copied into src/data/badgeIcons.json by
// `node scripts/badge-icons.mjs`. Run it after adding an icon.
//
// Ids are saved with each account's earned badges: never rename or reuse one.

export type BadgeGroup =
  | 'Achievements'
  | 'Trophies and gamerscore'
  | 'Play time'
  | 'Collection'
  | 'Genres'
  | 'Eras'
  | 'Platforms'
  | 'Habits'
  | 'Rarity'
  | 'Levels';
export const BADGE_GROUPS: BadgeGroup[] = [
  'Achievements',
  'Trophies and gamerscore',
  'Play time',
  'Collection',
  'Genres',
  'Eras',
  'Platforms',
  'Habits',
  'Rarity',
  'Levels',
];

/** Bronze, silver, gold, platinum: how hard a badge is to get. */
export type BadgeTier = 1 | 2 | 3 | 4;
export const TIER_NAME: Record<BadgeTier, string> = { 1: 'Bronze', 2: 'Silver', 3: 'Gold', 4: 'Platinum' };
/** XP each badge gives, by tier. */
export const TIER_XP: Record<BadgeTier, number> = { 1: 25, 2: 75, 3: 200, 4: 500 };

/** A game-icons.net icon name (marks it for scripts/badge-icons.mjs). */
const gi = (name: string) => name;

type Counts = Partial<Record<string, number>>;

export interface Facts {
  connected: Set<PlatformId>;
  level: number;
  xpTotal: number;
  badgeCount: number;
  platinums: number;
  golds: number;
  silvers: number;
  bronzes: number;
  gamerscore: number;
  achievements: number;
  achievementsOn: Counts;
  mostInOneGame: number;
  /** Games at least half / three quarters done. */
  halfDone: number;
  mostlyDone: number;
  perfectGames: number;
  perfectOn: Counts;
  /** 100% on RetroAchievements sets (mastery). */
  retroMastered: number;
  hours: number;
  hoursOn: Counts;
  /** Hours per game, confirmed play only. */
  gameHours: number[];
  /** Games played for at least an hour, overall and per platform. */
  gamesPlayed: number;
  gamesOn: Counts;
  /** Platforms with at least an hour of play. */
  platformsPlayed: number;
  /** Games played on two or more platforms. */
  crossPlatformGames: number;
  genreHours: Counts;
  genreGames: Counts;
  subHours: Counts;
  subGames: Counts;
  genres: number;
  subgenres: number;
  topGenreHours: number;
  yearGames: Counts;
  decadeGames: Counts;
  decades: number;
  /** Games from before 2000 / released this year, played for at least an hour. */
  oldGames: number;
  newGames: number;
  /** Different games played in the last 7 days. */
  gamesThisWeek: number;
  /** Played after midnight (before 5:00) or early (5:00–7:00), by when a platform says you last played. */
  lateNight: boolean;
  earlyMorning: boolean;
  /** Earned achievements under 5%, under 10% and under 20% of players. */
  ultra: number;
  veryRare: number;
  rare: number;
  ultraOn: Counts;
  /** The rarest earned achievement's % of players, overall and per platform. */
  rarestPct: number | null;
  rarestOn: Counts;
  /** Games at 100% whose rarest achievement fewer than 5% of players have (so fewer than 5% completed it). */
  rareCompletions: number;
  streak: number | null;
  questsDone: number;
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
  /** game-icons.net icon name. */
  icon: string;
  /** Whether this account can earn it at all. */
  available?: (f: Facts) => boolean;
  /** What you have and what it takes; null while it can't be told. */
  progress: (f: Facts) => [have: number, need: number] | null;
}

const ACHIEVEMENT_PLATFORMS: PlatformId[] = ['steam', 'playstation', 'xbox', 'epic', 'gog', 'retro'];
const PLAY_PLATFORMS: PlatformId[] = ['steam', 'playstation', 'xbox', 'switch', 'epic', 'retro'];
const PLATFORM_NAME: Record<PlatformId, string> = {
  steam: 'Steam',
  playstation: 'PlayStation',
  xbox: 'Xbox',
  switch: 'Switch',
  epic: 'Epic',
  gog: 'GOG',
  retro: 'RetroAchievements',
};
const PLATFORM_ICON: Record<PlatformId, string> = {
  steam: gi('gamepad'),
  playstation: gi('console-controller'),
  xbox: gi('joystick'),
  switch: gi('retro-controller'),
  epic: gi('rocket'),
  gog: gi('castle'),
  retro: gi('metroid'),
};
const hasAchievements = (f: Facts) => ACHIEVEMENT_PLATFORMS.some((p) => f.connected.has(p));
const has = (p: PlatformId) => (f: Facts) => f.connected.has(p);
const connectedAtLeast = (n: number) => (f: Facts) => f.connected.size >= n;
const count = (c: Counts, key: string) => c[key] ?? 0;
const num = (n: number) => n.toLocaleString('en-US');
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const ROMAN: [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];
function roman(n: number) {
  let out = '';
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/** Names kept from earlier badges (by id); the rest of a series is "<name> <I, II…>". */
const NAMES: Record<string, string> = {
  'platinum-1': 'First platinum',
  'platinum-3': 'Platinum trio',
  'platinum-10': 'Platinum shelf',
  'platinum-25': 'Platinum wall',
  'platinum-50': 'Platinum vault',
  'gold-100': 'Gold rush',
  'gamerscore-10000': 'Ten thousand G',
  'gamerscore-50000': 'Fifty thousand G',
  'gamerscore-100000': 'Six figures',
  'perfect-1': 'Completionist',
  'perfect-5': 'Thorough',
  'perfect-10': 'Perfectionist',
  'perfect-25': 'Meticulous',
  'perfect-50': 'Flawless',
  'perfect-100': 'Untouchable',
  'achievements-100': 'Hunter',
  'achievements-250': 'Tracker',
  'achievements-1000': 'Big game hunter',
  'achievements-2500': 'Seasoned hunter',
  'achievements-5000': 'Trophy room',
  'achievements-10000': 'Hall of fame',
  'hours-100': 'Settling in',
  'hours-250': 'Committed',
  'hours-500': 'Hooked',
  'hours-1000': 'Lifer',
  'hours-2500': 'Timeless',
  'one-game-100': 'Regular haunt',
  'one-game-500': 'Devoted',
  'one-game-1000': 'Second home',
  'games-10': 'Explorer',
  'games-50': 'Collector',
  'games-100': 'Curator',
  'games-250': 'Archivist',
  'genres-5': 'Genre hopper',
  'genres-10': 'Renaissance gamer',
  'decades-4': 'Across the decades',
  'new-games-5': 'Fresh off the shelf',
  'old-games-10': 'Historian',
  'platforms-2': 'Two worlds',
  'platforms-4': 'Multi-platform',
  'cross-platform-1': 'Double dip',
  'cross-platform-5': 'Wherever I go',
  'streak-7': 'On a roll',
  'streak-14': 'Fortnight',
  'streak-30': 'Unstoppable',
  'streak-60': 'Iron will',
  'streak-100': 'Hundred days',
  'quests-25': 'Quester',
  'quests-100': 'Questmaster',
  'quests-250': 'Adventurer',
  'quests-500': 'Quest legend',
  'week-5-games': 'Busy week',
  'week-10-games': 'Sampler',
  'ultra-1': 'Rare find',
  'ultra-10': 'Treasure hunter',
  'ultra-50': 'The elite few',
  'ultra-100': 'Rarity collector',
  'ultra-250': 'Mythic finds',
  'very-rare-25': 'Off the beaten path',
  'rare-completion': 'Against the odds',
  'rare-completion-3': 'Defying the odds',
  'rare-completion-5': 'Beyond the odds',
  'level-100': 'Centurion',
};

/** Tier by how far along a series a step is; the last of a long series is platinum. */
function tierAt(i: number, len: number): BadgeTier {
  if (len === 1) return 2;
  const r = i / (len - 1);
  if (r >= 0.9 && len >= 5) return 4;
  if (r >= 0.6) return 3;
  if (r >= 0.3) return 2;
  return 1;
}

interface SeriesSpec {
  /** Badge id for a step. */
  id: (n: number) => string;
  /** Base name; steps get I, II, III… (or a name from NAMES). */
  name: string;
  hint: (n: string, raw: number) => string;
  group: BadgeGroup;
  /** One icon, or one per tier (bronze to platinum). */
  icon: string | string[];
  value: (f: Facts) => number | null;
  steps: number[];
  available?: (f: Facts) => boolean;
  /** Steps that already have a badge of their own elsewhere. */
  skip?: number[];
  /** Raise every tier by this much (harder series). */
  harder?: number;
}

function series(s: SeriesSpec): BadgeDef[] {
  return s.steps
    .filter((n) => !s.skip?.includes(n))
    .map((n, i, steps) => {
      const tier = Math.min(4, tierAt(i, steps.length) + (s.harder ?? 0)) as BadgeTier;
      const id = s.id(n);
      const icons = Array.isArray(s.icon) ? s.icon : [s.icon];
      return {
        id,
        name: NAMES[id] ?? `${s.name} ${roman(i + 1)}`,
        hint: s.hint(num(n), n),
        group: s.group,
        tier,
        icon: icons[Math.min(tier - 1, icons.length - 1)],
        available: s.available,
        progress: (f: Facts) => {
          const v = s.value(f);
          return v == null ? null : [Math.floor(v), n];
        },
      };
    });
}

/** A one-off badge for something that's true or not. */
const once = (
  id: string,
  name: string,
  hint: string,
  group: BadgeGroup,
  tier: BadgeTier,
  icon: string,
  done: (f: Facts) => boolean,
  available?: (f: Facts) => boolean,
): BadgeDef => ({ id, name, hint, group, tier, icon, available, progress: (f) => [done(f) ? 1 : 0, 1] });

const GENRES: [name: string, icon: string][] = [
  ['Action', gi('sword-brandish')],
  ['RPG', gi('spell-book')],
  ['Adventure', gi('compass')],
  ['Strategy', gi('chess-knight')],
  ['Simulation', gi('gears')],
  ['Puzzle', gi('jigsaw-piece')],
  ['Platformer', gi('jump-across')],
  ['Racing', gi('f1-car')],
  ['Sports', gi('soccer-ball')],
  ['Fighting', gi('boxing-glove')],
  ['Shooter', gi('crosshair')],
  ['Roguelike', gi('rolling-dices')],
];
const GENRE_ICON = Object.fromEntries(GENRES);

const SUBGENRES: [name: string, genre: string, icon?: string][] = [
  ['3D platformer', 'Platformer'],
  ['Puzzle platformer', 'Puzzle'],
  ['Precision platformer', 'Platformer', gi('stairs')],
  ["Beat 'em up", 'Action', gi('fist')],
  ['First-person shooter', 'Shooter', gi('pistol-gun')],
  ['Third-person shooter', 'Shooter'],
  ['Looter shooter', 'Shooter', gi('open-treasure-chest')],
  ['Hero shooter', 'Shooter', gi('shield-reflect')],
  ['Battle royale', 'Shooter', gi('flag-objective')],
  ['Roguelite', 'Roguelike'],
  ['Soulslike', 'Action', gi('crowned-skull')],
  ['Metroidvania', 'Platformer', gi('metroid')],
  ['Open-world', 'Adventure', gi('treasure-map')],
  ['Action-adventure', 'Action', gi('broadsword')],
  ['Hack and slash', 'Action', gi('crossed-swords')],
  ['Deckbuilder', 'Strategy', gi('card-play')],
  ['Bullet hell', 'Shooter', gi('star-swirl')],
  ['Colony sim', 'Simulation', gi('house')],
  ['Immersive sim', 'Simulation', gi('eye-target')],
  ['CRPG', 'RPG', gi('wizard-staff')],
  ['JRPG', 'RPG', gi('dragon-head')],
  ['Action RPG', 'RPG', gi('broadsword')],
  ['MMORPG', 'RPG', gi('globe')],
  ['Turn-based tactics', 'Strategy', gi('cavalry')],
  ['Turn-based', 'Strategy', gi('horse-head')],
  ['Real-time strategy', 'Strategy', gi('tower-flag')],
  ['City builder', 'Simulation', gi('factory')],
  ['Farming sim', 'Simulation', gi('farmer')],
  ['Life sim', 'Simulation', gi('hearts')],
  ['Social sim', 'Simulation', gi('person')],
  ['Management', 'Simulation', gi('cash')],
  ['Sandbox', 'Simulation', gi('wooden-crate')],
  ['Survival', 'Adventure', gi('fire')],
  ['Survival horror', 'Adventure', gi('haunting')],
  ['Detective', 'Adventure', gi('magnifying-glass')],
  ['Mystery', 'Adventure', gi('hood')],
  ['Narrative adventure', 'Adventure', gi('open-book')],
  ['Exploration', 'Adventure', gi('mountaintop')],
  ['Rhythm action', 'Action', gi('musical-notes')],
  ['Auto battler', 'Strategy', gi('cog')],
  ['Tower defense', 'Strategy', gi('castle-ruins')],
  ['Sim racing', 'Racing', gi('checkered-flag')],
  ['Arcade racing', 'Racing', gi('city-car')],
  ['Mech combat', 'Action', gi('mecha-head')],
  ['Western', 'Adventure', gi('cowboy-boot')],
];

const RANK_ICONS = [
  gi('ribbon-medal'),
  gi('medal'),
  gi('star-medal'),
  gi('laurels-trophy'),
  gi('rank-1'),
  gi('rank-2'),
  gi('rank-3'),
  gi('podium-winner'),
  gi('laurel-crown'),
  gi('crown'),
  gi('queen-crown'),
  gi('king'),
  gi('crowned-skull'),
  gi('dragon-head'),
  gi('angel-wings'),
  gi('hand-of-god'),
  gi('star-formation'),
  gi('star-swirl'),
  gi('planet-conquest'),
  gi('spiral-bloom'),
  gi('sun'),
  gi('night-sky'),
  gi('stars-stack'),
  gi('earth-africa-europe'),
  gi('globe'),
  gi('castle'),
  gi('infinity'),
];

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 1979 }, (_, i) => 1980 + i);
const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];

const TROPHY_ICONS = [gi('trophy'), gi('trophy-cup'), gi('laurels-trophy'), gi('podium-winner')];
const CLOCK_ICONS = [gi('stopwatch'), gi('pocket-watch'), gi('hourglass'), gi('sands-of-time')];
const GEM_ICONS = [gi('gem-pendant'), gi('crystal-cluster'), gi('cut-diamond'), gi('diamond-hard')];

export const BADGES: BadgeDef[] = [
  // Achievements
  ...series({
    id: (n) => `achievements-${n}`,
    name: 'Achievement hunter',
    hint: (n) => `Unlock ${n} achievements.`,
    group: 'Achievements',
    icon: [gi('achievement'), gi('bullseye'), gi('target-arrows'), gi('trophy-cup')],
    value: (f) => f.achievements,
    steps: [
      10, 25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7500, 10000, 12500, 15000, 20000,
      25000,
    ],
    available: hasAchievements,
  }),
  ...ACHIEVEMENT_PLATFORMS.flatMap((p) =>
    series({
      id: (n) => `achievements-${p}-${n}`,
      name: p === 'playstation' ? 'Trophy hunter' : `${PLATFORM_NAME[p]} hunter`,
      hint: (n) => (p === 'playstation' ? `Earn ${n} trophies.` : `Unlock ${n} achievements on ${PLATFORM_NAME[p]}.`),
      group: 'Achievements',
      icon: PLATFORM_ICON[p],
      value: (f) => count(f.achievementsOn, p),
      steps: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      available: has(p),
    }),
  ),
  ...series({
    id: (n) => `one-game-achievements-${n}`,
    name: 'Deep dive',
    hint: (n) => `Unlock ${n} achievements in one game.`,
    group: 'Achievements',
    icon: gi('mining'),
    value: (f) => f.mostInOneGame,
    steps: [25, 50, 100, 250, 500, 1000],
    available: hasAchievements,
  }),
  ...series({
    id: (n) => `half-${n}`,
    name: 'Halfway there',
    hint: (n) => `Get half the achievements in ${n} games.`,
    group: 'Achievements',
    icon: gi('stairs'),
    value: (f) => f.halfDone,
    steps: [5, 10, 25, 50, 100, 250],
    available: hasAchievements,
  }),
  ...series({
    id: (n) => `most-${n}`,
    name: 'Almost there',
    hint: (n) => `Get three quarters of the achievements in ${n} games.`,
    group: 'Achievements',
    icon: gi('stairs-goal'),
    value: (f) => f.mostlyDone,
    steps: [5, 10, 25, 50, 100],
    available: hasAchievements,
  }),
  ...series({
    id: (n) => `perfect-${n}`,
    name: 'Completionist',
    hint: (n, raw) => (raw === 1 ? 'Get every achievement in a game.' : `Get every achievement in ${n} games.`),
    group: 'Achievements',
    icon: [gi('checkered-flag'), gi('flying-flag'), gi('laurel-crown'), gi('crown')],
    value: (f) => f.perfectGames,
    steps: [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500],
    available: hasAchievements,
  }),
  ...ACHIEVEMENT_PLATFORMS.flatMap((p) =>
    series({
      id: (n) => `perfect-${p}-${n}`,
      name: `${PLATFORM_NAME[p]} completionist`,
      hint: (n, raw) =>
        raw === 1
          ? `Get every achievement in a game on ${PLATFORM_NAME[p]}.`
          : `Get every achievement in ${n} games on ${PLATFORM_NAME[p]}.`,
      group: 'Achievements',
      icon: PLATFORM_ICON[p],
      value: (f) => count(f.perfectOn, p),
      steps: [1, 3, 5, 10, 25, 50, 100, 250],
      available: has(p),
      skip: p === 'retro' ? [1] : undefined,
    }),
  ),
  once(
    'retro-mastery',
    'Old school',
    'Master a RetroAchievements set.',
    'Achievements',
    2,
    gi('metroid'),
    (f) => f.retroMastered >= 1,
    has('retro'),
  ),

  // Trophies and gamerscore
  ...series({
    id: (n) => `platinum-${n}`,
    name: 'Platinum collector',
    hint: (n, raw) => (raw === 1 ? 'Earn a platinum trophy.' : `Earn ${n} platinum trophies.`),
    group: 'Trophies and gamerscore',
    icon: TROPHY_ICONS,
    value: (f) => f.platinums,
    steps: [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500],
    available: has('playstation'),
  }),
  ...(
    [
      ['gold', 'Gold', (f: Facts) => f.golds, [10, 25, 50, 100, 250, 500, 1000, 2500], gi('gold-bar')],
      ['silver', 'Silver', (f: Facts) => f.silvers, [25, 50, 100, 250, 500, 1000, 2500, 5000], gi('two-coins')],
      ['bronze', 'Bronze', (f: Facts) => f.bronzes, [50, 100, 250, 500, 1000, 2500, 5000, 10000], gi('coins')],
    ] as const
  ).flatMap(([key, label, value, steps, icon]) =>
    series({
      id: (n) => `${key}-${n}`,
      name: `${label} hoard`,
      hint: (n) => `Earn ${n} ${key} trophies.`,
      group: 'Trophies and gamerscore',
      icon,
      value,
      steps: [...steps],
      available: has('playstation'),
    }),
  ),
  ...series({
    id: (n) => `gamerscore-${n}`,
    name: 'Gamerscore',
    hint: (n) => `Reach ${n} gamerscore.`,
    group: 'Trophies and gamerscore',
    icon: [gi('two-coins'), gi('coins'), gi('gold-bar'), gi('open-treasure-chest')],
    value: (f) => f.gamerscore,
    steps: [
      1000, 5000, 10000, 25000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000,
    ],
    available: has('xbox'),
  }),

  // Play time
  ...series({
    id: (n) => `hours-${n}`,
    name: 'Time well spent',
    hint: (n) => `Play ${n} hours.`,
    group: 'Play time',
    icon: CLOCK_ICONS,
    value: (f) => f.hours,
    steps: [10, 25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000],
  }),
  ...PLAY_PLATFORMS.flatMap((p) =>
    series({
      id: (n) => `hours-${p}-${n}`,
      name: `${PLATFORM_NAME[p]} time`,
      hint: (n) => `Play ${n} hours on ${PLATFORM_NAME[p]}.`,
      group: 'Play time',
      icon: PLATFORM_ICON[p],
      value: (f) => count(f.hoursOn, p),
      steps: [10, 25, 50, 250, 500, 1000, 2000, 3000, 5000],
      available: has(p),
    }),
  ),
  ...PLAY_PLATFORMS.map((p) =>
    once(
      `home-${p}`,
      `At home on ${PLATFORM_NAME[p]}`,
      `Play 100 hours on ${PLATFORM_NAME[p]}.`,
      'Play time',
      2,
      PLATFORM_ICON[p],
      (f) => count(f.hoursOn, p) >= 100,
      has(p),
    ),
  ),
  ...series({
    id: (n) => `one-game-${n}`,
    name: 'Devotion',
    hint: (n) => `Play one game for ${n} hours.`,
    group: 'Play time',
    icon: [gi('heart-plus'), gi('hearts'), gi('house'), gi('castle')],
    value: (f) => Math.max(0, ...f.gameHours),
    steps: [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000],
  }),
  ...(
    [
      [10, [5, 10, 25, 50, 100]],
      [50, [5, 10, 25, 50, 100]],
      [100, [1, 3, 5, 10, 25]],
    ] as const
  ).flatMap(([h, steps]) =>
    series({
      id: (n) => `games-${h}h-${n}`,
      name: `${h}-hour club`,
      hint: (n, raw) => (raw === 1 ? `Play a game for ${h} hours.` : `Play ${n} games for ${h} hours each.`),
      group: 'Play time',
      icon: gi('alarm-clock'),
      value: (f) => f.gameHours.filter((x) => x >= h).length,
      steps: [...steps],
      harder: h === 100 ? 1 : 0,
    }),
  ),

  // Collection
  ...series({
    id: (n) => `games-${n}`,
    name: 'Library',
    hint: (n) => `Play ${n} games for at least an hour each.`,
    group: 'Collection',
    icon: [gi('open-book'), gi('spell-book'), gi('bookshelf'), gi('castle')],
    value: (f) => f.gamesPlayed,
    steps: [5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000],
  }),
  ...PLAY_PLATFORMS.flatMap((p) =>
    series({
      id: (n) => `games-${p}-${n}`,
      name: `${PLATFORM_NAME[p]} library`,
      hint: (n) => `Play ${n} games on ${PLATFORM_NAME[p]} for at least an hour each.`,
      group: 'Collection',
      icon: PLATFORM_ICON[p],
      value: (f) => count(f.gamesOn, p),
      steps: [5, 10, 25, 50, 100, 250],
      available: has(p),
    }),
  ),
  ...series({
    id: (n) => `genres-${n}`,
    name: 'Genre hopper',
    hint: (n) => `Play games from ${n} different genres.`,
    group: 'Collection',
    icon: gi('tribal-mask'),
    value: (f) => f.genres,
    steps: [3, 5, 8, 10, 12],
  }),
  ...series({
    id: (n) => `subgenres-${n}`,
    name: 'Eclectic',
    hint: (n) => `Play games from ${n} different sub-genres.`,
    group: 'Collection',
    icon: gi('card-random'),
    value: (f) => f.subgenres,
    steps: [5, 10, 20, 30],
  }),
  ...series({
    id: (n) => `genre-${n}h`,
    name: 'Specialist',
    hint: (n) => `Play ${n} hours of one genre.`,
    group: 'Collection',
    icon: gi('compass'),
    value: (f) => f.topGenreHours,
    steps: [100, 500],
  }),

  // Genres and sub-genres
  ...GENRES.flatMap(([genre, icon]) => [
    ...series({
      id: (n) => `genre-${slug(genre)}-${n}h`,
      name: `${genre} fan`,
      hint: (n) => `Play ${n} hours of ${genre} games.`,
      group: 'Genres' as BadgeGroup,
      icon,
      value: (f) => count(f.genreHours, genre),
      steps: [10, 25, 50, 100, 250, 500, 1000, 2000],
    }),
    ...series({
      id: (n) => `genre-${slug(genre)}-games-${n}`,
      name: `${genre} collector`,
      hint: (n, raw) =>
        raw === 1 ? `Play a ${genre} game for an hour.` : `Play ${n} ${genre} games for an hour each.`,
      group: 'Genres' as BadgeGroup,
      icon,
      value: (f) => count(f.genreGames, genre),
      steps: [1, 5, 10, 25, 50, 100],
    }),
  ]),
  ...SUBGENRES.flatMap(([sub, genre, icon]) => [
    ...series({
      id: (n) => `sub-${slug(sub)}-${n}h`,
      name: `${sub} fan`,
      hint: (n) => `Play ${n} hours of ${sub} games.`,
      group: 'Genres' as BadgeGroup,
      icon: icon ?? GENRE_ICON[genre],
      value: (f) => count(f.subHours, sub),
      steps: [10, 50, 100, 250],
    }),
    ...series({
      id: (n) => `sub-${slug(sub)}-games-${n}`,
      name: `${sub} collector`,
      hint: (n, raw) => (raw === 1 ? `Play a ${sub} game for an hour.` : `Play ${n} ${sub} games for an hour each.`),
      group: 'Genres' as BadgeGroup,
      icon: icon ?? GENRE_ICON[genre],
      value: (f) => count(f.subGames, sub),
      steps: [1, 5, 10],
    }),
  ]),

  // Eras
  ...YEARS.map((y): BadgeDef => ({
    id: `year-${y}`,
    name: `Class of ${y}`,
    hint: `Play a game released in ${y} for an hour.`,
    group: 'Eras',
    tier: y < 1990 ? 3 : y < 2000 ? 2 : 1,
    icon: gi('calendar'),
    progress: (f) => [Math.min(1, count(f.yearGames, String(y))), 1],
  })),
  ...DECADES.flatMap((d) =>
    series({
      id: (n) => `decade-${d}s-${n}`,
      name: `${d}s`,
      hint: (n, raw) =>
        raw === 1 ? `Play a game from the ${d}s for an hour.` : `Play ${n} games from the ${d}s for an hour each.`,
      group: 'Eras',
      icon: d < 1990 ? gi('retro-controller') : d < 2010 ? gi('console-controller') : gi('gamepad'),
      value: (f) => count(f.decadeGames, String(d)),
      steps: [1, 5, 10, 25, 50],
      harder: d < 1990 ? 1 : 0,
    }),
  ),
  ...series({
    id: (n) => `decades-${n}`,
    name: 'Across the decades',
    hint: (n) => `Play games from ${n} different decades.`,
    group: 'Eras',
    icon: gi('calendar-half-year'),
    value: (f) => f.decades,
    steps: [2, 3, 4, 5, 6],
  }),
  once(
    'old-game',
    'Time traveller',
    'Play a game released before 2000 for an hour.',
    'Eras',
    1,
    gi('backward-time'),
    (f) => f.oldGames >= 1,
  ),
  ...series({
    id: (n) => `old-games-${n}`,
    name: 'Historian',
    hint: (n) => `Play ${n} games released before 2000 for an hour each.`,
    group: 'Eras',
    icon: gi('backward-time'),
    value: (f) => f.oldGames,
    steps: [5, 10, 25, 50],
  }),
  ...series({
    id: (n) => `new-games-${n}`,
    name: 'Fresh off the shelf',
    hint: (n, raw) => (raw === 1 ? 'Play a game released this year.' : `Play ${n} games released this year.`),
    group: 'Eras',
    icon: gi('sunrise'),
    value: (f) => f.newGames,
    steps: [1, 5, 10, 25],
  }),

  // Platforms
  ...[2, 3, 4, 5, 6].map((n, i): BadgeDef => ({
    id: `platforms-${n}`,
    name: NAMES[`platforms-${n}`] ?? `Multi-platform ${roman(i + 1)}`,
    hint: `Play for at least an hour on ${n} platforms.`,
    group: 'Platforms',
    tier: tierAt(i, 5),
    icon: gi('world'),
    available: connectedAtLeast(n),
    progress: (f) => [f.platformsPlayed, n],
  })),
  ...series({
    id: (n) => `cross-platform-${n}`,
    name: 'Wherever I go',
    hint: (n, raw) => (raw === 1 ? 'Play the same game on 2 platforms.' : `Play ${n} games on 2 platforms or more.`),
    group: 'Platforms',
    icon: gi('earth-africa-europe'),
    value: (f) => f.crossPlatformGames,
    steps: [1, 5, 10, 25, 50],
    available: connectedAtLeast(2),
  }),
  {
    id: 'every-platform',
    name: 'Everywhere at once',
    hint: 'Play on every platform you have connected within one week.',
    group: 'Platforms',
    tier: 2,
    icon: gi('globe'),
    available: (f) => f.playPlatforms.length >= 2,
    progress: (f) => [f.playedThisWeek, f.playPlatforms.length],
  },

  // Habits
  ...series({
    id: (n) => `streak-${n}`,
    name: 'Daily streak',
    hint: (n) => `Finish a daily quest ${n} days in a row.`,
    group: 'Habits',
    icon: [gi('flame'), gi('fire'), gi('fire'), gi('sun')],
    value: (f) => f.streak,
    steps: [3, 7, 14, 21, 30, 45, 60, 90, 100, 150, 180, 250, 300, 365],
  }),
  ...series({
    id: (n) => `quests-${n}`,
    name: 'Quest log',
    hint: (n) => `Finish ${n} quests.`,
    group: 'Habits',
    icon: [gi('scroll-unfurled'), gi('treasure-map'), gi('locked-chest'), gi('open-treasure-chest')],
    value: (f) => f.questsDone,
    steps: [10, 25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 5000],
  }),
  ...series({
    id: (n) => `week-${n}-games`,
    name: 'Busy week',
    hint: (n) => `Play ${n} different games within one week.`,
    group: 'Habits',
    icon: gi('sprint'),
    value: (f) => f.gamesThisWeek,
    steps: [3, 5, 7, 10, 15, 20],
  }),
  once('night-owl', 'Night owl', 'Play a game after midnight.', 'Habits', 1, gi('owl'), (f) => f.lateNight),
  once(
    'early-bird',
    'Early bird',
    'Play a game between 5 and 7 in the morning.',
    'Habits',
    1,
    gi('rooster'),
    (f) => f.earlyMorning,
  ),

  // Rarity
  ...series({
    id: (n) => `ultra-${n}`,
    name: 'Ultra rare',
    hint: (n, raw) =>
      raw === 1
        ? 'Unlock an achievement fewer than 5% of players have.'
        : `Unlock ${n} achievements fewer than 5% of players have.`,
    group: 'Rarity',
    icon: GEM_ICONS,
    value: (f) => f.ultra,
    steps: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
    available: hasAchievements,
  }),
  ...series({
    id: (n) => `very-rare-${n}`,
    name: 'Very rare',
    hint: (n) => `Unlock ${n} achievements fewer than 10% of players have.`,
    group: 'Rarity',
    icon: gi('gem-pendant'),
    value: (f) => f.veryRare,
    steps: [10, 25, 50, 100, 250, 500, 1000],
    available: hasAchievements,
  }),
  ...series({
    id: (n) => `rare-${n}`,
    name: 'Rare',
    hint: (n) => `Unlock ${n} achievements fewer than 20% of players have.`,
    group: 'Rarity',
    icon: gi('crystal-cluster'),
    value: (f) => f.rare,
    steps: [10, 25, 50, 100, 250, 500, 1000, 2500],
    available: hasAchievements,
  }),
  ...ACHIEVEMENT_PLATFORMS.flatMap((p) => [
    ...series({
      id: (n) => `ultra-${p}-${n}`,
      name: `${PLATFORM_NAME[p]} rarities`,
      hint: (n, raw) =>
        raw === 1
          ? `Unlock an achievement fewer than 5% of players have, on ${PLATFORM_NAME[p]}.`
          : `Unlock ${n} achievements fewer than 5% of players have, on ${PLATFORM_NAME[p]}.`,
      group: 'Rarity' as BadgeGroup,
      icon: PLATFORM_ICON[p],
      value: (f) => count(f.ultraOn, p),
      steps: [1, 10, 50, 100],
      available: has(p),
    }),
    once(
      `under-1-${p}`,
      `${PLATFORM_NAME[p]}: one in a hundred`,
      `Unlock an achievement fewer than 1% of players have, on ${PLATFORM_NAME[p]}.`,
      'Rarity',
      3,
      gi('beast-eye'),
      (f) => f.rarestOn[p] != null && f.rarestOn[p]! < 1,
      has(p),
    ),
  ]),
  ...(
    [
      ['under-5', 'Under five', 5, 1, gi('gem-pendant')],
      ['under-2', 'Under two', 2, 2, gi('crystal-cluster')],
      ['under-1', 'One in a hundred', 1, 2, gi('cut-diamond')],
      ['under-05', 'One in two hundred', 0.5, 3, gi('diamond-hard')],
      ['under-01', 'One in a thousand', 0.1, 4, gi('star-formation')],
    ] as const
  ).map(([id, name, below, tier, icon]) =>
    once(
      id,
      name,
      `Unlock an achievement fewer than ${below}% of players have.`,
      'Rarity',
      tier,
      icon,
      (f) => f.rarestPct != null && f.rarestPct > 0 && f.rarestPct < below,
      hasAchievements,
    ),
  ),
  ...series({
    id: (n) => (n === 1 ? 'rare-completion' : `rare-completion-${n}`),
    name: 'Against the odds',
    hint: (n, raw) =>
      raw === 1
        ? 'Get every achievement in a game fewer than 5% of players complete.'
        : `Get every achievement in ${n} games fewer than 5% of players complete.`,
    group: 'Rarity',
    icon: gi('spiral-bloom'),
    value: (f) => f.rareCompletions,
    steps: [1, 3, 5, 10, 25],
    available: hasAchievements,
    harder: 1,
  }),

  // Levels, ranks, badges and XP
  ...Array.from({ length: MAX_LEVEL / 10 }, (_, i) => (i + 1) * 10).map((n): BadgeDef => ({
    id: `level-${n}`,
    name: NAMES[`level-${n}`] ?? `Level ${n}`,
    hint: `Reach level ${n}.`,
    group: 'Levels',
    tier: n < 50 ? 1 : n < 150 ? 2 : n < 500 ? 3 : 4,
    icon: n < 50 ? gi('level-two') : n < 150 ? gi('level-three') : n < 500 ? gi('level-four') : gi('stairs-goal'),
    progress: (f) => [Math.min(f.level, n), n],
  })),
  ...RANKS.filter(([min]) => min > 1)
    .reverse()
    .map(([min, name], i): BadgeDef => ({
      id: `rank-${name.toLowerCase()}`,
      name,
      hint: `Reach the ${name} rank (level ${num(min)}).`,
      group: 'Levels',
      tier: min < 50 ? 1 : min < 150 ? 2 : min < 500 ? 3 : 4,
      icon: RANK_ICONS[Math.min(i, RANK_ICONS.length - 1)],
      progress: (f) => [Math.min(f.level, min), min],
    })),
  ...series({
    id: (n) => `badges-${n}`,
    name: 'Badge collector',
    hint: (n) => `Earn ${n} badges.`,
    group: 'Levels',
    icon: [gi('ribbon-medal'), gi('medal'), gi('star-medal'), gi('medal-skull')],
    value: (f) => f.badgeCount,
    steps: [10, 25, 50, 100, 250, 500, 750, 1000],
  }),
  ...series({
    id: (n) => `xp-${n}`,
    name: 'Experienced',
    hint: (n) => `Reach ${n} XP.`,
    group: 'Levels',
    icon: [gi('upgrade'), gi('star-swirl'), gi('stars-stack'), gi('infinity')],
    value: (f) => f.xpTotal,
    steps: [1000, 10000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 20000000],
  }),
];

export const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]));

/** XP from earned badges (ones no longer defined count nothing). */
export function badgeXpTotal(saved: Record<string, string> | undefined): { earned: number; xp: number } {
  let earned = 0;
  let xp = 0;
  for (const id of Object.keys(saved ?? {})) {
    const b = BADGE_BY_ID.get(id);
    if (!b) continue;
    earned++;
    xp += TIER_XP[b.tier];
  }
  return { earned, xp };
}

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

const add = (c: Counts, key: string, n: number) => {
  c[key] = (c[key] ?? 0) + n;
};

/** What the badges are judged on, from your own data. */
function useFacts(): Facts {
  const entries = useStore((s) => s.entries);
  const achievements = useStore((s) => s.achievements);
  const connections = useStore((s) => s.connections);
  const customGames = useStore((s) => s.customGames);
  const overrides = useStore((s) => s.genreOverrides);
  const details = useStore((s) => s.details);
  const questsDone = useStore((s) => s.questXp?.done ?? 0);
  const badgeCount = useStore((s) => Object.keys(s.badges ?? {}).length);
  const streak = useQuests((s) => s.data?.streak ?? null);
  const { level, total: xpTotal } = useXp();
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
    let silvers = 0;
    let bronzes = 0;
    let gamerscore = 0;
    let earned = 0;
    let mostInOneGame = 0;
    let halfDone = 0;
    let mostlyDone = 0;
    let perfectGames = 0;
    let retroMastered = 0;
    let ultra = 0;
    let veryRare = 0;
    let rare = 0;
    let rarestPct: number | null = null;
    let rareCompletions = 0;
    const achievementsOn: Counts = {};
    const perfectOn: Counts = {};
    const ultraOn: Counts = {};
    const rarestOn: Counts = {};
    for (const [id, per] of Object.entries(achievements)) {
      if (!gameOf(id)) continue;
      for (const [platform, a] of Object.entries(per) as [PlatformId, AchievementProgress | undefined][]) {
        if (!a) continue;
        earned += a.earned;
        add(achievementsOn, platform, a.earned);
        mostInOneGame = Math.max(mostInOneGame, a.earned);
        if (a.platinum) platinums++;
        golds += a.grades?.gold ?? 0;
        silvers += a.grades?.silver ?? 0;
        bronzes += a.grades?.bronze ?? 0;
        gamerscore += a.gamerscore ?? 0;
        if (a.total > 0 && a.earned * 2 >= a.total) halfDone++;
        if (a.total > 0 && a.earned * 4 >= a.total * 3) mostlyDone++;
        const perfect = a.total > 0 && a.earned === a.total;
        if (perfect) {
          perfectGames++;
          add(perfectOn, platform, 1);
          if (platform === 'retro') retroMastered++;
        }
        const r = a.rarity;
        if (!r) continue;
        ultra += r.ultra;
        veryRare += r.ultra + r.very;
        rare += r.ultra + r.very + r.rare;
        add(ultraOn, platform, r.ultra);
        const rarest = r.rarest[0]?.rarity;
        if (rarest != null) {
          if (rarestPct == null || rarest < rarestPct) rarestPct = rarest;
          if (rarestOn[platform] == null || rarest < rarestOn[platform]!) rarestOn[platform] = rarest;
        }
        // Nobody can complete a game more often than its rarest achievement is earned.
        if (perfect && rarest != null && rarest < 5 && r.earned === a.earned) rareCompletions++;
      }
    }

    const perGame = new Map<string, number>();
    const platformsOf = new Map<string, Set<PlatformId>>();
    const minutesOn = new Map<PlatformId, Map<string, number>>();
    const hoursOn: Counts = {};
    const playedAt = new Map<PlatformId, number>();
    const thisWeek = new Set<string>();
    let lateNight = false;
    let earlyMorning = false;
    for (const e of entries) {
      if (!CONFIRMED_SOURCES.has(e.source) || !gameOf(e.gameId) || e.minutes <= 0) continue;
      perGame.set(e.gameId, (perGame.get(e.gameId) ?? 0) + e.minutes);
      add(hoursOn, e.platform, e.minutes / 60);
      const onPlatform = minutesOn.get(e.platform) ?? new Map<string, number>();
      onPlatform.set(e.gameId, (onPlatform.get(e.gameId) ?? 0) + e.minutes);
      minutesOn.set(e.platform, onPlatform);
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

    const gamesOn: Counts = {};
    for (const [platform, games] of minutesOn) {
      gamesOn[platform] = [...games.values()].filter((m) => m >= HOUR).length;
    }
    const played = [...perGame].filter(([, m]) => m >= HOUR);
    const genreHours: Counts = {};
    const genreGames: Counts = {};
    const subHours: Counts = {};
    const subGames: Counts = {};
    const yearGames: Counts = {};
    const decadeGames: Counts = {};
    let oldGames = 0;
    let newGames = 0;
    const year = new Date(now).getFullYear();
    for (const [id, minutes] of played) {
      const g = gameOf(id)!;
      for (const genre of new Set(g.genres)) {
        add(genreHours, genre, minutes / 60);
        add(genreGames, genre, 1);
      }
      for (const sub of new Set(g.subgenres)) {
        add(subHours, sub, minutes / 60);
        add(subGames, sub, 1);
      }
      const y = yearOf(g);
      if (!y) continue;
      add(yearGames, String(y), 1);
      add(decadeGames, String(Math.floor(y / 10) * 10), 1);
      if (y < 2000) oldGames++;
      if (y === year) newGames++;
    }

    const gameHours = [...perGame.values()].map((m) => m / 60);
    const playPlatforms = [...connected].filter((p) => p !== 'gog');
    return {
      connected,
      level,
      xpTotal,
      badgeCount,
      platinums,
      golds,
      silvers,
      bronzes,
      gamerscore,
      achievements: earned,
      achievementsOn,
      mostInOneGame,
      halfDone,
      mostlyDone,
      perfectGames,
      perfectOn,
      retroMastered,
      hours: gameHours.reduce((sum, h) => sum + h, 0),
      hoursOn,
      gameHours,
      gamesPlayed: played.length,
      gamesOn,
      platformsPlayed: Object.values(hoursOn).filter((h) => (h ?? 0) >= 1).length,
      crossPlatformGames: [...platformsOf.values()].filter((s) => s.size >= 2).length,
      genreHours,
      genreGames,
      subHours,
      subGames,
      genres: Object.keys(genreGames).length,
      subgenres: Object.keys(subGames).length,
      topGenreHours: Math.max(0, ...Object.values(genreHours).map((h) => h ?? 0)),
      yearGames,
      decadeGames,
      decades: Object.keys(decadeGames).length,
      oldGames,
      newGames,
      gamesThisWeek: thisWeek.size,
      lateNight,
      earlyMorning,
      ultra,
      veryRare,
      rare,
      ultraOn,
      rarestPct,
      rarestOn,
      rareCompletions,
      streak,
      questsDone,
      playPlatforms,
      playedThisWeek: playPlatforms.filter((p) => now - (playedAt.get(p) ?? 0) < WEEK).length,
    };
  }, [
    entries,
    achievements,
    connections,
    customGames,
    overrides,
    details,
    questsDone,
    badgeCount,
    streak,
    level,
    xpTotal,
    now,
  ]);
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

/** Earned badges, newest first (then hardest first). */
export const earnedBadges = (all: BadgeStatus[]) =>
  all.filter((b) => b.earnedAt).sort((a, b) => b.earnedAt!.localeCompare(a.earnedAt!) || b.tier - a.tier);

// Badges already announced in this tab, so one is never announced twice.
const announced = new Set<string>();

/** Saves badges as they're earned, with a short note and their XP. Badges stay once earned. */
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
    const news = fresh.filter((b) => !announced.has(b.id)).sort((a, b) => b.tier - a.tier);
    for (const b of news) announced.add(b.id);
    if (!news.length) return;
    const xp = news.reduce((sum, b) => sum + TIER_XP[b.tier], 0);
    const names = news.map((b) => b.name);
    notifications.show({
      color: 'yellow',
      title: `${news.length === 1 ? 'Badge earned' : `${num(news.length)} badges earned`} · +${num(xp)} XP`,
      message:
        news.length === 1
          ? names[0]
          : news.length <= 4
            ? `${names.join(', ')}. See them on your Profile.`
            : `${names.slice(0, 3).join(', ')} and ${num(news.length - 3)} more. See them on your Profile.`,
      autoClose: 8000,
    });
  }, [facts, saved, addBadges]);
}
