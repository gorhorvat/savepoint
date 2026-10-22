import { useEffect, useMemo, useState } from 'react';
import type { Game } from '../types';
import { fetchDiscoverPool } from './api';
import type { LibraryGame } from './library';
import { tasteProfile } from './recommend';
import { useStore } from './store';

// The live suggestion pool behind Play next, the assistant and "similar
// games": well-reviewed Steam games and popular Switch games for your top
// genres, fetched from the server (which caches it for a day). Nothing here
// comes from a fixed list.

const POOL_TTL = 24 * 3600 * 1000;
let inFlight: { key: string; promise: Promise<void> } | null = null;

/** Keeps the suggestion pool in step with your taste; refreshed daily. */
export function useSuggestionPool(lib: LibraryGame[]): { games: Game[]; loading: boolean } {
  const suggested = useStore((s) => s.suggested);
  const [failed, setFailed] = useState('');
  const profile = useMemo(() => tasteProfile(lib), [lib]);
  const subgenres = profile.subgenres.slice(0, 6).map((x) => x.name);
  const genres = profile.genres.slice(0, 4).map((x) => x.name);
  // Bump the leading version when the server's pool changes shape (v2: Switch games).
  const key = ['v2', ...subgenres, '|', ...genres].join(',');
  const stale =
    !!subgenres.length && (suggested.key !== key || Date.now() - new Date(suggested.fetchedAt).getTime() > POOL_TTL);

  useEffect(() => {
    if (!stale || failed === key) return;
    let cancelled = false;
    // Pages that need the pool at the same time share one request.
    if (inFlight?.key !== key) {
      const promise = fetchDiscoverPool(subgenres, genres)
        .then((found) => useStore.getState().setSuggested(key, found))
        .finally(() => {
          if (inFlight?.promise === promise) inFlight = null;
        });
      inFlight = { key, promise };
    }
    inFlight.promise.catch(() => !cancelled && setFailed(key));
    return () => {
      cancelled = true;
    };
    // The key stands in for both lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stale, failed]);

  return {
    games: useMemo(() => Object.values(suggested.games), [suggested.games]),
    loading: stale && failed !== key,
  };
}
