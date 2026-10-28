import { PLATFORM_BY_ID, PLATFORMS } from '../data/platforms';
import type { Game, PlatformId, WishlistItem } from '../types';
import { formatPlaytime } from './format';
import { ownedPlatforms, platformTotals, type LibraryGame } from './library';
import { normalizeTitle } from './match';
import { recommend, tasteProfile, type Recommendation } from './recommend';
import { watchedForTaste } from './streaming';
import { useStore } from './store';
import { makeFavorites } from './favorites';

/**
 * Plain-text snapshot sent to the local model as context. It includes a
 * candidate list from Savepoint's own recommender, so a small model picks
 * from real games with known platforms instead of recalling them.
 * Kept to roughly 5K tokens so it fits the model's context window.
 */
export function buildContext(
  lib: LibraryGame[],
  wishlist: Game[],
  dismissed: Game[],
  candidates: Recommendation[],
): string {
  const totals = platformTotals(lib);
  const owned = ownedPlatforms(lib);
  const watched = watchedForTaste(useStore.getState().streamTaste);
  const profile = tasteProfile(lib, watched);
  const lines: string[] = [];
  lines.push(`Platforms owned: ${owned.map((p) => PLATFORM_BY_ID[p].name).join(', ') || 'none yet'}`);
  lines.push(`Hours per platform: ${PLATFORMS.map((p) => `${p.name} ${formatPlaytime(totals[p.id])}`).join('; ')}`);
  lines.push(
    `Favourite sub-genres by play time: ${profile.subgenres
      .slice(0, 10)
      .map((s) => `${s.name} (${formatPlaytime(s.minutes)})`)
      .join(', ')}`,
  );
  const { favoriteGenres, favoriteFranchises } = useStore.getState().profile;
  if (favoriteGenres.length || favoriteFranchises.length) {
    lines.push(
      `Marked as favourites by the player (weigh these heavily): genres ${favoriteGenres.join(', ') || 'none'}; franchises ${
        favoriteFranchises.join(', ') || 'none'
      }`,
    );
  }
  lines.push(
    `Favourite tags: ${profile.tags
      .slice(0, 12)
      .map((t) => t.name)
      .join(', ')}`,
  );
  lines.push('');
  const played = lib.filter((g) => g.totalMinutes > 0);
  lines.push(`Played games (${played.length}, most played first${played.length > 50 ? ', top 50 shown' : ''}):`);
  for (const g of played.slice(0, 50)) {
    const per = g.plays.map((p) => `${PLATFORM_BY_ID[p.platform].short} ${formatPlaytime(p.minutes)}`).join(', ');
    const genres = [...g.game.genres, ...g.game.subgenres].join('/') || 'genres unknown';
    lines.push(
      `- ${g.game.title}: ${formatPlaytime(g.totalMinutes)} total (${per}); ${genres}; last played ${g.lastPlayed?.slice(0, 10) ?? 'unknown'}`,
    );
  }
  lines.push('');
  const shelf = lib.filter((g) => g.physical.length);
  if (shelf.length) {
    lines.push(
      `Physical copies owned (${shelf.length}): ${shelf
        .map(
          (g) =>
            `${g.game.title} (${g.physical.map((c) => c.platform).join(', ')}${g.totalMinutes ? '' : ', not played yet'})`,
        )
        .join('; ')}`,
    );
  }
  lines.push(`Wishlist: ${wishlist.map((w) => w.title).join(', ') || 'empty'}`);
  if (dismissed.length) lines.push(`Marked "not interested": ${dismissed.map((d) => d.title).join(', ')}`);
  if (watched.length) {
    lines.push(
      `Games their favourite streamers play (they like watching these): ${watched
        .slice(0, 12)
        .map((w) => `${w.title} (${w.channels.slice(0, 2).join(', ')})`)
        .join('; ')}`,
    );
  }
  lines.push('');
  lines.push('Candidate games from live Steam and Nintendo eShop suggestions, best match first:');
  for (const r of candidates) {
    const g = r.game;
    const on = g.availableOn.map((p) => PLATFORM_BY_ID[p].name).join(', ');
    const why = r.because
      ? `; similar to ${r.because.game.title} (${formatPlaytime(r.because.totalMinutes)} played)`
      : '';
    lines.push(
      `- ${g.title} (${[g.developer, g.year].filter(Boolean).join(', ')}): ${[...g.genres, ...g.subgenres].join('/')}; on ${on}${why}. ${g.blurb ?? ''}`,
    );
  }
  return lines.join('\n');
}

/**
 * Bold list-item titles in a reply that aren't in the suggestion pool or the
 * player's library, so the UI can mark them as unchecked.
 */
