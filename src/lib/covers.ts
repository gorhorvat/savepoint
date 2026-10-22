import type { Game } from '../types';
import { fetchDetails } from './api';
import { useStore } from './store';

// Covers for games shown anywhere (recommendations, "More like this", search)
// that have no image yet. Requests from one render are gathered and sent as one
// batch; each game is asked about once per page load.
const asked = new Set<string>();
let queue: Game[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function requestCover(game: Game) {
  if (asked.has(game.id) || useStore.getState().details[game.id]?.checkedAt) return;
  asked.add(game.id);
  queue.push(game);
  timer ??= setTimeout(flush, 300);
}

async function flush() {
  timer = null;
  const batch = queue.splice(0, 50);
  if (queue.length) timer = setTimeout(flush, 300);
  try {
    useStore.getState().applyDetails(await fetchDetails(batch));
  } catch {
    // Server offline: the typographic tile stays, and the next page load tries again.
    for (const g of batch) asked.delete(g.id);
  }
}
