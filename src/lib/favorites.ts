import { useMemo } from 'react';
import type { Game } from '../types';
import { useStore } from './store';

// Your favourite genres and franchises (set on the Profile page). Games that
// match are boosted in Play next and "More like this", and marked across the app.

export interface Favorites {
  /** Lower-cased genre and sub-genre names. */
  genres: Set<string>;
  /** Franchise names as you typed them, with their normalized form for matching. */
  franchises: { name: string; key: string }[];
}

/** Lower case, no ™/®, punctuation as spaces: "Resident Evil™ 4: Remake" -> "resident evil 4 remake". */
export function franchiseKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function makeFavorites(genres: string[], franchises: string[]): Favorites {
  return {
    genres: new Set(genres.map((g) => g.toLowerCase())),
    franchises: franchises.map((name) => ({ name, key: franchiseKey(name) })).filter((f) => f.key),
  };
}

export function useFavorites(): Favorites {
  const genres = useStore((s) => s.profile.favoriteGenres);
  const franchises = useStore((s) => s.profile.favoriteFranchises);
  return useMemo(() => makeFavorites(genres, franchises), [genres, franchises]);
}

/** The favourite franchise a game belongs to, matched as whole words in its title. */
export function favoriteFranchise(game: Game, favs: Favorites): string | undefined {
  if (!favs.franchises.length) return undefined;
  const title = ` ${franchiseKey(game.title)} `;
  return favs.franchises.find((f) => title.includes(` ${f.key} `))?.name;
}

/** The game's genres and sub-genres that are favourites. */
export function favoriteGenresOf(game: Game, favs: Favorites): string[] {
  if (!favs.genres.size) return [];
  return [...game.genres, ...game.subgenres].filter((g) => favs.genres.has(g.toLowerCase()));
}

export const isFavoriteGenre = (name: string, favs: Favorites) => favs.genres.has(name.toLowerCase());

/**
 * How much to lift a suggestion's score: favourite genres lift it a lot, a
 * favourite franchise even more, so these games come first.
 */
export function favoriteBoost(game: Game, favs: Favorites): { factor: number; franchise?: string; genres: string[] } {
  const genres = favoriteGenresOf(game, favs);
  const franchise = favoriteFranchise(game, favs);
  const factor = (1 + 0.6 * Math.min(genres.length, 3)) * (franchise ? 2.5 : 1);
  return { factor, franchise, genres };
}

/**
 * Series that show up more than once in your library, as franchise
 * suggestions: the part of each title before a number, colon or dash.
 */
export function seriesInLibrary(titles: string[]): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const title of titles) {
    const base = title
      .replace(/[™®©]/g, '')
      .split(/\s*[:\-–—(]\s*|\s+(?:\d+|[IVX]{1,4})(?:\s|$)/)[0]
      .trim();
    const key = franchiseKey(base);
    if (key.length < 3 || key.split(' ').length > 4) continue;
    const prev = counts.get(key);
    counts.set(key, { name: prev?.name ?? base, n: (prev?.n ?? 0) + 1 });
  }
  // Series you have several games of first, then the rest alphabetically.
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((c) => c.name);
}
