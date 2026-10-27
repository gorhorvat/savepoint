import { useMemo } from 'react';
import { PLATFORMS } from '../data/platforms';
import { DIGITAL } from '../data/physical';
import type { EntrySource, Game, PhysicalItem, PlatformId, Progress } from '../types';
import { isApp } from './apps';
import { resolveGame, useStore } from './store';

export interface PlatformPlay {
  platform: PlatformId;
  minutes: number;
  lastPlayed: string | null;
  source: EntrySource;
}

export interface LibraryGame {
  game: Game;
  plays: PlatformPlay[];
  totalMinutes: number;
  lastPlayed: string | null;
  /** Non-game titles like YouTube or Twitch. */
  isApp: boolean;
  /** Physical copies you own of this game (from the Physical page). */
  physical: PhysicalItem[];
  /** Status, rating and finish date you set. */
  progress?: Progress;
}

/** The digital platform a physical copy counts towards (Switch cartridge -> Switch). */
export function physicalPlatformId(item: PhysicalItem): PlatformId | undefined {
  return item.platform === 'PC' ? undefined : DIGITAL[item.platform];
}

const PLATFORM_ORDER = Object.fromEntries(PLATFORMS.map((p, i) => [p.id, i]));

/**
 * Every played game with its play time grouped per platform, most played
 * first, plus physical games you own but haven't logged time for (0 hours).
 * Apps (YouTube, Twitch, ...) are left out unless `includeApps` is set, so they
 * never skew totals, taste or recommendations by accident.
 */
export function useLibrary({ includeApps = false }: { includeApps?: boolean } = {}): LibraryGame[] {
  const entries = useStore((s) => s.entries);
  const customGames = useStore((s) => s.customGames);
  const overrides = useStore((s) => s.genreOverrides);
  const details = useStore((s) => s.details);
  const physical = useStore((s) => s.physical);
  const progress = useStore((s) => s.progress);

  return useMemo(() => {
    const byGame = new Map<string, PlatformPlay[]>();
    for (const e of entries) {
      const list = byGame.get(e.gameId) ?? [];
      list.push({ platform: e.platform, minutes: e.minutes, lastPlayed: e.lastPlayed, source: e.source });
      byGame.set(e.gameId, list);
    }
    const copies = new Map<string, PhysicalItem[]>();
    for (const item of physical) {
      if (!item.gameId) continue;
      copies.set(item.gameId, [...(copies.get(item.gameId) ?? []), item]);
      if (!byGame.has(item.gameId)) byGame.set(item.gameId, []);
    }
    const out: LibraryGame[] = [];
    for (const [id, plays] of byGame) {
      const game = resolveGame(id, customGames, overrides, details);
      if (!game) continue;
      plays.sort((a, b) => PLATFORM_ORDER[a.platform] - PLATFORM_ORDER[b.platform]);
      out.push({
        game,
        plays,
        totalMinutes: plays.reduce((n, p) => n + p.minutes, 0),
        lastPlayed:
          plays
            .map((p) => p.lastPlayed)
            .filter(Boolean)
            .sort()
            .pop() ?? null,
        isApp: isApp(game),
        physical: copies.get(id) ?? [],
        progress: progress[id],
      });
    }
    return out.filter((g) => includeApps || !g.isApp).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [entries, customGames, overrides, details, physical, progress, includeApps]);
}

export function platformTotals(lib: LibraryGame[]): Record<PlatformId, number> {
  const totals: Record<PlatformId, number> = { steam: 0, epic: 0, playstation: 0, xbox: 0, switch: 0 };
  for (const g of lib) for (const p of g.plays) totals[p.platform] += p.minutes;
  return totals;
}

/** Platforms the player has any play time on. */
export function ownedPlatforms(lib: LibraryGame[]): PlatformId[] {
  const totals = platformTotals(lib);
  return PLATFORMS.map((p) => p.id).filter((id) => totals[id] > 0);
}

/** Physical copies typed in by hand (no linked game): titles you own that aren't in the library. */
export function useUnlinkedPhysicalTitles(): string[] {
  const physical = useStore((s) => s.physical);
  return useMemo(() => physical.filter((p) => !p.gameId).map((p) => p.title), [physical]);
}
