import { useEffect, useMemo, useState } from 'react';
import type { Game } from '../types';
import { fetchDiscoverPool } from './api';
import type { LibraryGame } from './library';
import { tasteProfile } from './recommend';
import { useStore, watchedGames } from './store';
import { watchedForTaste } from './streaming';

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
  const streamTaste = useStore((s) => s.streamTaste);
  const profile = useMemo(() => tasteProfile(lib, watchedForTaste(streamTaste)), [lib, streamTaste]);
  const { favoriteGenres, favoriteFranchises } = useStore((s) => s.profile);
  // Favourites come first, then what your hours say. A favourite can be a
  // genre or a sub-genre; the server looks each name up as both.
  const subgenres = [...new Set([...favoriteGenres, ...profile.subgenres.map((x) => x.name)])].slice(
    0,
    Math.max(6, favoriteGenres.length),
  );
  const genres = [...new Set([...favoriteGenres, ...profile.genres.map((x) => x.name)])].slice(
    0,
    Math.max(4, favoriteGenres.length),
  );
  const franchises = favoriteFranchises.slice(0, 8);
  // Bump the leading version when the server's pool changes shape (v3: franchises).
  const key = ['v3', ...subgenres, '|', ...genres, '|', ...franchises].join(',');
  const stale =
    !!(subgenres.length || franchises.length) &&
    (suggested.key !== key || Date.now() - new Date(suggested.fetchedAt).getTime() > POOL_TTL);

  useEffect(() => {
    if (!stale || failed === key) return;
    let cancelled = false;
    // Pages that need the pool at the same time share one request.
    if (inFlight?.key !== key) {
      const promise = fetchDiscoverPool(subgenres, genres, franchises)
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
    // The games your streamers play are candidates too.
    games: useMemo(
      () => [...Object.values(suggested.games), ...Object.values(watchedGames(streamTaste))],
      [suggested.games, streamTaste],
    ),
    loading: stale && failed !== key,
  };
}
