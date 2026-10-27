// Game search across PC (Steam, Epic) and Nintendo Switch / Switch 2, the
// Steam wishlist, and live Nintendo eShop prices.
import { currentPsnAuth } from './platformLogins.mjs';
import { makeUniversalSearch } from 'psn-api';
import { normalizeTitle, steamAppIndex, steamItems } from './genres.mjs';
import { igdbGame } from './igdb.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const USER_AGENT = 'Savepoint/0.1 (self-hosted game library app)';

// Store pages that share a game's name but aren't the game.
const NOT_A_GAME =
  /\b(soundtrack|ost|demo|playtest|dedicated server|sdk|artbook|art book|wallpaper|season pass|expansion pass|dlc|upgrade pack|upgrade|chapter)\b/i;

// ---------------------------------------------------------------- Nintendo

// nintendo.com's own store search (Algolia). The key is the public,
// search-only key the website ships to every visitor; it isn't an official API
// and may change.
const ALGOLIA = {
  url: 'https://U3B6GR4UA3-dsn.algolia.net/1/indexes/store_game_en_us/query',
  appId: 'U3B6GR4UA3',
  key: 'a29c6927638bfd8cee23993e51e721c9',
};

export const NINTENDO_GENRES = {
  Action: { g: 'Action' },
  Adventure: { g: 'Adventure' },
  // Current eShop labels first; the older spellings are kept for cached results.
  'Role playing': { g: 'RPG' },
  'Role-Playing': { g: 'RPG' },
  Shooting: { g: 'Shooter' },
  'Narrative adventure': { g: 'Adventure', s: 'Narrative adventure' },
  Tabletop: { t: 'tabletop' },
  Platformer: { g: 'Platformer' },
  Puzzle: { g: 'Puzzle' },
  Racing: { g: 'Racing' },
  Shooter: { g: 'Shooter' },
  'First-Person': { g: 'Shooter', s: 'First-person shooter' },
  Simulation: { g: 'Simulation' },
  Sports: { g: 'Sports' },
  Strategy: { g: 'Strategy' },
  Fighting: { g: 'Fighting' },
  Arcade: { g: 'Action' },
  Music: { s: 'Rhythm action', t: 'music' },
  Party: { t: 'party' },
  Multiplayer: { t: 'multiplayer' },
};

function nintendoImage(path) {
  return path ? `https://assets.nintendo.com/image/upload/c_fill,w_460,h_215/${path}` : undefined;
}

async function nintendoHits(query, hitsPerPage = 40) {
  const r = await fetch(ALGOLIA.url, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': ALGOLIA.appId,
      'X-Algolia-API-Key': ALGOLIA.key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, hitsPerPage }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Nintendo search: HTTP ${r.status}`);
  const data = await r.json();
  return (data.hits ?? []).filter(
    (h) => h.topLevelCategoryCode === 'GAMES' && h.title && !h.dlcType && !NOT_A_GAME.test(h.title),
  );
}

/** The eShop's most popular released games with a genre label, e.g. "Role playing". */
export async function nintendoByGenre(label, count = 60) {
  const r = await fetch(ALGOLIA.url, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': ALGOLIA.appId,
      'X-Algolia-API-Key': ALGOLIA.key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: '',
      hitsPerPage: count,
      filters: `topLevelCategoryCode:GAMES AND gameGenreLabels:"${label.replace(/"/g, '')}"`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Nintendo search: HTTP ${r.status}`);
  const data = await r.json();
  return (data.hits ?? [])
    .filter((h) => h.title && !h.dlcType && !NOT_A_GAME.test(h.title))
    .map(fromNintendoHit)
    .filter((g) => !g.comingSoon);
}

function fromNintendoHit(h) {
  const genres = new Set();
  const subgenres = new Set();
  const tags = new Set();
  for (const label of h.gameGenreLabels ?? []) {
    const m = NINTENDO_GENRES[label];
    if (m?.g) genres.add(m.g);
    if (m?.s) subgenres.add(m.s);
    if (m?.t) tags.add(m.t);
  }
  const title = h.title
    .replace(/[™®©]/g, '')
    .replace(/\s*[:\-–]\s*Nintendo Switch.*Edition\s*$/i, '')
    .trim();
  return {
    title,
    availableOn: ['switch'],
    switchVersions: [h.platformCode === 'NINTENDO_SWITCH_2' ? 'Switch 2' : 'Switch'],
    nsuid: h.nsuid,
    imageUrl: nintendoImage(h.productImage),
    developer: h.softwareDeveloper || undefined,
    year: h.releaseDate ? new Date(h.releaseDate).getUTCFullYear() : undefined,
    genres: [...genres],
    subgenres: [...subgenres],
    tags: [...tags],
    ...nintendoRelease(h),
    eshop:
      h.price?.finalPrice != null
        ? {
            price: h.price.finalPrice,
            regular: h.price.regPrice ?? h.price.finalPrice,
            url: `https://www.nintendo.com${h.url}`,
          }
        : undefined,
  };
}

