// Levels and ranks, from total XP. Kept free of imports so XP (lib/xp.ts) and
// badges (lib/badges.ts) can both use it.
//
// Levels 1–1,000. Each level costs a little more than the last: up to level 50
// as it always has (100 × level^1.2), then 25 XP more per level, the way
// Steam's levels keep rising steadily. Level 50 is about 240,000 XP in all
// and level 1,000 about 21.9 million: a lifetime goal, not a wall.

export const MAX_LEVEL = 1000;

const CURVE_TURN = 50;
const AT_TURN = Math.round(100 * Math.pow(CURVE_TURN, 1.2));

/** XP to go from `level` to the next. */
export const xpToNext = (level: number) =>
  level < CURVE_TURN ? Math.round(100 * Math.pow(level, 1.2)) : AT_TURN + 25 * (level - CURVE_TURN);

/** Total XP needed to reach each level (index = level). */
const START: number[] = [0, 0];
for (let level = 1; level < MAX_LEVEL; level++) START.push(START[level] + xpToNext(level));

/** Total XP that `level` starts at. */
export const xpForLevel = (level: number) => START[Math.max(1, Math.min(MAX_LEVEL, level))];

/**
 * Ranks and the level each starts at, highest first. The first seven are the
 * original ones (never move them: people's ranks would change).
 */
export const RANKS: [minLevel: number, name: string][] = [
  [1000, 'Savepoint'],
  [950, 'Infinite'],
  [900, 'Eternal'],
  [850, 'Primordial'],
  [800, 'Transcendent'],
  [750, 'Apex'],
  [700, 'Sovereign'],
  [650, 'Celestial'],
  [600, 'Cosmic'],
  [550, 'Astral'],
  [500, 'Divine'],
  [450, 'Exalted'],
  [400, 'Titan'],
  [350, 'Ascendant'],
  [300, 'Immortal'],
  [250, 'Mythic'],
  [200, 'Paragon'],
  [175, 'Grandmaster'],
  [150, 'Hero'],
  [130, 'Champion'],
  [110, 'Warlord'],
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

export interface Level {
  level: number;
  /** XP gathered towards the next level, and what that level needs (both 1 at the top level). */
  into: number;
  needed: number;
  rank: string;
  /** At level 1,000. */
  max: boolean;
}

export function levelFor(total: number): Level {
  // Highest level whose start is within the total.
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (START[mid] <= total) lo = mid;
    else hi = mid - 1;
  }
  const level = lo;
  if (level >= MAX_LEVEL) return { level, into: 1, needed: 1, rank: rankFor(level), max: true };
  return { level, into: total - START[level], needed: xpToNext(level), rank: rankFor(level), max: false };
}
