import type { Game, PlatformId, WatchedGame } from '../types';
import { favoriteBoost, favoriteFranchise, isFavoriteGenre, type Favorites } from './favorites';
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

/** How much your streamers' games count, next to everything you play (0.25 = a quarter). */
const STREAM_SHARE = 0.25;

/**
 * Your taste: genres, sub-genres and tags weighted by your hours. The games
 * your favourite streamers play (`watched`) add a quarter on top, or are all
 * of it when you haven't played anything yet.
 */
export function tasteProfile(lib: LibraryGame[], watched: WatchedGame[] = []): TasteProfile {
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
  if (watched.length) {
    const libTotal = lib.reduce((n, item) => n + playWeight(item.totalMinutes) * tasteFactor(item.progress), 0);
    const watchedTotal = watched.reduce((n, x) => n + x.weight, 0) || 1;
    const scale = libTotal > 0 ? (STREAM_SHARE * libTotal) / watchedTotal : 1;
    for (const x of watched) {
      const w = x.weight * scale;
      x.genres.forEach((name) => add(g, name, w, 0));
      x.subgenres.forEach((name) => add(s, name, w, 0));
      x.tags.forEach((name) => add(t, name, w, 0));
    }
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

/**
 * How well a game fits you, as an absolute 0–100 (not relative to other
 * suggestions). Sub-genres ("Survival horror") say much more about a game
 * than broad genres ("Action"), so favourites of each kind count differently:
 * - 100: a favourite franchise, two favourite sub-genres, or a favourite
 *   sub-genre plus the game's main broad genre (the store's first) as a favourite;
 * - 80–95: one favourite sub-genre, by how well the rest fits what you play;
 * - 60–90: only favourite broad genres (they cover half of all games, so on
 *   their own they never reach 100);
 * - 0–80: no favourites, by how much of the game is genres you spend your
 *   hours in.
 * Otherwise the order genres are listed in doesn't matter: stores sort them
 * by player votes, which says little about what the game means to you.
 */
export function matchPercent(game: Game, profile: TasteProfile, favs?: Favorites): number {
  const isFav = (name: string) => !!favs && isFavoriteGenre(name, favs);
  const favSubs = game.subgenres.filter(isFav);
  const favBroad = game.genres.filter(isFav);
  if (favs && favoriteFranchise(game, favs)) return 100;
  const mainIsFav = !!game.genres[0] && isFav(game.genres[0]);
  if (favSubs.length >= 2 || (favSubs.length >= 1 && mainIsFav)) return 100;

  // Taste: each genre counts by how much you play it (your top one = 1).
  // Sub-genres say more about a game than broad genres, so they weigh more.
  const gw = new Map(profile.genres.map((x) => [x.name, x.weight]));
  const sw = new Map(profile.subgenres.map((x) => [x.name, x.weight]));
  const traits = [
    ...game.subgenres.map((s) => ({ name: s, weight: 1, taste: sw.get(s) ?? gw.get(s) ?? 0 })),
    ...game.genres.map((g) => ({ name: g, weight: 0.5, taste: gw.get(g) ?? sw.get(g) ?? 0 })),
  ].filter((t) => !isFav(t.name));
  const total = traits.reduce((n, t) => n + t.weight, 0);
  // A game tagged only "Action" says little: it takes about two specific
  // genres' worth of information to reach the top of the range.
  const evidence = Math.max(total, 2.5);
  // Square root: a genre you play half as much as your favourite still fits well.
  const taste = traits.reduce((n, t) => n + t.weight * Math.sqrt(t.taste), 0) / evidence;

  if (favSubs.length) return Math.round(80 + 15 * taste);
  if (favBroad.length) return Math.round(60 + 30 * taste);
  return Math.round(80 * taste);
}

export interface Recommendation {
  game: Game;
  score: number;
  /** 0..100: how well it fits you (see matchPercent). */
  fit: number;
  because?: LibraryGame;
  sharedTraits: string[];
  onYourPlatforms: PlatformId[];
  /** Your favourite franchise this game belongs to, if any. */
  favoriteFranchise?: string;
  /** Its genres you marked as favourites. */
  favoriteGenres: string[];
  /** Your favourite streamers who play it. */
  streamedBy?: string[];
}

/** Your streamers' games by title (any version), for "streamed by" and a small boost. */
export function streamerIndex(watched: WatchedGame[] = []): Map<string, string[]> {
  return new Map(watched.map((w) => [ownedKey(w.title), w.channels]));
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
    /** The games your favourite streamers play (lib/streaming.ts). */
    watched?: WatchedGame[];
  },
): Recommendation[] {
  const profile = tasteProfile(lib, opts.watched);
  const streamers = streamerIndex(opts.watched);
  const fit = tasteMatcher(profile);
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
    // Your streamers play it: a nudge up, not a jump.
    const streamedBy = streamers.get(ownedKey(game.title));
    // Games you can't play on anything you own sink to the bottom.
    const score = base * fav.factor * (streamedBy ? 1.25 : 1) * (onYourPlatforms.length ? 1 : 0.4);
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
      fit: Math.min(100, matchPercent(game, profile, opts.favorites) + (streamedBy ? 8 : 0)),
      streamedBy,
      because,
      sharedTraits: [...new Set(sharedTraits)],
      onYourPlatforms,
      favoriteFranchise: fav.franchise,
      favoriteGenres: fav.genres,
    });
  }
  // Best match first; games not on your platforms sink; ties go to the finer score.
  const rank = (r: Recommendation) => r.fit * (r.onYourPlatforms.length ? 1 : 0.4);
  return recs.sort((a, b) => rank(b) - rank(a) || b.score - a.score);
}
