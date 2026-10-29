// Savepoint API server.
// Keeps third-party keys off the client and proxies the services that block
// browser requests (Steam Web API, PSN, CheapShark) and the local Ollama model.
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getUserPlayedGames, getUserTitles } from 'psn-api';
import { NINTENDO_GENRES, lookupDetails, nintendoPrice, searchAllPlatforms, searchGames, steamWishlist } from './search.mjs';
import { lookupGameFacts } from './gameFacts.mjs';
import { discoverPool } from './discover.mjs';
import { howLongToBeat } from './hltb.mjs';
import { criticScore } from './opencritic.mjs';
import { igdbConfigured, igdbGame, lookupIgdb } from './igdb.mjs';
import { itadDeal } from './itad.mjs';
import {
  alertTopic,
  checkAlerts,
  newAlertTopic,
  notify,
  setAlerts,
  startAlertTimer,
  turnOffAlerts,
  watchedCount,
} from './alerts.mjs';
import { bigDeals, checkDealAlerts, dealSettings, freeGiveaways, saveDealSettings } from './dealAlerts.mjs';
import { genreTaxonomy, lookupSteam, lookupWikidata, lookupWikidataOne } from './genres.mjs';
import { stateRouter } from './state.mjs';
import { xboxLibrary } from './xbox.mjs';
import {
  NotConnected,
  platformContext,
  platformLoginRouter,
  platformLogins,
  psnAuthFor,
  fillMissingNames,
  resetPsnSession,
  xboxKeyFor,
} from './platformLogins.mjs';
import { accountRouter, authRouter, requireLogin } from './auth.mjs';
import { steamLoginRouter } from './steamLogin.mjs';
import { friendsRouter } from './friends.mjs';
import { adminRouter, resetRouter } from './admin.mjs';
import { giftsRouter } from './gifts.mjs';
import { streamingRouter } from './streaming.mjs';
import { latestNews } from './news.mjs';
import { gameStatsRouter } from './ffxiv.mjs';
import { gw2Router } from './gw2.mjs';
import { lolRouter } from './lol.mjs';
import { snapshotRouter } from './snapshots.mjs';
import { query } from './db.mjs';

const PORT = Number(process.env.API_PORT) || 8787;
const USER_AGENT = 'Savepoint/0.1 (self-hosted game library app)';

// One failed background lookup shouldn't take the whole server down. Log it
// (to the terminal and .cache/server-errors.log) and keep serving. On Vercel
// the terminal output is the function log, and there's no disk to keep a file on.
const errorLog = new URL('../.cache/server-errors.log', import.meta.url);
function logCrash(kind, err) {
  const line = `${new Date().toISOString()} ${kind}: ${err?.stack ?? err}\n`;
  console.error(line);
  if (!process.env.VERCEL) appendFile(errorLog, line).catch(() => {});
}
process.on('uncaughtException', (err) => logCrash('uncaughtException', err));
process.on('unhandledRejection', (err) => logCrash('unhandledRejection', err));

export const app = express();

// Vercel Cron (vercel.json) calls this once a day with "Authorization: Bearer
// <CRON_SECRET>"; locally startAlertTimer() does the checking instead.
app.get('/api/cron/alerts', async (req, res) => {
  const secret = process.env.CRON_SECRET?.trim();
  const given = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'Not allowed.' });
  }
  try {
    const prices = await checkAlerts();
    const deals = await checkDealAlerts().catch((err) => ({ error: err.message }));
    res.json({ ...prices, deals });
  } catch (err) {
    logCrash('cron/alerts', err);
    res.status(502).json({ error: err.message });
  }
});

app.use(authRouter); // /api/login, /api/logout, /api/session, /api/signup
app.use(steamLoginRouter); // /api/auth/steam/*
app.use(resetRouter); // /api/reset/:token (password reset links)
app.use(requireLogin); // Everything below needs you to be logged in.
app.use(platformContext); // Lets game search use the searcher's own PlayStation sign-in.
app.use(accountRouter); // /api/account, /api/account/*, /api/admin/invite
app.use(adminRouter); // /api/admin/users/*
app.use(platformLoginRouter); // /api/psn/connect, /api/xbox/connect
app.use(friendsRouter); // /api/friends/*, /api/profile/public
app.use(giftsRouter); // /api/gifts/*
app.use(streamingRouter); // /api/streams, /api/streaming/*, /api/auth/twitch/*
app.use(gameStatsRouter); // /api/games/*
app.use(gw2Router); // /api/games/gw2/*
app.use(lolRouter); // /api/games/lol/*
app.use(snapshotRouter); // /api/games/:game/history
// Before the 1 MB body limit below: the saved state is larger than that.
app.use(stateRouter);
app.use(express.json({ limit: '1mb' }));

const has = (name) => Boolean(process.env[name] && process.env[name].trim());