function nintendoRelease(h) {
  const d = h.releaseDate ? new Date(h.releaseDate) : null;
  const upcoming = d ? d.getTime() > Date.now() : !!h.releaseDateDisplay;
  if (!upcoming) return d ? { releaseDate: d.toISOString() } : {};
  const label =
    h.releaseDateDisplay && !/^\d{4}-\d{2}-\d{2}/.test(h.releaseDateDisplay)
      ? h.releaseDateDisplay
      : d
        ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
        : 'Coming soon';
  return { releaseDate: d?.toISOString(), releaseLabel: label, comingSoon: true };
}

/** Live eShop price for a game, matched by its Nintendo id or exact title. */
export async function nintendoPrice(title, nsuid) {
  const hits = await nintendoHits(title, 20);
  const want = normalizeTitle(title);
  const hit = hits.find((h) => nsuid && h.nsuid === nsuid) ?? hits.find((h) => normalizeTitle(h.title) === want);
  return hit ? fromNintendoHit(hit).eshop : undefined;
}

// ---------------------------------------------------------------- PlayStation

// PlayStation Store search through the PSN app's search API. It needs a PSN
// sign-in: the one of the user who's searching, if they've connected PlayStation
// (server/platformLogins.mjs); without one, search leaves the PlayStation Store out.