export function findOffCatalogTitles(text: string, library: LibraryGame[], pool: Game[]): string[] {
  const known = new Set([
    ...pool.map((g) => normalizeTitle(g.title)),
    ...library.map((l) => normalizeTitle(l.game.title)),
  ]);
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*(?:[-*•]|\d+[.)])\s+\*\*([^*]+?)\*\*/gm)) {
    const title = m[1].replace(/[:\s]+$/, '').trim();
    if (title && !known.has(normalizeTitle(title)) && !out.includes(title)) out.push(title);
  }
  return out.slice(0, 6);
}

/** Suggested games named in a reply, so the UI can offer quick links. */
export function findMentionedGames(text: string, exclude: Set<string>, pool: Game[]): Game[] {
  const norm = ` ${normalizeTitle(text)} `;
  return pool.filter((g) => !exclude.has(g.id) && norm.includes(` ${normalizeTitle(g.title)} `)).slice(0, 6);
}

// ---------------------------------------------------------------- offline replies

const PLATFORM_WORDS: [RegExp, PlatformId][] = [
  [/\bswitch\b|\bnintendo\b/i, 'switch'],
  [/\bsteam\b|\bpc\b/i, 'steam'],
  [/\bps[45]?\b|\bplaystation\b/i, 'playstation'],
  [/\bxbox\b/i, 'xbox'],
  [/\bepic\b/i, 'epic'],
];

const MOOD_TAGS: [RegExp, string[]][] = [
  [/relax|cozy|cosy|chill|calm/i, ['cozy', 'relaxing', 'casual', 'charming', 'cute']],
  [/short|weekend|quick/i, ['short', 'short-runs']],
  [/long|epic length|winter|hundred/i, ['long', 'story-rich']],
  [/co-?op|friend|partner|together/i, ['co-op', 'couch-co-op', 'multiplayer']],
  [/story|narrative|writing/i, ['story-rich', 'writing', 'choices-matter']],
  [/hard|challeng|difficult/i, ['hard', 'boss-fights']],
  [/scary|horror/i, ['horror', 'atmospheric']],
];

/**
 * Built-in reply used when Ollama isn't reachable: reads platform, genre
 * and mood words from the question and filters the recommender's list.
 */
export function offlineReply(question: string, lib: LibraryGame[], exclude: Set<string>, pool: Game[]): string {
  const owned = ownedPlatforms(lib);
  const { favoriteGenres, favoriteFranchises } = useStore.getState().profile;
  const favorites = makeFavorites(favoriteGenres, favoriteFranchises);
  const watched = watchedForTaste(useStore.getState().streamTaste);
  let recs: Recommendation[] = recommend(lib, { owned, exclude, pool, favorites, watched });

  const platform = PLATFORM_WORDS.find(([re]) => re.test(question))?.[1];
  if (platform) recs = recs.filter((r) => r.game.availableOn.includes(platform));

  const q = question.toLowerCase();
  const genreWords = new Set(
    [...pool, ...lib.map((l) => l.game)].flatMap((g) => [...g.genres, ...g.subgenres]).map((x) => x.toLowerCase()),
  );
  const named = [...genreWords].filter((g) => q.includes(g.replace(/-/g, ' ')) || q.includes(g));
  if (named.length) {
    recs = recs.filter((r) => [...r.game.genres, ...r.game.subgenres].some((x) => named.includes(x.toLowerCase())));
  }

  // "like X": prefer games that share sub-genres with a game they name.
  const likeGame = lib.find((l) => q.includes(l.game.title.toLowerCase()))?.game;
  if (likeGame) {
    recs = recs
      .map((r) => ({
        r,
        s: r.game.subgenres.filter((x) => likeGame.subgenres.includes(x)).length * 2 + r.score,
      }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
  }

  const moods = MOOD_TAGS.filter(([re]) => re.test(question)).flatMap(([, tags]) => tags);
  if (moods.length) {
    const withMood = recs.filter((r) => r.game.tags.some((t) => moods.includes(t)));
    if (withMood.length) recs = withMood;
  }

  const picks = recs.slice(0, 4);
  if (!picks.length) {
    return "I couldn't find anything in Savepoint's catalog that fits all of that. Try fewer filters, like just a platform or a genre.";
  }

  const where = platform ? ` on ${PLATFORM_BY_ID[platform].name}` : '';
  const out = [`Here's what fits${where}, based on where your hours go:`, ''];
  for (const r of picks) {
    const because = r.because
      ? `You spent ${formatPlaytime(r.because.totalMinutes)} in ${r.because.game.title}${
          r.sharedTraits.length ? `, and this is also ${r.sharedTraits.slice(0, 2).join(' and ').toLowerCase()}` : ''
        }.`
      : '';
    const on = r.game.availableOn.map((p) => PLATFORM_BY_ID[p].short).join(', ');
    out.push(`- **${r.game.title}**: ${r.game.blurb ?? ''} ${because} Available on ${on}.`);
  }
  return out.join('\n');
}

export function wishlistGames(items: WishlistItem[], resolve: (id: string) => Game | undefined): Game[] {
  return items.map((w) => resolve(w.gameId)).filter((g): g is Game => !!g);
}