app.get('/api/status', async (req, res) => {
  // Names shown in Settings for PlayStation and Xbox, if they're still missing.
  await fillMissingNames(req.userId).catch((err) => console.warn('[name lookup]', err.message));
  const provider = assistantProvider();
  const ollama = provider === 'ollama' ? await ollamaStatus() : { reachable: false, installed: false };
  res.json({
    assistant: provider === 'gemini' ? has('GEMINI_API_KEY') : ollama.reachable && ollama.installed,
    assistantProvider: provider,
    assistantModel: provider === 'gemini' ? GEMINI_MODEL : OLLAMA_MODEL,
    ollama: { ...ollama, model: OLLAMA_MODEL, url: OLLAMA_URL },
    steam: has('STEAM_API_KEY'),
    // The invite code is the super admin's.
    superAdmin: req.isSuperAdmin,
    // This account's own PlayStation and Xbox connections.
    ...(await platformLogins(req.userId)
      .then((l) => ({
        psn: !!l.playstation,
        xbox: !!l.xbox,
        psnAccount: l.playstation?.account,
        xboxAccount: l.xbox?.account,
      }))
      .catch(() => ({ psn: false, xbox: false }))),
    keyshops: has('GGDEALS_API_KEY'),
    prices: true,
    igdb: igdbConfigured(),
    critics: has('OPENCRITIC_RAPIDAPI_KEY'),
    deals: has('ITAD_API_KEY'),
  });
});

// ---------------------------------------------------------------- Steam

async function steamGet(path, params) {
  const url = new URL(`https://api.steampowered.com/${path}`);
  url.search = new URLSearchParams({ key: process.env.STEAM_API_KEY, format: 'json', ...params });
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error(`Steam responded with ${r.status}`);
  return r.json();
}

/**
 * Steam's owned-games list doesn't say what's software. The store API does:
 * type 0 is a game, anything else (6 = software, e.g. Wallpaper Engine) isn't.
 * Returns appid -> type. Lookups that fail are left out, and those apps are
 * treated as games.
 */
async function steamItemTypes(appids) {
  const types = new Map();
  for (let i = 0; i < appids.length; i += 100) {
    const input = {
      ids: appids.slice(i, i + 100).map((appid) => ({ appid })),
      context: { language: 'english', country_code: 'US' },
      data_request: {},
    };
    try {
      const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
      const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!r.ok) continue;
      const data = await r.json();
      for (const item of data.response?.store_items ?? []) {
        if (typeof item.type === 'number') types.set(item.appid, item.type);
      }
    } catch {
      // Classification is best-effort; the import still works without it.
    }
  }
  return types;
}

class NotFound extends Error {}

/**
 * The SteamID64 the logged-in account has connected through Steam's own login
 * (server/steamLogin.mjs). Steam data is only ever fetched for that account,
 * never for a profile someone types in.
 */
async function linkedSteamId(req) {
  const { rows } = await query('SELECT "steam_id" FROM users WHERE "id" = $1', [req.userId]);
  if (!rows[0]?.steam_id) throw new NotFound('Connect Steam first (Settings, Platforms).');
  return rows[0].steam_id;
}

app.get('/api/steam/library', async (req, res) => {
  if (!has('STEAM_API_KEY')) {
    return res.status(501).json({ error: 'STEAM_API_KEY is not set on the server. Add it to .env and restart.' });
  }
  let id;
  try {
    id = await linkedSteamId(req);
  } catch (err) {
    return res.status(err instanceof NotFound ? 409 : 502).json({ error: err.message });
  }

  try {
    const data = await steamGet('IPlayerService/GetOwnedGames/v1/', {
      steamid: id,
      include_appinfo: '1',
      include_played_free_games: '1',
    });
    const games = data.response?.games;
    if (!games) {
      return res.status(403).json({
        error: 'Steam returned no games. Set "Game details" to Public in your Steam privacy settings.',
      });
    }
    // Unplayed games come too: they're your backlog.
    const types = await steamItemTypes(games.map((g) => g.appid));
    res.json({
      steamId: id,
      games: games.map((g) => ({
        externalId: String(g.appid),
        steamAppId: g.appid,
        name: g.name,
        minutes: g.playtime_forever,
        // Some profiles come without last-played dates. Minutes from the last
        // two weeks still say a game was played recently; the app dates that
        // itself from the change since its previous sync (not "today" on sight).
        lastPlayed: g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : null,
        recentMinutes: g.playtime_2weeks || undefined,
        isApp: types.has(g.appid) && types.get(g.appid) !== 0,
      })),
    });
  } catch (err) {
    res.status(502).json({ error: `Couldn't reach Steam: ${err.message}` });
  }
});