function psDate(value) {
  // Either an ISO string or { date, localizedDate, type }.
  const raw = typeof value === 'string' ? value : (value?.date ?? value?.value);
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

async function psnSearch(query) {
  const auth = await currentPsnAuth();
  if (!auth) return [];
  const r = await makeUniversalSearch(auth, query, 'MobileGames');
  return (r.domainResponses?.[0]?.results ?? [])
    .map((x) => x.conceptMetadata)
    .filter((c) => c?.type === 'GAME' && c.name && !NOT_A_GAME.test(c.name))
    .map((c) => {
      const images = c.media?.images ?? [];
      const pick = ['MASTER', 'BACKGROUND_LAYER_ART', 'FOUR_BY_THREE_BANNER']
        .map((t) => images.find((i) => i.type === t)?.url)
        .find(Boolean);
      const released = psDate(c.releaseDate ?? c.defaultProduct?.releaseDate);
      const upcoming = released && released.getTime() > Date.now();
      return {
        title: c.name.replace(/[™®©]/g, '').trim(),
        availableOn: ['playstation'],
        imageUrl: pick ? `${pick}?w=920` : undefined,
        year: released && !upcoming ? released.getUTCFullYear() : undefined,
        releaseDate: released?.toISOString(),
        ...(upcoming && {
          comingSoon: true,
          releaseLabel: `${released.getUTCDate()} ${MONTHS[released.getUTCMonth()]} ${released.getUTCFullYear()}`,
        }),
        psStoreUrl: c.id ? `https://store.playstation.com/en-us/concept/${c.id}` : undefined,
        genres: [],
        subgenres: [],
        tags: [],
      };
    });
}

// ---------------------------------------------------------------- Steam

function steamCandidates(index, query, limit) {
  const q = normalizeTitle(query);
  if (!q) return [];
  const words = q.split(' ');
  const scored = [];
  for (const app of index.list) {
    if (!words.every((w) => app.norm.includes(w)) || NOT_A_GAME.test(app.name)) continue;
    const rank = app.norm === q ? 0 : app.norm.startsWith(q) ? 1 : ` ${app.norm} `.includes(` ${q} `) ? 2 : 3;
    scored.push({ app, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.app.norm.length - b.app.norm.length);
  return scored.slice(0, limit).map((s) => s.app.appid);
}

/** Without a Steam key: the store's own search (one request). */
async function steamStoreSearch(query) {
  const r = await fetch(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=US&l=english`,
    { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) },
  );
  if (!r.ok) return [];
  const data = await r.json();
  return (data.items ?? []).filter((i) => i.type === 'app').map((i) => i.id);
}

export async function steamResults(appids) {
  const details = await steamItems(appids);
  return appids
    .map((appid) => [appid, details.get(appid)])
    .filter(([, d]) => d && d.type === 0 && d.name)
    .map(([appid, d]) => ({
      title: d.name.replace(/[™®©]/g, '').trim(),
      availableOn: ['steam'],
      steamAppId: appid,
      developer: d.developer,
      year: d.year,
      blurb: d.blurb,
      imageUrl: d.imageUrl,
      releaseDate: d.releaseDate,
      releaseLabel: d.releaseLabel,
      comingSoon: d.comingSoon,
      ...d.mapped,
    }));
}

// ---------------------------------------------------------------- Epic (via egdata.app)

// egdata.app is a community-run database of the Epic Games Store (Epic's own
// store search is behind a bot check). Unofficial, so failures are tolerated.
// It returns at most 10 entries per search, with no paging.
const SELLABLE = new Set(['BASE_GAME', 'EDITION', 'BUNDLE']);

// egdata is sometimes slow or doesn't answer, so answers are kept for a day
// and a slow request gives up rather than holding up the whole search.
const epicCache = new Map();

async function epicElements(query) {
  const key = query.trim().toLowerCase();
  const hit = epicCache.get(key);
  if (hit && hit.at > Date.now() - 24 * 3600 * 1000) return hit.elements;
  const r = await fetch(`https://api.egdata.app/autocomplete?query=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`egdata: HTTP ${r.status}`);
  const { elements = [] } = await r.json();
  epicCache.set(key, { at: Date.now(), elements });
  return elements;
}

async function epicCatalog(query) {
  const elements = await epicElements(query);
  const image = (e) =>
    ['OfferImageWide', 'DieselStoreFrontWide', 'Thumbnail']
      .map((t) => e.keyImages?.find((k) => k.type === t)?.url)
      .find(Boolean);
  return (
    elements
      // Real store listings only: no DLC, editions, press or debug copies.
      .filter((e) => SELLABLE.has(e.offerType) && !e.isCodeRedemptionOnly && e.title && !NOT_A_GAME.test(e.title))
      .map((e) => {
        const slug = (e.url || e.productSlug || e.offerMappings?.[0]?.pageSlug || '').replace(/\/home$/, '');
        // Unannounced listings use placeholder dates like 2099; ignore anything that far out.
        const parsed = e.releaseDate ? new Date(e.releaseDate) : null;
        const released = parsed && parsed.getUTCFullYear() < new Date().getUTCFullYear() + 5 ? parsed : null;
        const upcoming = released && released.getTime() > Date.now();
        return {
          // Editions merge into the base game: "Borderlands 3: Ultimate Edition" -> "Borderlands 3".
          title: e.title
            .replace(/[™®©]/g, '')
            .replace(
              /\s*[:\-–]?\s*(super deluxe|ultimate|deluxe|gold|complete|definitive|standard|game of the year|goty)\s+edition\s*$/i,
              '',
            )
            .trim(),
          availableOn: ['epic'],
          imageUrl: image(e),
          developer: e.developerDisplayName || undefined,
          year: released && !upcoming ? released.getUTCFullYear() : undefined,
          releaseDate: released?.toISOString(),
          ...(upcoming && {
            comingSoon: true,
            releaseLabel: `${released.getUTCDate()} ${MONTHS[released.getUTCMonth()]} ${released.getUTCFullYear()}`,
          }),
          epicUrl: slug ? `https://store.epicgames.com/p/${slug}` : undefined,
          genres: [],
          subgenres: [],
          tags: [],
        };
      })
  );
}

// ---------------------------------------------------------------- Epic (via CheapShark)

const EPIC_STORE_ID = '25';

/**
 * Games the Epic Games Store sells, according to CheapShark's store prices.
 * Covers paid games whether or not they're also on Steam; free-to-play games
 * have no price there, which is what the egdata lookup is for.
 */
async function epicOnly(query) {
  const headers = { 'User-Agent': USER_AGENT };
  const r = await fetch(`https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(query)}&limit=25`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return [];
  const games = (await r.json()).filter((g) => !NOT_A_GAME.test(g.external)).slice(0, 25);
  if (!games.length) return [];
  const d = await fetch(`https://www.cheapshark.com/api/1.0/games?ids=${games.map((g) => g.gameID).join(',')}`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!d.ok) return [];
  const details = await d.json();
  return games
    .filter((g) => details[g.gameID]?.deals?.some((deal) => deal.storeID === EPIC_STORE_ID))
    .map((g) => ({
      title: details[g.gameID].info?.title ?? g.external,
      availableOn: ['epic'],
      steamAppId: g.steamAppID ? Number(g.steamAppID) : undefined,
      imageUrl: g.steamAppID ? undefined : g.thumb,
      genres: [],
      subgenres: [],
      tags: [],
    }));
}

// ---------------------------------------------------------------- search

/**
 * Lighter than normalizeTitle: keeps "Remastered", "Royal" and so on, so
 * different products don't collapse into one result. Drops symbols, store
 * edition suffixes and Nintendo's "Switch 2 Edition" (all the same game).
 */
function searchKey(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[™®©]/g, '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\bnintendo switch\s*2 edition\b/g, ' ')
      // Store editions of one game are the same result; remasters are not.
      .replace(
        /\b(super deluxe|ultimate|deluxe|gold|complete|definitive|standard|game of the year|goty)\s+edition\s*$/,
        ' ',
      )
      .replace(/&/g, ' and ')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

/**
 * Search all PC and Nintendo games. Results for the same game on several
 * platforms are merged into one, keyed by normalized title.
 */
export async function searchGames(query) {
  const index = await steamAppIndex().catch(() => null);
  const steamIds = index ? steamCandidates(index, query, 20) : await steamStoreSearch(query).catch(() => []);
  const [steam, nintendo, epic, epicStore, playstation] = await Promise.all([
    steamResults(steamIds.slice(0, 20)).catch(() => []),
    nintendoHits(query)
      .then((hits) => hits.map(fromNintendoHit))
      .catch(() => []),
    epicOnly(query).catch(() => []),
    epicCatalog(query).catch(() => []),
    psnSearch(query).catch(() => []),
  ]);

  const merged = new Map();
  for (const r of [...steam, ...nintendo, ...playstation, ...epicStore, ...epic]) {
    const key = searchKey(r.title);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...r, key });
      continue;
    }
    merged.set(key, {
      ...prev,
      availableOn: [...new Set([...prev.availableOn, ...r.availableOn])],
      switchVersions: [...new Set([...(prev.switchVersions ?? []), ...(r.switchVersions ?? [])])],
      steamAppId: prev.steamAppId ?? r.steamAppId,
      nsuid: prev.nsuid ?? r.nsuid,
      imageUrl: prev.imageUrl ?? r.imageUrl,
      // Release info travels together, from the first source that has a date
      // (Steam before Nintendo before Epic), so sources don't get mixed.
      ...(prev.releaseDate || prev.comingSoon
        ? { releaseDate: prev.releaseDate, releaseLabel: prev.releaseLabel, comingSoon: prev.comingSoon }
        : { releaseDate: r.releaseDate, releaseLabel: r.releaseLabel, comingSoon: r.comingSoon }),
      developer: prev.developer ?? r.developer,
      year: prev.year ?? r.year,
      blurb: prev.blurb ?? r.blurb,
      eshop: prev.eshop ?? r.eshop,
      epicUrl: prev.epicUrl ?? r.epicUrl,
      psStoreUrl: prev.psStoreUrl ?? r.psStoreUrl,
      // Steam's community tags are richer than Nintendo's genre labels.
      genres: prev.genres.length ? prev.genres : r.genres,
      subgenres: prev.subgenres.length ? prev.subgenres : r.subgenres,
      tags: prev.tags.length ? prev.tags : r.tags,
    });
  }
  const q = searchKey(query);
  // Nintendo's search is fuzzy ("alan wake 2" finds "Two Point Museum"), so
  // every word of the query has to appear in the title.
  const words = q.split(' ').filter((w) => /[a-z]/.test(w));
  return (
    [...merged.values()]
      .filter((r) => words.every((w) => r.key.split(' ').some((k) => k.startsWith(w))))
      // Exact title, then titles starting with the query as whole words ("Mario
      // Kart" for "mario"), then containing it as whole words, then partial-word
      // matches ("Marionette" for "mario").
      .map((r) => ({
        r,
        rank: r.key === q ? 0 : `${r.key} `.startsWith(`${q} `) ? 1 : ` ${r.key} `.includes(` ${q} `) ? 2 : 3,
      }))
      // Stable sort: within a rank, keep each source's own relevance order.
      .sort((a, b) => a.rank - b.rank)
      .map(({ r }) => r)
      .slice(0, 40)
  );
}

// ---------------------------------------------------------------- Steam wishlist

/** A public Steam wishlist, newest first, with store details for each game. */
export async function steamWishlist(steamId) {
  const r = await fetch(`https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Steam wishlist: HTTP ${r.status}`);
  const items = (await r.json()).response?.items ?? [];
  const details = await steamItems(items.map((i) => i.appid));
  return items
    .filter((i) => details.get(i.appid)?.name)
    .sort((a, b) => b.date_added - a.date_added)
    .map((i) => {
      const d = details.get(i.appid);
      return {
        title: d.name.replace(/[™®©]/g, '').trim(),
        availableOn: ['steam'],
        steamAppId: i.appid,
        developer: d.developer,
        year: d.year,
        blurb: d.blurb,
        imageUrl: d.imageUrl,
        releaseDate: d.releaseDate,
        releaseLabel: d.releaseLabel,
        comingSoon: d.comingSoon,
        addedAt: new Date(i.date_added * 1000).toISOString(),
        ...d.mapped,
      };
    });
}

// ---------------------------------------------------------------- details

/**
 * Cover image and release info for saved games.
 * @param {{ id: string, title: string, steamAppId?: number, nsuid?: string, switch?: boolean, playstation?: boolean, epic?: boolean }[]} games
 * @returns per id: { imageUrl?, releaseDate?, releaseLabel?, comingSoon?, steamAppId? }
 *   Steam first (by app id, or by exact title from Steam's game list), then the
 *   Nintendo eShop, PlayStation Store and Epic (via egdata). Games none of them
 *   knows get {}.
 */
const MAX_STORE_SEARCHES = 80;

export async function lookupDetails(games) {
  const index = await steamAppIndex().catch(() => null);
  const appidFor = new Map();
  for (const g of games) {
    const appid = g.steamAppId ?? index?.byTitle.get(normalizeTitle(g.title));
    if (appid) appidFor.set(g.id, appid);
  }
  const steam = await steamItems([...new Set(appidFor.values())]).catch(() => new Map());
  const out = {};
  for (const g of games) {
    const appid = appidFor.get(g.id);
    const d = appid && steam.get(appid);
    if (d) {
      out[g.id] = {
        imageUrl: d.imageUrl,
        releaseDate: d.releaseDate,
        releaseLabel: d.releaseLabel,
        comingSoon: d.comingSoon,
        steamAppId: g.steamAppId ? undefined : appid,
      };
    }
  }
  // Everything Steam doesn't sell: try the store each game is on, then the
  // others, matching the exact title. One search per game, a few at a time.
  const pick = (f) => ({
    imageUrl: f.imageUrl,
    releaseDate: f.releaseDate,
    releaseLabel: f.releaseLabel,
    comingSoon: f.comingSoon,
  });
  const exact = (list, title) => list.find((f) => normalizeTitle(f.title) === normalizeTitle(title) && f.imageUrl);
  const sources = (g) => [
    ...(g.switch ? ['nintendo'] : []),
    ...(g.playstation ? ['playstation'] : []),
    ...(g.epic ? ['epic'] : []),
    // Unknown platform (e.g. a typed-in physical game): try them all.
    ...(!g.switch && !g.playstation && !g.epic ? ['playstation', 'epic', 'nintendo'] : []),
  ];
  const rest = games.filter((g) => !out[g.id]).slice(0, MAX_STORE_SEARCHES);
  for (let i = 0; i < rest.length; i += 5) {
    await Promise.all(
      rest.slice(i, i + 5).map(async (g) => {
        for (const source of sources(g)) {
          try {
            if (source === 'nintendo') {
              const hits = await nintendoHits(g.title, 10);
              const hit =
                hits.find((h) => g.nsuid && h.nsuid === g.nsuid) ??
                hits.find((h) => normalizeTitle(h.title) === normalizeTitle(g.title));
              if (hit) return void (out[g.id] = pick(fromNintendoHit(hit)));
            } else {
              const found = exact(source === 'epic' ? await epicCatalog(g.title) : await psnSearch(g.title), g.title);
              if (found) return void (out[g.id] = pick(found));
            }
          } catch {
            // Try the next source; anything still missing is retried later.
          }
        }
      }),
    );
  }
  // Last resort for covers: IGDB knows nearly every game on every platform.
  for (const g of rest) {
    if (out[g.id]?.imageUrl) continue;
    try {
      const info = await igdbGame({ title: g.title });
      if (info?.imageUrl)
        out[g.id] = { ...out[g.id], imageUrl: info.imageUrl, releaseDate: out[g.id]?.releaseDate ?? info.releaseDate };
    } catch {
      break;
    }
  }
  // Mark only games that were actually searched as checked; any past the cap
  // stay out of the reply so the client asks again in its next batch.
  for (const g of rest) out[g.id] ??= {};
  return out;
}
