import { useEffect } from 'react';
import type { Game } from '../types';
import { fetchLengths, fetchStatus } from './api';
import { isApp } from './apps';
import { resolveGame, useStore } from './store';

let running = false;

/** Library games (played or owned physically) whose length hasn't been looked up. */
function pending(): Game[] {
  const { entries, physical, customGames, genreOverrides, details, lengths } = useStore.getState();
  const ids = new Set([...entries.map((e) => e.gameId), ...physical.map((p) => p.gameId)]);
  const out: Game[] = [];
  for (const id of ids) {
    if (!id || id in lengths) continue;
    const game = resolveGame(id, customGames, genreOverrides, details);
    if (game && !isApp(game) && !game.comingSoon) out.push(game);
  }
  return out;
}

/**
 * Fills in how long each game takes to beat, from HowLongToBeat, 40 games per
 * request (the server spaces its searches out). Stops quietly when the site
 * can't be reached; the rest are tried next time the app opens.
 */
export async function runLengthBackfill(): Promise<void> {
  if (running) return;
  let queue = pending();
  if (!queue.length || !(await fetchStatus()).online) return;
  running = true;
  try {
    while (queue.length) {
      const results = await fetchLengths(queue.slice(0, 40));
      if (!Object.keys(results).length) break;
      useStore.getState().applyLengths(results);
      queue = queue.filter((g) => !(g.id in results));
    }
  } catch {
    // Nice-to-have; retried on the next app open.
  } finally {
    running = false;
  }
}

export function useLengthBackfill() {
  const count = useStore((s) => s.entries.length + s.physical.length);
  useEffect(() => {
    void runLengthBackfill();
  }, [count]);
}