// ?appids=1,2,3 (up to 40), for the connected Steam account -> { results: { [appid]: { earned, total } } }
// Steam has no batch call for this with an API key, so it's one request per game.
app.get('/api/steam/achievements', async (req, res) => {
  if (!has('STEAM_API_KEY')) return res.status(501).json({ error: 'STEAM_API_KEY is not set on the server.' });
  const appids = String(req.query.appids || '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 40);
  let id;
  try {
    id = await linkedSteamId(req);
  } catch (err) {
    return res.status(err instanceof NotFound ? 409 : 502).json({ error: err.message });
  }
  const results = {};
  // Steam answers "Profile is not public" while the account's Game details are
  // private: that's reported as such, not recorded as games without achievements.
  let hidden = false;
  for (let i = 0; i < appids.length && !hidden; i += 4) {
    await Promise.all(
      appids.slice(i, i + 4).map(async (appid) => {
        try {
          const url = new URL('https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/');
          url.search = new URLSearchParams({ key: process.env.STEAM_API_KEY, steamid: id, appid: String(appid) });
          const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) });
          const stats = (await r.json().catch(() => ({}))).playerstats;
          if (/not public/i.test(stats?.error ?? '')) {
            hidden = true;
            return;
          }
          const list = stats?.achievements;
          // Games without achievements answer with an error; record them as 0 so they aren't asked again.
          results[appid] = list
            ? { earned: list.filter((a) => a.achieved).length, total: list.length }
            : { earned: 0, total: 0 };
        } catch {
          // Timed out: left out, so the app asks again next time.
        }
      }),
    );
  }
  res.json({ results: hidden ? {} : results, private: hidden });
});

// ---------------------------------------------------------------- PlayStation

// "PT228H56M33S" -> minutes
function isoDurationToMinutes(d) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(d || '');
  if (!m) return 0;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0) + Math.round(Number(m[3] || 0) / 60);
}

/** Sends NotConnected as 409 (the client offers to connect), anything else as 502. */
function platformError(res, err, what) {
  if (err instanceof NotConnected) return res.status(409).json({ error: err.message });
  res.status(502).json({ error: `${what}: ${err.message}` });
}

// -> { titles: [{ name, earned, total, platinum }] } for every game with trophies.
app.get('/api/psn/trophies', async (req, res) => {
  try {
    const auth = await psnAuthFor(req.userId);
    const all = [];
    for (let offset = 0, page = 0; page < 20; page++) {
      const r = await getUserTitles(auth, 'me', { limit: 800, offset });
      all.push(...r.trophyTitles);
      if (!r.nextOffset || all.length >= r.totalItemCount) break;
      offset = r.nextOffset;
    }
    const sum = (t) => (t ? t.bronze + t.silver + t.gold + t.platinum : 0);
    res.json({
      titles: all.map((t) => ({
        name: t.trophyTitleName,
        earned: sum(t.earnedTrophies),
        total: sum(t.definedTrophies),
        platinum: t.earnedTrophies?.platinum > 0,
        grades: t.earnedTrophies && {
          bronze: t.earnedTrophies.bronze,
          silver: t.earnedTrophies.silver,
          gold: t.earnedTrophies.gold,
          platinum: t.earnedTrophies.platinum,
        },
      })),
    });
  } catch (err) {
    resetPsnSession(req.userId);
    platformError(res, err, 'PlayStation trophies failed');
  }
});

app.get('/api/psn/library', async (req, res) => {
  try {
    const auth = await psnAuthFor(req.userId);
    const titles = [];
    let offset = 0;
    // Page through the full played-games list (200 per page).
    for (let page = 0; page < 20; page++) {
      const r = await getUserPlayedGames(auth, 'me', { limit: 200, offset });
      titles.push(...r.titles);
      if (!r.nextOffset || r.nextOffset <= offset || titles.length >= r.totalItemCount) break;
      offset = r.nextOffset;
    }
    void fillMissingNames(req.userId, { force: true }).catch(() => {});
    res.json({
      games: titles
        .map((t) => ({
          externalId: t.titleId,
          name: t.localizedName || t.name,
          minutes: isoDurationToMinutes(t.playDuration),
          lastPlayed: t.lastPlayedDateTime || null,
          imageUrl: t.imageUrl,
          // Apps come back as e.g. ps5_native_media_app or ps4_videoservice_web_app.
          isApp: /_app$/.test(t.category || ''),
        }))
        .filter((g) => g.minutes > 0),
    });
  } catch (err) {
    resetPsnSession(req.userId);
    platformError(res, err, 'PlayStation import failed');
  }
});

// ---------------------------------------------------------------- Xbox

// This account's Xbox games, achievements and (where Xbox has it) play time, via its own OpenXBL key.
app.get('/api/xbox/library', async (req, res) => {
  try {
    res.json({ games: await xboxLibrary(await xboxKeyFor(req.userId), req.userId) });
    void fillMissingNames(req.userId, { force: true }).catch(() => {});
  } catch (err) {
    platformError(res, err, 'Xbox import failed');
  }
});

// ---------------------------------------------------------------- Search and wishlist

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  try {
    // ?all=1: older consoles too (IGDB), for physical copies.
    res.json({ results: req.query.all === '1' ? await searchAllPlatforms(q) : await searchGames(q) });
  } catch (err) {
    res.status(502).json({ error: `Search failed: ${err.message}` });
  }
});

