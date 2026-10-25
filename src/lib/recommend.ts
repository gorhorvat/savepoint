import type { Game, PlatformId } from '../types';
import { favoriteBoost, type Favorites } from './favorites';
import type { LibraryGame } from './library';
import { ownedKey, ownedKeys } from './match';
import { tasteFactor } from './progress';

export interface Weighted {
  name: string;
  weight: number; // 0..1, relative to the strongest entry
  minutes: number;
}

export interface TasteProfile {
  genres: Weighted[];
  subgenres: Weighted[];
  tags: Weighted[];
}

// Diminishing returns, so one 200-hour game doesn't drown out everything else.
const playWeight = (minutes: number) => Math.pow(minutes / 60, 0.6);

function rank(map: Map<string, { w: number; m: number }>): Weighted[] {
  const list = [...map.entries()].map(([name, v]) => ({ name, weight: v.w, minutes: v.m }));
  const max = Math.max(1e-9, ...list.map((x) => x.weight));
  return list.map((x) => ({ ...x, weight: x.weight / max })).sort((a, b) => b.weight - a.weight);
}

export function tasteProfile(lib: LibraryGame[]): TasteProfile {
  const g = new Map<string, { w: number; m: number }>();
  const s = new Map<string, { w: number; m: number }>();
  const t = new Map<string, { w: number; m: number }>();
  const add = (map: typeof g, key: string, w: number, m: number) => {
    const prev = map.get(key) ?? { w: 0, m: 0 };
    map.set(key, { w: prev.w + w, m: prev.m + m });
  };
  for (const item of lib) {
    // Ratings and drops shape taste, not just hours.
    const w = playWeight(item.totalMinutes) * tasteFactor(item.progress);
    item.game.genres.forEach((x) => add(g, x, w, item.totalMinutes));
    item.game.subgenres.forEach((x) => add(s, x, w, item.totalMinutes));
    item.game.tags.forEach((x) => add(t, x, w, item.totalMinutes));
  }
  return { genres: rank(g), subgenres: rank(s), tags: rank(t) };
}

/** Scores how well a game fits a taste profile (higher is better, 0 = nothing in common). */
export function tasteMatcher(profile: TasteProfile): (game: Game) => number {
  const gw = new Map(profile.genres.map((x) => [x.name, x.weight]));
  const sw = new Map(profile.subgenres.map((x) => [x.name, x.weight]));
  const tw = new Map(profile.tags.map((x) => [x.name, x.weight]));
  return (game) => {
    const features =
      game.subgenres.reduce((n, x) => n + (sw.get(x) ?? 0) * 1.5, 0) +
      game.genres.reduce((n, x) => n + (gw.get(x) ?? 0), 0) +
      game.tags.reduce((n, x) => n + (tw.get(x) ?? 0) * 0.5, 0);
    const size = Math.sqrt(game.subgenres.length * 1.5 + game.genres.length + game.tags.length * 0.5);
    return features / Math.max(1, size);
  };
}

export interface Recommendation {
  game: Game;
  score: number;
  /** 0..100 relative to the best recommendation. */
  fit: number;
  because?: LibraryGame;
  sharedTraits: string[];
  onYourPlatforms: PlatformId[];
  /** Your favourite franchise this game belongs to, if any. */
  favoriteFranchise?: string;
  /** Its genres you marked as favourites. */
  favoriteGenres: string[];
}

function overlap(a: Game, b: Game) {
  const shared = [
    ...a.subgenres.filter((x) => b.subgenres.includes(x)),
    ...a.genres.filter((x) => b.genres.includes(x)),
  ];
  const tags = a.tags.filter((x) => b.tags.includes(x));
  return {
    score:
      a.subgenres.filter((x) => b.subgenres.includes(x)).length * 2 +
      a.genres.filter((x) => b.genres.includes(x)).length +
      tags.length * 0.5,
    shared,
  };
}

export function recommend(
  lib: LibraryGame[],
  // pool: the live suggestion pool (lib/suggestions.ts), the only source of candidates.
  opts: {
    owned: PlatformId[];
    exclude: Set<string>;
    pool: Game[];
    favorites?: Favorites;
    /** More titles you own that aren't in the library (physical copies typed in by hand). */
    alsoOwned?: string[];
  },
): Recommendation[] {
  const fit = tasteMatcher(tasteProfile(lib));
  const played = new Set(lib.map((l) => l.game.id));
  // Suggestions get their own ids, so also skip games you own by app id, and by
  // title on any platform and in any version (Gold, Cloud, Deluxe…).
  const playedTitles = new Set([...lib.map((l) => l.game.title), ...(opts.alsoOwned ?? [])].flatMap(ownedKeys));
  const playedApps = new Set(lib.map((l) => l.game.steamAppId).filter(Boolean));

  const recs: Recommendation[] = [];
  const seen = new Set<string>();
  for (const game of opts.pool) {
    if (played.has(game.id) || opts.exclude.has(game.id) || seen.has(game.id)) continue;
    if (game.steamAppId && playedApps.has(game.steamAppId)) continue;
    if (playedTitles.has(ownedKey(game.title))) continue;
    seen.add(game.id);
    const onYourPlatforms = game.availableOn.filter((p) => opts.owned.includes(p));
    const fav = opts.favorites ? favoriteBoost(game, opts.favorites) : { factor: 1, genres: [] };
    // A favourite franchise counts even when the store lists no genres for the game.
    const base = fav.franchise ? Math.max(fit(game), 0.5) : fit(game);
    // Games you can't play on anything you own sink to the bottom.
    const score = base * fav.factor * (onYourPlatforms.length ? 1 : 0.4);
    if (score <= 0) continue;

    let because: LibraryGame | undefined;
    let best = 0;
    let sharedTraits: string[] = [];
    for (const item of lib) {
      const o = overlap(game, item.game);
      const s = o.score * Math.log1p(item.totalMinutes / 60) * tasteFactor(item.progress);
      if (s > best) {
        best = s;
        because = item;
        sharedTraits = o.shared;
      }
    }
    recs.push({
      game,
      score,
      fit: 0,
      because,
      sharedTraits: [...new Set(sharedTraits)],
      onYourPlatforms,
      favoriteFranchise: fav.franchise,
      favoriteGenres: fav.genres,
    });
  }
  recs.sort((a, b) => b.score - a.score);
  const top = recs[0]?.score ?? 1;
  return recs.map((r) => ({ ...r, fit: Math.round((r.score / top) * 100) }));
}
