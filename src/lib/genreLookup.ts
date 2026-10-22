import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import type { Game } from '../types';
import { fetchGenres, fetchStatus } from './api';
import { isApp } from './apps';
import { useStore } from './store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let running = false;

/** Played or wishlisted games (not apps) whose genres haven't been looked up yet. */
function pending(): Game[] {
  const { customGames, genreOverrides, entries, wishlist } = useStore.getState();
  const used = new Set([...entries.map((e) => e.gameId), ...wishlist.map((w) => w.gameId)]);
  return Object.values(customGames).filter(
    (g) => used.has(g.id) && !g.genreSource && !genreOverrides[g.id] && !isApp(g) && g.genres.length === 0,
  );
}

/**
 * Fills in genres for imported games. Steam first: one quick request for the
 * whole list. Then Wikidata for what Steam doesn't sell (mostly console
 * exclusives): batched by Wikipedia article title, pausing if Wikidata asks.
 * Results are saved as they arrive; anything left over is retried the next
 * time the app opens.
 */
const NOTICE_ID = 'genre-lookup';

function progress(message: string) {
  notifications.update({
    id: NOTICE_ID,
    title: 'Looking up genres',
    message,
    loading: true,
    autoClose: false,
    withCloseButton: false,
  });
}

export async function runGenreBackfill(): Promise<void> {
  if (running) return;
  const queue = pending();
  if (!queue.length) return;
  if (!(await fetchStatus()).online) return;

  running = true;
  const total = queue.length;
  notifications.show({
    id: NOTICE_ID,
    title: 'Looking up genres',
    message: `Matching ${total} ${total === 1 ? 'game' : 'games'} on Steam`,
    loading: true,
    autoClose: false,
    withCloseButton: false,
  });
  const apply = useStore.getState().applyGenres;
  const done = () => {
    const games = useStore.getState().customGames;
    return queue.filter((g) => games[g.id]?.genreSource && games[g.id].genreSource !== 'none').length;
  };
  // Failures are never shown as errors: a source that's down or busy is
  // simply tried again the next time the app opens.
  try {
    let rest = queue;
    try {
      const steam = await fetchGenres(queue, 'steam');
      apply(steam.results);
      rest = queue.filter((g) => !steam.results[g.id]);
    } catch {
      // Steam unreachable: the other sources still get a turn.
    }

    // IGDB next: it covers console games Steam doesn't sell. Games it misses go on to Wikidata.
    if (rest.length && (await fetchStatus()).igdb) {
      for (let i = 0; i < rest.length; i += 40) {
        progress(`Found ${done()} of ${total}. Checking IGDB for the other ${rest.length - i}.`);
        try {
          apply((await fetchGenres(rest.slice(i, i + 40), 'igdb')).results);
        } catch {
          break;
        }
      }
      const after = useStore.getState().customGames;
      rest = rest.filter((g) => !after[g.id]?.genreSource);
    }

    let stalls = 0;
    while (rest.length) {
      progress(`Found ${done()} of ${total}. Checking Wikidata for the other ${rest.length}.`);
      const { results, retryAfter } = await fetchGenres(rest.slice(0, 200), 'wikidata');
      apply(results);
      const before = rest.length;
      rest = rest.filter((g) => !results[g.id]);
      if (retryAfter) {
        progress(`Found ${done()} of ${total}. Wikidata asked for a short pause; continuing in ${retryAfter} seconds.`);
        await sleep(retryAfter * 1000);
      } else if (rest.length === before && ++stalls >= 3) break;
    }
  } catch {
    // Quietly stop; the summary below says what's left.
  } finally {
    running = false;
    const found = done();
    const left = pending().length;
    notifications.update({
      id: NOTICE_ID,
      loading: false,
      title: 'Genres updated',
      message:
        `Found genres for ${found} of ${total} ${total === 1 ? 'game' : 'games'}.` +
        (left ? ` ${left} more will be looked up next time you open Savepoint.` : ''),
      autoClose: 5000,
      withCloseButton: true,
    });
  }
}

/** Starts the backfill on app load and whenever new games are imported or wishlisted. */
export function useGenreBackfill() {
  const customCount = useStore((s) => Object.keys(s.customGames).length + s.wishlist.length);
  useEffect(() => {
    void runGenreBackfill();
  }, [customCount]);
}

/** Look up a single game right away (used when its page is open). */
export async function lookupOne(game: Game): Promise<void> {
  const apply = useStore.getState().applyGenres;
  const steam = await fetchGenres([game], 'steam');
  apply(steam.results);
  if (steam.results[game.id]) return;
  const igdb = await fetchGenres([game], 'igdb');
  apply(igdb.results);
  if (igdb.results[game.id]) return;
  apply((await fetchGenres([game], 'wikidata')).results);
}