// ?subgenres=a,b&genres=c,d (strongest first) -> { results } of well-reviewed Steam games
app.get('/api/taxonomy', (_req, res) => {
  const { genres, subgenres } = genreTaxonomy();
  const nintendo = Object.values(NINTENDO_GENRES).map((m) => m.g);
  res.set('Cache-Control', 'private, max-age=86400');
  res.json({ genres: [...new Set([...genres, ...nintendo.filter(Boolean)])].sort(), subgenres });
});

app.get('/api/discover', async (req, res) => {
  const list = (v) =>
    String(v || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 10);
  try {
    res.json({
      results: await discoverPool(list(req.query.subgenres), list(req.query.genres), list(req.query.franchises)),
    });
  } catch (err) {
    res.status(502).json({ error: `Suggestions failed: ${err.message}` });
  }
});

// ?title=&steamAppId= -> { igdb, length, critic } for a game's page. Each part
// is null when unknown or its service isn't set up.
app.get('/api/info', async (req, res) => {
  const title = String(req.query.title || '').trim();
  const steamAppId = Number(req.query.steamAppId) || undefined;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const [igdb, length, critic] = await Promise.all([
    igdbGame({ title, steamAppId }).catch(() => null),
    howLongToBeat(title).catch(() => null),
    criticScore(title).catch(() => null),
  ]);
  res.json({ igdb, length, critic });
});

// Body: { games: [{ id, title }] } (up to 40) -> { results: { [id]: { main, extra, complete, url } | null } }
// Games that couldn't be checked (HowLongToBeat unreachable) are left out.
app.post('/api/lengths', async (req, res) => {
  const games = (req.body?.games ?? [])
    .filter((g) => g && typeof g.id === 'string' && typeof g.title === 'string' && g.title.trim())
    .slice(0, 40);
  const results = {};
  for (const g of games) {
    try {
      results[g.id] = await howLongToBeat(g.title.trim());
    } catch {
      break;
    }
  }
  res.json({ results });
});

// ---------------------------------------------------------------- Price alerts (per account)

const alertsFailed = (res, err) => {
  console.error('Price alerts:', err);
  res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
};

// -> { topic (null = off), watching }
app.get('/api/alerts/settings', async (req, res) => {
  try {
    res.json({ topic: await alertTopic(req.userId), watching: await watchedCount(req.userId) });
  } catch (err) {
    alertsFailed(res, err);
  }
});

// Turns alerts on, or replaces the topic with a new random one. -> { topic }
app.post('/api/alerts/settings', async (req, res) => {
  try {
    res.json({ topic: await newAlertTopic(req.userId) });
  } catch (err) {
    alertsFailed(res, err);
  }
});

app.delete('/api/alerts/settings', async (req, res) => {
  try {
    await turnOffAlerts(req.userId);
    res.status(204).end();
  } catch (err) {
    alertsFailed(res, err);
  }
});

// Body: { items: [{ id, title, steamAppId?, nsuid?, pc, switch, target }] } -> { checked, sent }
app.post('/api/alerts', async (req, res) => {
  const items = (req.body?.items ?? [])
    .filter((i) => i && typeof i.id === 'string' && i.id && typeof i.title === 'string' && Number.isFinite(i.target))
    .slice(0, 300)
    .map((i) => ({
      id: i.id,
      title: i.title.slice(0, 300),
      steamAppId: Number.isInteger(Number(i.steamAppId)) && Number(i.steamAppId) > 0 ? Number(i.steamAppId) : null,
      nsuid: i.nsuid ? String(i.nsuid).slice(0, 40) : null,
      pc: !!i.pc,
      switch: !!i.switch,
      target: i.target,
    }));
  try {
    res.json(await setAlerts(req.userId, items));
  } catch (err) {
    res.status(502).json({ error: `Price check failed: ${err.message}` });
  }
});

// Free game and big deal alerts -> { freeGames, bigDeals }
app.get('/api/alerts/deals', async (req, res) => {
  try {
    res.json(await dealSettings(req.userId));
  } catch (err) {
    alertsFailed(res, err);
  }
});

// Body: { freeGames?, bigDeals? } -> the saved settings. Checks right away, so
// what's on now arrives without waiting for the daily check.
app.put('/api/alerts/deals', async (req, res) => {
  try {
    res.json(await saveDealSettings(req.userId, req.body ?? {}));
    void checkDealAlerts({ userId: req.userId }).catch(() => {});
  } catch (err) {
    alertsFailed(res, err);
  }
});

