import type { PlatformId } from '../types';

export interface PlatformInfo {
  id: PlatformId;
  name: string;
  short: string;
  /** CSS variable holding the platform's data colour (set per color scheme in styles.css). */
  colorVar: string;
  /** How Savepoint gets play time from this platform. */
  importMethod: 'api' | 'manual';
}

export const PLATFORMS: PlatformInfo[] = [
  { id: 'steam', name: 'Steam', short: 'Steam', colorVar: 'var(--sp-steam)', importMethod: 'api' },
  { id: 'playstation', name: 'PlayStation', short: 'PS', colorVar: 'var(--sp-playstation)', importMethod: 'api' },
  { id: 'switch', name: 'Nintendo Switch', short: 'Switch', colorVar: 'var(--sp-switch)', importMethod: 'manual' },
  { id: 'epic', name: 'Epic Games', short: 'Epic', colorVar: 'var(--sp-epic)', importMethod: 'manual' },
];

export const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p])) as Record<
  PlatformId,
  PlatformInfo
>;
