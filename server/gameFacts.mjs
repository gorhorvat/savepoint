// Current facts about a game, for the assistant's "look up game" tool: the
// model's own knowledge stops at its training cutoff, so recent releases
// would otherwise look unreleased. Free sources only: the store searches
// Savepoint already uses, Steam's public review summary, and Wikipedia.
import { normalizeTitle } from './genres.mjs';
import { searchGames } from './search.mjs';

const USER_AGENT = 'Savepoint/0.1 (self-hosted game library app)';
const cache = new Map();

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Steam's player review summary, e.g. "Very Positive" from 12,345 reviews. */
async function steamReviews(appid) {
  const d = await getJson(
    `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`,
  );
  const q = d.query_summary;
  if (!q?.total_reviews) return null;
  return {
    rating: q.review_score_desc,
    positivePercent: Math.round((q.total_positive / q.total_reviews) * 100),
    reviews: q.total_reviews,
  };
}

/** Wikipedia's intro and Reception section for the game's article, if there is one. */
async function wikipedia(title) {
  const search = await getJson(
    `https://en.wikipedia.org/w/api.php?${new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'search',
      srsearch: `${title} video game`,
      srlimit: '5',
    })}`,
  );
  const want = normalizeTitle(title);
  // The article must be about this game, not the series or a sequel.
  const hit = (search.query?.search ?? []).find((h) => {
    const t = normalizeTitle(h.title.replace(/\s*\([^)]*\)\s*$/, ''));
    return t === want;
  });
  if (!hit) return null;
  const page = await getJson(
    `https://en.wikipedia.org/w/api.php?${new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'extracts',
      explaintext: '1',
      exsectionformat: 'plain',
      titles: hit.title,
    })}`,
  );
  const text = Object.values(page.query?.pages ?? {})[0]?.extract ?? '';
  if (!text) return null;
  const reception = text.indexOf('\nReception\n');
  return {
    article: hit.title,
    summary: text.slice(0, 700).trim(),
    reception: reception >= 0 ? text.slice(reception + 11, reception + 11 + 1400).trim() : null,
  };
}

/**
 * Everything Savepoint can find about one game. Missing pieces are left out
 * rather than guessed; `found: false` means no source knew the title.
 */
export async function lookupGameFacts(title) {
  const key = normalizeTitle(title);
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - 6 * 3600 * 1000) return hit.facts;

  const [store, wiki] = await Promise.all([
    searchGames(title).catch(() => []),
    wikipedia(title).catch(() => null),
  ]);
  const match = store.find((g) => normalizeTitle(g.title) === key) ?? store[0];
  const reviews = match?.steamAppId ? await steamReviews(match.steamAppId).catch(() => null) : null;

  const facts = {
    found: !!(match || wiki),
    title: match?.title ?? wiki?.article ?? title,
    ...(match && {
      platforms: match.availableOn.map((p) => ({ steam: 'PC (Steam)', epic: 'PC (Epic)', playstation: 'PlayStation', switch: 'Nintendo Switch' })[p]),
      developer: match.developer,
      releaseDate: match.releaseDate?.slice(0, 10),
      released: match.comingSoon ? false : match.releaseDate ? Date.parse(match.releaseDate) <= Date.now() : undefined,
      releaseLabel: match.releaseLabel,
      storeDescription: match.blurb,
      genres: [...(match.genres ?? []), ...(match.subgenres ?? [])],
    }),
    ...(reviews && { steamPlayerReviews: reviews }),
    ...(wiki && { wikipedia: wiki }),
  };
  cache.set(key, { at: Date.now(), facts });
  return facts;
}