// Current free games (GamerPower), for the homepage. -> { giveaways }
app.get('/api/deals/free', async (_req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=1800');
    res.json({ giveaways: (await freeGiveaways()).filter((g) => g.kind === 'game').slice(0, 30) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Gaming news for the homepage. ?sources=ign,pcgamer (all when empty) -> { items }
app.get('/api/news', async (req, res) => {
  const ids = String(req.query.sources || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  res.set('Cache-Control', 'private, max-age=900');
  res.json({ items: await latestNews(ids, 20) });
});

// Current big deals (IsThereAnyDeal), for the homepage. -> { deals }
app.get('/api/deals/big', async (_req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=1800');
    res.json({ deals: (await bigDeals({ minCut: 75, historicalLow: true, wellReviewed: true })).slice(0, 30) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/alerts/test', async (req, res) => {
  try {
    const topic = await alertTopic(req.userId);
    if (!topic) return res.status(409).json({ error: 'Turn on price alerts first.' });
    await notify(topic, {
      title: 'Savepoint',
      message: 'Price alerts are set up. You will get a message like this when a game hits your target.',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: `Couldn't send it: ${err.message}` });
  }
});

// Body: { games: [{ id, title, steamAppId?, nsuid?, switch? }] } -> { results }
app.post('/api/details', async (req, res) => {
  const games = (req.body?.games ?? [])
    .filter((g) => g && typeof g.id === 'string' && typeof g.title === 'string')
    .slice(0, 500)
    .map((g) => ({
      id: g.id,
      title: g.title,
      steamAppId: Number(g.steamAppId) || undefined,
      nsuid: g.nsuid ? String(g.nsuid) : undefined,
      switch: !!g.switch,
      playstation: !!g.playstation,
      epic: !!g.epic,
    }));
  try {
    res.json({ results: await lookupDetails(games) });
  } catch (err) {
    res.status(502).json({ error: `Details lookup failed: ${err.message}` });
  }
});

app.get('/api/steam/wishlist', async (req, res) => {
  if (!has('STEAM_API_KEY')) {
    return res.status(501).json({ error: 'STEAM_API_KEY is not set on the server. Add it to .env and restart.' });
  }
  try {
    const steamId = await linkedSteamId(req);
    const games = await steamWishlist(steamId);
    res.json({ steamId, games });
  } catch (err) {
    res.status(err instanceof NotFound ? 409 : 502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------- Genres

// Body: { pass: 'steam' | 'wikidata', games: [{ id, title, steamAppId? }] }
// Returns { results, retryAfter? }. See server/genres.mjs.
app.post('/api/genres', async (req, res) => {
  const pass = ['wikidata', 'igdb'].includes(req.body?.pass) ? req.body.pass : 'steam';
  const games = (req.body?.games ?? [])
    .filter((g) => g && typeof g.id === 'string' && typeof g.title === 'string' && g.title.trim())
    .slice(0, pass === 'steam' ? 1000 : pass === 'igdb' ? 40 : 200)
    .map((g) => ({ id: g.id, title: g.title.trim(), steamAppId: Number(g.steamAppId) || undefined }));
  if (!games.length) return res.status(400).json({ error: 'games is required' });
  try {
    if (pass === 'steam') return res.json(await lookupSteam(games));
    if (pass === 'igdb') return res.json(igdbConfigured() ? await lookupIgdb(games) : { results: {} });
    res.json(games.length === 1 ? await lookupWikidataOne(games[0]) : await lookupWikidata(games));
  } catch (err) {
    res.status(502).json({ error: `Genre lookup failed: ${err.message}` });
  }
});

// ---------------------------------------------------------------- Prices (CheapShark)

// CheapShark store IDs for the PC stores Savepoint lists as trusted.
const CHEAPSHARK_STORES = {
  1: 'steam',
  3: 'gmg',
  7: 'gog',
  11: 'humble',
  15: 'fanatical',
  25: 'epic',
};
const priceCache = new Map();

async function cheapshark(path, params) {
  const url = new URL(`https://www.cheapshark.com/api/1.0/${path}`);
  url.search = new URLSearchParams(params);
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error(`CheapShark responded with ${r.status}`);
  return r.json();
}

/**
 * Lowest current key-shop price across marketplaces like G2A, Eneba, Kinguin
 * and Gamivo, from GG.deals (free API key). By Steam app id only; GG.deals
 * gives one lowest price, not a per-shop list, plus a link to its comparison.
 */
async function keyshopPrice(steamAppId) {
  if (!has('GGDEALS_API_KEY')) return null;
  const url = `https://api.gg.deals/v1/prices/by-steam-app-id/?ids=${steamAppId}&region=us&key=${process.env.GGDEALS_API_KEY.trim()}`;
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const game = (await r.json()).data?.[steamAppId];
  const price = Number(game?.prices?.currentKeyshops);
  if (!game || !Number.isFinite(price) || price <= 0) return null;
  return {
    price,
    historicalLow: Number(game.prices.historicalKeyshops) || null,
    url: game.url,
  };
}

async function pcPrices(title, steamAppId) {
  const matches = steamAppId
    ? await cheapshark('games', { steamAppID: steamAppId, limit: '1' })
    : await cheapshark('games', { title, exact: '1', limit: '1' });
  if (!matches.length) return { deals: [], historicalLow: null };
  const detail = await cheapshark('games', { id: matches[0].gameID });
  return {
    historicalLow: detail.cheapestPriceEver ? Number(detail.cheapestPriceEver.price) : null,
    deals: detail.deals
      .filter((d) => CHEAPSHARK_STORES[d.storeID])
      .map((d) => ({
        storeId: CHEAPSHARK_STORES[d.storeID],
        price: Number(d.price),
        regular: Number(d.retailPrice),
        url: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
      })),
  };
}

// Query: title, steamAppId?, pc=1 (PC prices), switch=1 (eShop price), nsuid?
app.get('/api/prices', async (req, res) => {
  const title = String(req.query.title || '').trim();
  const steamAppId = String(req.query.steamAppId || '').trim();
  const nsuid = String(req.query.nsuid || '').trim();
  const wantPc = req.query.pc === '1';
  const wantSwitch = req.query.switch === '1';
  if (!title && !steamAppId) return res.status(400).json({ error: 'title or steamAppId is required' });

  const key = `${steamAppId || title.toLowerCase()}|${wantPc}|${wantSwitch}`;
  const cached = priceCache.get(key);
  if (cached && cached.at > Date.now() - 30 * 60_000) return res.json(cached.data);

  const [pc, eshop, keyshops, itad] = await Promise.all([
    wantPc ? pcPrices(title, steamAppId).catch(() => null) : null,
    wantSwitch && title ? nintendoPrice(title, nsuid).catch(() => null) : null,
    wantPc && steamAppId ? keyshopPrice(steamAppId).catch(() => null) : null,
    wantPc ? itadDeal({ title, steamAppId: Number(steamAppId) || undefined }).catch(() => null) : null,
  ]);
  if (wantPc && !pc && !eshop && !itad) return res.status(502).json({ error: "Couldn't load live prices" });
  const deals = [...(pc?.deals ?? [])];
  if (eshop) deals.push({ storeId: 'eshop', ...eshop });
  const data = {
    found: deals.length > 0 || !!keyshops,
    currency: 'USD',
    historicalLow: pc?.historicalLow ?? null,
    deals,
    keyshops,
    // Best deal across every store IsThereAnyDeal tracks, and the all-time low.
    itad,
  };
  priceCache.set(key, { at: Date.now(), data });
  res.json(data);
});

// ---------------------------------------------------------------- Assistant (Ollama)

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').trim().replace(/\/+$/, '');
const OLLAMA_MODEL = (process.env.OLLAMA_MODEL || 'qwen3:14b').trim();
// Room for the library snapshot, candidate list and a few turns of chat.
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX) || 8192;

// Gemini (Google AI Studio API key; the free tier needs no card).
// Tried in order; free-tier models are sometimes busy or retired for new
// accounts. GEMINI_MODEL pins a single model instead.
// gemini-3.8-flash is left out: on the free tier it's often busy and its
// per-minute quota runs out after a couple of requests.
const GEMINI_FALLBACKS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const GEMINI_MODEL_SET = has('GEMINI_MODEL');
const GEMINI_MODEL = GEMINI_MODEL_SET ? process.env.GEMINI_MODEL.trim() : GEMINI_FALLBACKS[0];

/** 'gemini' when a Gemini key is set (or ASSISTANT_PROVIDER says so), otherwise 'ollama'. */
function assistantProvider() {
  const chosen = (process.env.ASSISTANT_PROVIDER || '').trim().toLowerCase();
  if (chosen === 'gemini' || chosen === 'ollama') return chosen;
  return has('GEMINI_API_KEY') ? 'gemini' : 'ollama';
}

const SYSTEM_PROMPT = `You are the assistant inside Savepoint, an app that tracks the games one player has played across Steam, Epic Games, PlayStation and Nintendo Switch, plus their wishlist.

Below these instructions you'll find the player's data: platforms, hours per platform, their most-played games with hours and genres, their taste profile, their wishlist, and candidate games from live Steam and Nintendo eShop suggestions that match their taste (with the platforms each is on).

Answer the question the player actually asked.
- Questions about their own games (hours, most played, what they played on a platform, genres they like): answer from their data, with the numbers. If the data doesn't cover it (only the top 50 played games are included), say so.
- Requests for something to play: suggest 3 to 5 games as a bulleted list, each starting with the exact title in bold, then a sentence on why it fits, pointing to a game and its hours from their library. Prefer the candidate list; suggest other games only if they are real, released games you are sure of. Don't suggest games they already played unless they ask about replaying. If they name a platform, only suggest games on it.
- Questions about a specific game (is it out, is it good, what is it): use the look_up_game tool if you have it, then answer from what it returns. Your training data has a cutoff, so never say a game is unreleased or doesn't exist without checking. If no tool is available, say your information may be out of date.
- Don't invent prices or release dates; for prices, point them to the Wishlist or Stores page.
- Be concise: usually under 200 words.`;

const isModel = (name) => name === OLLAMA_MODEL || name === `${OLLAMA_MODEL}:latest`;

async function ollamaStatus() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { reachable: false, installed: false };
    const { models = [] } = await r.json();
    return { reachable: true, installed: models.some((m) => isModel(m.name) || isModel(m.model)) };
  } catch {
    return { reachable: false, installed: false };
  }
}

async function readOllamaError(r) {
  const text = await r.text().catch(() => '');
  try {
    return JSON.parse(text).error || text;
  } catch {
    return text || `HTTP ${r.status}`;
  }
}

/**
 * Some models write their reasoning inline as <think>...</think>. Strip it,
 * including tags split across stream chunks, and drop leading whitespace.
 */
function makeThinkFilter() {
  let inThink = false;
  let carry = '';
  let started = false;
  return (chunk) => {
    let s = carry + chunk;
    carry = '';
    let out = '';
    while (s) {
      const tag = inThink ? '</think>' : '<think>';
      const i = s.indexOf(tag);
      if (i === -1) {
        // Hold back a possible partial tag at the end of this chunk.
        let keep = 0;
        for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
          if (tag.startsWith(s.slice(-k))) {
            keep = k;
            break;
          }
        }
        if (!inThink) out += s.slice(0, s.length - keep);
        carry = s.slice(s.length - keep);
        break;
      }
      if (!inThink) out += s.slice(0, i);
      s = s.slice(i + tag.length);
      inThink = !inThink;
    }
    if (!started) {
      out = out.replace(/^\s+/, '');
      if (out) started = true;
    }
    return out;
  };
}

app.post('/api/assistant', async (req, res) => {
  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages is required' });
  }
  const history = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length) return res.status(400).json({ error: 'messages must include a user message' });

  const controller = new AbortController();
  // Stop generating if the browser goes away (e.g. the user pressed Stop).
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const system = `${SYSTEM_PROMPT}\n\nToday is ${today}.\n\n${String(context || '').slice(0, 20000)}`;
  if (assistantProvider() === 'gemini') return streamGemini(res, system, history, controller.signal);

  const body = {
    model: OLLAMA_MODEL,
    messages: [{ role: 'system', content: system }, ...history],
    stream: true,
    // Thinking models (e.g. Qwen 3) reason before answering by default; for
    // short recommendations that's mostly extra waiting.
    think: false,
    keep_alive: '30m',
    options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.6 },
  };
  const call = () =>
    fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

  try {
    let upstream = await call();
    if (upstream.status === 400) {
      const error = await readOllamaError(upstream);
      if (!/think/i.test(error)) return res.status(502).json({ error: `Ollama rejected the request: ${error}` });
      // Model doesn't accept the think option; retry with its default.
      delete body.think;
      upstream = await call();
    }
    if (!upstream.ok) {
      const error = await readOllamaError(upstream);
      const message =
        upstream.status === 404
          ? `Ollama doesn't have the model ${OLLAMA_MODEL}. On the PC running Ollama, run: ollama pull ${OLLAMA_MODEL}`
          : `Ollama error ${upstream.status}: ${error}`;
      return res.status(502).json({ error: message });
    }

    // Headers go out with the first chunk, so errors before any text can
    // still be sent as a JSON error response.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');

    const filter = makeThinkFilter();
    const decoder = new TextDecoder();
    let buffer = '';
    let wrote = false;
    for await (const bytes of upstream.body) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        // message.thinking (separate reasoning) is deliberately not shown.
        const text = filter(event.message?.content ?? '');
        if (text) {
          res.write(text);
          wrote = true;
        }
      }
    }
    res.end(wrote ? undefined : 'The model returned an empty answer. Try asking again.');
  } catch (err) {
    if (err.name === 'AbortError') return;
    // Node's fetch reports connection problems (refused, timeout, no route) as "fetch failed".
    const message =
      err.message === 'fetch failed'
        ? `Savepoint can't reach Ollama at ${OLLAMA_URL}. Make sure Ollama is running, then try again.`
        : `The assistant stopped: ${err.message}`;
    if (!res.headersSent) res.status(502).json({ error: message });
    else res.end(`\n\n${message}`);
  }
});

const LOOKUP_TOOL = {
  functionDeclarations: [
    {
      name: 'look_up_game',
      description:
        "Look up current facts about one video game: whether and when it was released, platforms, developer, Steam player review score, and critics' reception from Wikipedia. Call it whenever the player asks about a specific game (is it out, is it good, what is it), because your own knowledge may be out of date.",
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: 'The game title, as the player wrote it' } },
        required: ['title'],
      },
    },
  ],
};

