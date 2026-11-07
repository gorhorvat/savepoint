// Physical copies you want: helpers shared by the Wishlist, the Shelf and game pages
// (the form and modal are in src/components/PhysicalEditor.tsx).
import { useCallback } from 'react';
import type { FoundGame } from './api';
import { useGameResolver } from './store';
import type { Condition, Game, PhysicalPlatform, PhysicalWant } from '../types';

/** A game record to show the cover from: the linked game, or a title-only stand-in. */
export function useCoverGame() {
  const resolve = useGameResolver();
  return useCallback(
    (gameId: string | undefined, title: string): Game =>
      (gameId && resolve(gameId)) || { id: title, title, genres: [], subgenres: [], tags: [], availableOn: [] },
    [resolve],
  );
}

/** Best guess at the physical platform: the only console it came out on, else from where it's sold. */
export function defaultPlatform(
  f: Pick<FoundGame, 'availableOn' | 'switchVersions' | 'physicalPlatforms'>,
): PhysicalPlatform | null {
  const consoles = (f.physicalPlatforms ?? []).filter((p) => p !== 'PC');
  if (consoles.length === 1) return consoles[0];
  if (f.availableOn.includes('switch')) return f.switchVersions?.includes('Switch') ? 'Switch' : 'Switch 2';
  if (f.availableOn.includes('playstation')) return 'PS5';
  return null;
}

export type FormValues = {
  gameId?: string;
  title: string;
  platform: PhysicalPlatform | null;
  condition?: Condition | null;
  edition?: string;
  price?: number | string;
  acquiredAt?: string;
  notes?: string;
};

export type Editing =
  | { kind: 'new-item'; initial?: FormValues; fromWant?: string }
  | { kind: 'edit-item'; id: string }
  | { kind: 'new-want'; initial?: FormValues }
  | { kind: 'edit-want'; id: string }
  | null;

/** Starting values for a physical want of a game already in Savepoint. */
export const wantOf = (game: Game): FormValues => ({
  gameId: game.id,
  title: game.title,
  platform: defaultPlatform(game),
});

/** "Got it": the values of a copy on your shelf, from a want. */
export const gotIt = (w: PhysicalWant): Editing => ({
  kind: 'new-item',
  fromWant: w.id,
  initial: { gameId: w.gameId, title: w.title, platform: w.platform, edition: w.edition },
});
