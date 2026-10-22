import { useEffect } from 'react';
import type { Game } from '../types';
import { fetchDetails, fetchStatus } from './api';
import { isApp } from './apps';
import { DETAILS_VERSION, resolveGame, useStore } from './store';

const DAY = 24 * 60 * 60 * 1000;
let running = false;

/**
 * Games you have, want or have played that need cover or release info: never
 * looked up, unreleased and last checked over a day ago (dates move), or still
 * without a cover a week after the last try.
 */
function pending(): Game[] {
  const { entries, wishlist, physical, physicalWants, customGames, genreOverrides, details } = useStore.getState();
  const ids = new Set([
    ...entries.map((e) => e.gameId),
    ...wishlist.map((w) => w.gameId),
    ...physical.map((p) => p.gameId),
    ...physicalWants.map((w) => w.gameId),
  ]);
  const out: Game[] = [];
  for (const id of ids) {
    if (!id) continue;
    const game = resolveGame(id, customGames, genreOverrides, details);
    if (!game || isApp(game)) continue;
    const d = details[id];
    const checked = d?.checkedAt ? Date.parse(d.checkedAt) : 0;
    const upcoming = d?.comingSoon ?? game.comingSoon;
    const age = Date.now() - checked;
    const miss = !game.imageUrl && ((d?.v ?? 1) < DETAILS_VERSION || age > 7 * DAY);
    if (!checked || miss || (upcoming && age > DAY)) out.push(game);
  }
  return out;
}

/** Quietly fills in covers and release dates. Results are saved per game. */
export async function runDetailsBackfill(): Promise<void> {
  if (running) return;
  const queue = pending();
  if (!queue.length || !(await fetchStatus()).online) return;
  running = true;
  try {
    // The server searches the other stores for a limited number of games per
    // request and leaves the rest out, so keep asking until nothing is left.
    let left = queue;
    while (left.length) {
      const results = await fetchDetails(left.slice(0, 50));
      if (!Object.keys(results).length) break;
      useStore.getState().applyDetails(results);
      left = left.filter((g) => !(g.id in results));
    }
  } catch {
    // Covers and dates are nice-to-have; the next app open retries.
  } finally {
    running = false;
  }
}

export function useDetailsBackfill() {
  const count = useStore((s) => s.entries.length + s.wishlist.length + s.physical.length + s.physicalWants.length);
  useEffect(() => {
    void runDetailsBackfill();
  }, [count]);
}