/** One non-streaming Gemini call. Throws { status, message } for API errors. */
async function geminiGenerate(model, payload, signal) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY.trim() },
      body: JSON.stringify(payload),
      signal,
    },
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error?.message ?? `HTTP ${r.status}`), { status: r.status });
  return data;
}

/**
 * Answers with Gemini. The model can call look_up_game (answered here from
 * free sources) before replying, so questions about recent games use current
 * facts instead of the model's training cutoff. Replies are short, so the
 * answer is sent in one piece rather than streamed.
 */
async function streamGemini(res, system, history, signal) {
  if (!has('GEMINI_API_KEY')) {
    return res
      .status(501)
      .json({ error: 'GEMINI_API_KEY is not set. Add it to .env (free key at aistudio.google.com).' });
  }
  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const payload = () => ({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    tools: [LOOKUP_TOOL],
    generationConfig: { temperature: 0.6, maxOutputTokens: 4096 },
  });

  // Free-tier models are sometimes busy (503) or slow. Retry the same model
  // briefly, then fall back to the others. The model that answered first is
  // tried first in later rounds.
  const order = GEMINI_MODEL_SET ? [GEMINI_MODEL] : [...GEMINI_FALLBACKS];
  let current = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Tool-call turns can't move between models (their signatures are tied to
  // the model that made them), so for a takeover they become plain text.
  const asPlainText = () =>
    contents
      .map((c) => ({
        role: c.role,
        parts: c.parts
          .filter((p) => !p.thought)
          .map((p) =>
            p.functionCall
              ? { text: `(Looking up "${p.functionCall.args?.title ?? ''}".)` }
              : p.functionResponse
                ? {
                    text: `Lookup result for "${p.functionResponse.name}": ${JSON.stringify(p.functionResponse.response)}`,
                  }
                : p.text !== undefined
                  ? { text: p.text }
                  : null,
          )
          .filter(Boolean),
      }))
      .filter((c) => c.parts.length);

  async function call() {
    let lastError = 'no model answered';
    let busy = false;
    const tryOrder = current ? [current, ...order.filter((m) => m !== current)] : order;
    for (const model of tryOrder) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await sleep(1500);
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), 20000);
        try {
          const body = payload();
          if (current && model !== current) body.contents = asPlainText();
          const data = await geminiGenerate(model, body, AbortSignal.any([signal, timeout.signal]));
          current = model;
          return data;
        } catch (err) {
          if (signal.aborted) throw err;
          if (err.status === 400 && /api key/i.test(err.message)) {
            throw Object.assign(new Error('Google rejected the Gemini API key. Check GEMINI_API_KEY in .env.'), {
              final: true,
            });
          }
          if (err.status === 429) {
            lastError =
              "Gemini's free quota is used up for now. It resets every minute and every day; try again a bit later.";
            break; // quota is per model; try the next one
          }
          if (err.status === 503 || timeout.signal.aborted) {
            busy = true;
            continue; // retry this model
          }
          lastError =
            err.status === 404 && GEMINI_MODEL_SET
              ? `Gemini doesn't have the model "${model}". Change GEMINI_MODEL in .env, or remove it to use the default.`
              : `Gemini (${model}): ${err.message}`;
          break;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    if (busy && /no model answered/.test(lastError)) {
      lastError = "Gemini's free models are busy right now. Try again in a minute.";
    }
    throw Object.assign(new Error(lastError), { final: true });
  }

  try {
    for (let round = 0; round < 4; round++) {
      const data = await call();
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const lookups = parts.filter((p) => p.functionCall?.name === 'look_up_game').slice(0, 4);
      if (lookups.length && round < 3) {
        // Keep the model's turn exactly as returned (it carries signatures the
        // API checks), then answer each lookup.
        contents.push(candidate.content);
        const answers = await Promise.all(
          lookups.map(async (p) => ({
            functionResponse: {
              name: 'look_up_game',
              response: await lookupGameFacts(String(p.functionCall.args?.title ?? '')).catch((err) => ({
                found: false,
                error: err.message,
              })),
            },
          })),
        );
        contents.push({ role: 'user', parts: answers });
        continue;
      }
      const text = parts
        .filter((p) => !p.thought && p.text)
        .map((p) => p.text)
        .join('')
        .trim();
      const blocked = data.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY';
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end(
        text ||
          (blocked
            ? 'Gemini declined to answer that one. Try asking about games to play next.'
            : 'The model returned an empty answer. Try asking again.'),
      );
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    const message = err.final
      ? err.message
      : err.message === 'fetch failed'
        ? "Savepoint can't reach the Gemini API. Check your internet connection."
        : `The assistant stopped: ${err.message}`;
    if (!res.headersSent) res.status(502).json({ error: message });
    else res.end(`\n\n${message}`);
  }
}

// Run directly (npm run server / dev): listen and check alerts on a timer.
// On Vercel, api/index.js imports the app and Vercel does the serving.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => {
    console.log(`Savepoint API on http://localhost:${PORT}`);
    startAlertTimer(async () => {
      await checkAlerts();
      await checkDealAlerts();
    });
    console.log(
      assistantProvider() === 'gemini'
        ? `Assistant: ${GEMINI_MODEL} via the Gemini API`
        : `Assistant: ${OLLAMA_MODEL} via Ollama at ${OLLAMA_URL}`,
    );
  });
}
