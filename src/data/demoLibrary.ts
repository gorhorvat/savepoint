import type { PlatformId, PlayEntry } from '../types';

// A sample library so the app is useful before any platform is connected.
// Remove it from the Platforms page once real data is imported.

type DemoRow = [gameId: string, platform: PlatformId, hours: number, lastPlayed: string];

const rows: DemoRow[] = [
  ['elden-ring', 'playstation', 148, '2026-03-02'],
  ['elden-ring', 'steam', 64, '2026-08-21'],
  ['hades', 'steam', 52, '2025-11-14'],
  ['hades', 'switch', 31, '2026-06-30'],
  ['hades-ii', 'steam', 38, '2026-10-04'],
  ['stardew-valley', 'switch', 97, '2026-01-09'],
  ['stardew-valley', 'steam', 41, '2024-12-20'],
  ['the-witcher-3-wild-hunt', 'playstation', 118, '2023-04-17'],
  ['the-witcher-3-wild-hunt', 'steam', 22, '2025-02-08'],
  ['hollow-knight', 'switch', 46, '2024-09-03'],
  ['hollow-knight', 'steam', 12, '2025-07-19'],
  ['hollow-knight-silksong', 'switch', 29, '2026-10-09'],
  ['celeste', 'switch', 18, '2024-05-11'],
  ['celeste', 'epic', 6, '2025-01-27'],
  ['slay-the-spire', 'steam', 74, '2026-09-28'],
  ['slay-the-spire', 'switch', 15, '2025-08-02'],
  ['balatro', 'switch', 33, '2026-10-10'],
  ['balatro', 'steam', 21, '2026-07-15'],
  ['dead-cells', 'epic', 19, '2024-03-30'],
  ['dead-cells', 'switch', 11, '2024-08-14'],
  ['disco-elysium', 'epic', 34, '2025-04-22'],
  ['control', 'epic', 16, '2024-02-11'],
  ['alan-wake-2', 'epic', 21, '2025-10-31'],
  ['rocket-league', 'epic', 45, '2025-06-06'],
  ['rocket-league', 'playstation', 28, '2026-02-14'],
  ['god-of-war', 'playstation', 27, '2023-01-15'],
  ['ghost-of-tsushima', 'playstation', 44, '2024-07-07'],
  ['marvels-spider-man-remastered', 'playstation', 23, '2023-09-23'],
  ['astro-bot', 'playstation', 14, '2025-12-27'],
  ['the-legend-of-zelda-breath-of-the-wild', 'switch', 126, '2023-05-10'],
  ['the-legend-of-zelda-tears-of-the-kingdom', 'switch', 104, '2025-03-18'],
  ['super-mario-odyssey', 'switch', 25, '2022-12-26'],
  ['metroid-dread', 'switch', 13, '2024-10-20'],
  ['animal-crossing-new-horizons', 'switch', 88, '2022-04-02'],
  ['baldurs-gate-3', 'steam', 131, '2026-05-24'],
  ['baldurs-gate-3', 'playstation', 37, '2025-12-02'],
  ['cyberpunk-2077', 'steam', 69, '2025-09-12'],
  ['outer-wilds', 'epic', 23, '2024-11-08'],
  ['sekiro-shadows-die-twice', 'steam', 48, '2023-11-25'],
  ['monster-hunter-rise', 'switch', 72, '2023-08-19'],
  ['monster-hunter-rise', 'steam', 36, '2024-06-01'],
  ['persona-5-royal', 'playstation', 92, '2024-01-28'],
  ['persona-5-royal', 'switch', 18, '2025-05-05'],
];

export const DEMO_ENTRIES: PlayEntry[] = rows.map(([gameId, platform, hours, lastPlayed]) => ({
  gameId,
  platform,
  minutes: Math.round(hours * 60),
  lastPlayed: `${lastPlayed}T20:00:00Z`,
  source: 'demo',
}));
