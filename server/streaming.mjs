// Streaming: who's live in a game right now (Twitch, Kick), and the
// games your favourite streamers play, which feed Play next and More like this.
//
// App-level keys (.env):
//   TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET   (already used for IGDB) live streams, and Twitch sign-in
//   KICK_CLIENT_ID / KICK_CLIENT_SECRET       live streams on Kick, and reading Kick channels
//
// Per account: the Twitch sign-in (refresh token, encrypted in
// platform_logins like PlayStation's). Kick's API has no way to read who you
// follow, so Kick channels are typed in (stored in the account's state).
//
// Mounted after requireLogin.
//   GET    /api/streams?title=&igdbId=     { twitch, kick }, top 5 live each
//   GET    /api/streaming                  connections and which services are set up
//   GET    /api/auth/twitch/start, /callback
//   DELETE /api/streaming/:service         disconnects Twitch
//   POST   /api/streaming/taste            { kick: [slugs] } -> { games, channels }
//   POST   /api/streaming/live             { kick: [slugs] } -> { live } followed channels live now
import express from 'express';
import { randomBytes } from 'node:crypto';
import { readSigned, setCookie, signValue } from './auth.mjs';
import { query } from './db.mjs';
import { diskCache } from './diskCache.mjs';
import { normalizeTitle } from './genres.mjs';
import { igdbConfigured, igdbGame, igdbGameById, twitchAppToken } from './igdb.mjs';
import { loadLogin, removeLogin, saveLogin } from './platformLogins.mjs';

const has = (name) => Boolean(process.env[name]?.trim());
const env = (name) => process.env[name].trim();
export const streamingConfigured = () => ({
  twitch: has('TWITCH_CLIENT_ID') && has('TWITCH_CLIENT_SECRET'),
  kick: has('KICK_CLIENT_ID') && has('KICK_CLIENT_SECRET'),
});

/** Categories streamed a lot that aren't games. */
const NOT_GAMES = new Set(
  [
    'Just Chatting',
    'IRL',
    'Music',
    'Art',
    'Sports',
    'Talk Shows & Podcasts',
    'ASMR',
    'Pools, Hot Tubs, and Beaches',
    'Special Events',
    'Travel & Outdoors',
    'Science & Technology',
    'Software and Game Development',
    'Food & Drink',
    'Makers & Crafting',
    'Politics',
    'Fitness & Health',
    "I'm Only Sleeping",
    'Slots',
    'Slots & Casino',
    'Virtual Casino',
    'Crypto',
    'Animals, Aquariums, and Zoos',
    'Games + Demos',
    'Retro',
    'Chess',
    'Poker',
  ].map((s) => s.toLowerCase()),
);

/** This site's address as the browser sees it (behind Vite's proxy or Vercel too). */
function origin(req) {
  const first = (v) => String(v).split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto'] ?? (req.secure ? 'https' : 'http'));
  return `${proto}://${first(req.headers['x-forwarded-host'] ?? req.headers.host)}`;
}

async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  if (!r.ok) {
    const err = new Error(`${new URL(url).host}: HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/** Small in-memory cache with per-key expiry, shared by everyone on this instance. */
function memo(ms) {
  const map = new Map();
  return async (key, fn) => {
    const hit = map.get(key);
    if (hit && hit.at > Date.now() - ms) return hit.value;
    const value = await fn();
    map.set(key, { at: Date.now(), value });
    if (map.size > 500) map.delete(map.keys().next().value);
    return value;
  };
}

// ---------------------------------------------------------------- Twitch

const helixHeaders = async (token) => ({
  'Client-Id': env('TWITCH_CLIENT_ID'),
  Authorization: `Bearer ${token ?? (await twitchAppToken())}`,
});

async function helix(path, token) {
  return getJson(`https://api.twitch.tv/helix/${path}`, { headers: await helixHeaders(token) });
}

const twitchGameIds = memo(24 * 3600 * 1000);

/** Twitch's category id for a game: by IGDB id when known, else by exact name. */
async function twitchGameId({ title, igdbId }) {
  return twitchGameIds(`${igdbId ?? ''}|${normalizeTitle(title)}`, async () => {
    if (igdbId) {
      const byIgdb = (await helix(`games?igdb_id=${igdbId}`)).data?.[0];
      if (byIgdb) return byIgdb.id;
    }
    const byName = (await helix(`games?name=${encodeURIComponent(title)}`)).data?.[0];
    return byName?.id ?? null;
  });
}

const twitchThumb = (url) => url?.replace('{width}', '440').replace('{height}', '248');

async function twitchStreams(game) {
  const id = await twitchGameId(game);
  if (!id) return [];
  const { data = [] } = await helix(`streams?game_id=${id}&first=5&type=live`);
  return data.map((s) => ({
    platform: 'twitch',
    channel: s.user_name,
    title: s.title,
    viewers: s.viewer_count,
    language: s.language,
    thumbnail: twitchThumb(s.thumbnail_url),
    startedAt: s.started_at,
    url: `https://www.twitch.tv/${s.user_login}`,
  }));
}

// ---------------------------------------------------------------- Kick

let kickToken = null;

async function kickAppToken() {
  if (kickToken && kickToken.expiresAt > Date.now() + 60_000) return kickToken.token;
  const j = await getJson('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env('KICK_CLIENT_ID'),
      client_secret: env('KICK_CLIENT_SECRET'),
    }),
  });
  kickToken = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return kickToken.token;
}

async function kick(path) {
  return getJson(`https://api.kick.com/public/${path}`, {
    headers: { Authorization: `Bearer ${await kickAppToken()}`, Accept: 'application/json' },
  });
}

const kickCategories = memo(24 * 3600 * 1000);

async function kickCategoryId(title) {
  return kickCategories(normalizeTitle(title), async () => {
    const { data = [] } = await kick(`v2/categories?name=${encodeURIComponent(title)}&limit=10`);
    const want = normalizeTitle(title);
    return data.find((c) => normalizeTitle(c.name) === want)?.id ?? null;
  });
}

async function kickStreams({ title }) {
  const id = await kickCategoryId(title);
  if (!id) return [];
  const { data = [] } = await kick(`v1/livestreams?category_id=${id}&sort=viewer_count&limit=5`);
  return data
    .sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0))
    .slice(0, 5)
    .map((s) => ({
      platform: 'kick',
      channel: s.slug,
      title: s.stream_title,
      viewers: s.viewer_count,
      language: s.language,
      thumbnail: s.thumbnail || undefined,
      avatar: s.profile_picture || undefined,
      startedAt: s.started_at,
      url: `https://kick.com/${s.slug}`,
    }));
}

/** Kick channels by slug: name, category being (or last) streamed, and whether they're live. */
async function kickChannels(slugs) {
  const out = [];
  for (let i = 0; i < slugs.length; i += 25) {
    const qs = slugs
      .slice(i, i + 25)
      .map((s) => `slug=${encodeURIComponent(s)}`)
      .join('&');
    const { data = [] } = await kick(`v1/channels?${qs}`);
    out.push(...data);
  }
  return out;
}

// ---------------------------------------------------------------- live in a game

const liveTwitch = memo(3 * 60 * 1000);
const liveKick = memo(3 * 60 * 1000);

async function streamsFor(game) {
  const c = streamingConfigured();
  const key = normalizeTitle(game.title);
  const safe = (p) => p.catch(() => null);
  const [twitch, kickList] = await Promise.all([
    c.twitch ? safe(liveTwitch(`${game.igdbId ?? ''}|${key}`, () => twitchStreams(game))) : null,
    c.kick ? safe(liveKick(key, () => kickStreams(game))) : null,
  ]);
  return { twitch, kick: kickList };
}

// ---------------------------------------------------------------- sign-ins

const STATE_COOKIE = 'sp_stream_oauth';
const STATE_MS = 10 * 60 * 1000;

const SERVICES = {
  twitch: {
    configured: () => streamingConfigured().twitch,
    authorize: 'https://id.twitch.tv/oauth2/authorize',
    token: 'https://id.twitch.tv/oauth2/token',
    clientId: () => env('TWITCH_CLIENT_ID'),
    clientSecret: () => env('TWITCH_CLIENT_SECRET'),
    scope: 'user:read:follows',
  },
};

const callbackUrl = (req, service) => `${origin(req)}/api/auth/${service}/callback`;

async function exchange(service, params) {
  const s = SERVICES[service];
  return getJson(s.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s.clientId(), client_secret: s.clientSecret(), ...params }),
  });
}

/** Who signed in with Twitch: { id, name }. */
async function whoAmI(accessToken) {
  const u = (await helix('users', accessToken)).data?.[0];
  return { id: u.id, name: u.display_name || u.login };
}

const userTokens = new Map(); // `${userId}|${service}` -> { token, expiresAt }

class NotConnected extends Error {}

/** A fresh access token for the account's own Twitch sign-in. */
async function userToken(userId, service) {
  const key = `${userId}|${service}`;
  const hit = userTokens.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const stored = await loadLogin(userId, service);
  if (!stored) throw new NotConnected(service);
  let j;
  try {
    j = await exchange(service, { grant_type: 'refresh_token', refresh_token: stored.secret });
  } catch (err) {
    // Revoked or expired: the sign-in has to be done again.
    if (err.status === 400 || err.status === 401) {
      await removeLogin(userId, service);
      throw new NotConnected(service);
    }
    throw err;
  }
  // Twitch hands out a new refresh token each time; keep the newest.
  if (j.refresh_token && j.refresh_token !== stored.secret) await saveLogin(userId, service, j.refresh_token, null);
  userTokens.set(key, { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

async function accountId(userId, service) {
  const { rows } = await query(
    'SELECT "account_id", "account_name" FROM platform_logins WHERE "user_id" = $1 AND "platform" = $2',
    [userId, service],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- favourite streamers and their games

/** Twitch channels you follow: { id, name, login, game, igdbId }. Up to 500. */
async function twitchFollows(userId) {
  const token = await userToken(userId, 'twitch');
  const me = await accountId(userId, 'twitch');
  const follows = [];
  let cursor = '';
  do {
    const page = await helix(
      `channels/followed?user_id=${me.account_id}&first=100${cursor ? `&after=${cursor}` : ''}`,
      token,
    );
    follows.push(...(page.data ?? []));
    cursor = page.pagination?.cursor ?? '';
  } while (cursor && follows.length < 500);
  // What each channel streams (its current or last category).
  const channels = [];
  for (let i = 0; i < follows.length; i += 100) {
    const ids = follows
      .slice(i, i + 100)
      .map((f) => `broadcaster_id=${f.broadcaster_id}`)
      .join('&');
    channels.push(...((await helix(`channels?${ids}`)).data ?? []));
  }
  const gameIds = [...new Set(channels.map((c) => c.game_id).filter(Boolean))];
  const igdbIds = new Map();
  for (let i = 0; i < gameIds.length; i += 100) {
    const ids = gameIds
      .slice(i, i + 100)
      .map((id) => `id=${id}`)
      .join('&');
    for (const g of (await helix(`games?${ids}`)).data ?? []) igdbIds.set(g.id, Number(g.igdb_id) || null);
  }
  return channels.map((c) => ({
    id: c.broadcaster_id,
    name: c.broadcaster_name,
    login: c.broadcaster_login,
    game: c.game_name || null,
    igdbId: igdbIds.get(c.game_id) ?? null,
  }));
}

const tasteCache = diskCache('streaming-taste', 12 * 3600 * 1000);

/**
 * The games your favourite streamers play, with genres for matching:
 * { games: [{ title, weight (0..1), channels, igdbId, genres, subgenres, tags,
 *   steamAppId, imageUrl, availableOn }], channels: { twitch, kick } }.
 */
async function streamingTaste(userId, kickSlugs) {
  const key = `${userId}|${kickSlugs.join(',')}`;
  const cached = await tasteCache.get(key);
  if (cached !== undefined) return cached;

  const byGame = new Map(); // normalized title -> { title, igdbId, channels: Set }
  const add = (title, igdbId, channel) => {
    if (!title || NOT_GAMES.has(title.toLowerCase())) return;
    const k = normalizeTitle(title);
    const prev = byGame.get(k) ?? { title, igdbId, channels: new Set() };
    prev.igdbId ??= igdbId;
    prev.channels.add(channel);
    byGame.set(k, prev);
  };
  const channels = { twitch: [], kick: [] };
  const c = streamingConfigured();

  if (c.twitch) {
    try {
      const follows = await twitchFollows(userId);
      channels.twitch = follows.map((f) => ({ name: f.name, url: `https://www.twitch.tv/${f.login}`, game: f.game }));
      for (const f of follows) add(f.game, f.igdbId, f.name);
    } catch (err) {
      if (!(err instanceof NotConnected)) throw err;
    }
  }
  if (c.kick && kickSlugs.length) {
    const list = await kickChannels(kickSlugs).catch(() => []);
    channels.kick = list.map((k) => ({ name: k.slug, url: `https://kick.com/${k.slug}`, game: k.category?.name }));
    for (const k of list) add(k.category?.name, null, k.slug);
  }

  // Most-streamed first; the top 15 count.
  const ranked = [...byGame.values()].sort((a, b) => b.channels.size - a.channels.size).slice(0, 15);
  const max = Math.max(1, ...ranked.map((g) => g.channels.size));
  const games = [];
  for (const g of ranked) {
    let info = null;
    if (igdbConfigured()) {
      info = await (g.igdbId ? igdbGameById(g.igdbId) : igdbGame({ title: g.title })).catch(() => null);
    }
    games.push({
      title: info?.title ?? g.title,
      weight: Math.round((g.channels.size / max) * 100) / 100,
      channels: [...g.channels].slice(0, 5),
      igdbId: info?.igdbId ?? g.igdbId ?? undefined,
      genres: info?.genres ?? [],
      subgenres: info?.subgenres ?? [],
      tags: info?.tags ?? [],
      steamAppId: info?.steamAppId,
      imageUrl: info?.imageUrl,
      year: info?.year,
      developer: info?.developer,
      availableOn: info?.availableOn ?? [],
    });
  }
  const result = {
    games,
    channels: {
      twitch: channels.twitch.slice(0, 200),
      kick: channels.kick,
    },
  };
  await tasteCache.set(key, result);
  return result;
}

const cleanSlugs = (list) =>
  [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim().toLowerCase()).filter((s) => /^[\w-]{2,40}$/.test(s)))].slice(0, 50);

// ---------------------------------------------------------------- routes

export const streamingRouter = express.Router();

streamingRouter.get('/api/streams', async (req, res) => {
  const title = String(req.query.title || '').trim().slice(0, 200);
  const igdbId = Number(req.query.igdbId) || undefined;
  if (!title) return res.status(400).json({ error: 'title is required' });
  res.set('Cache-Control', 'private, max-age=120');
  res.json(await streamsFor({ title, igdbId }));
});

streamingRouter.get('/api/streaming', async (req, res) => {
  try {
    const twitch = await accountId(req.userId, 'twitch');
    res.json({
      configured: streamingConfigured(),
      twitch: twitch ? { account: twitch.account_name } : null,
    });
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

for (const service of Object.keys(SERVICES)) {
  streamingRouter.get(`/api/auth/${service}/start`, async (req, res) => {
    const s = SERVICES[service];
    if (!s.configured()) return res.redirect(`/settings?${service}=unavailable#streaming`);
    const nonce = randomBytes(16).toString('base64url');
    setCookie(req, res, STATE_COOKIE, await signValue({ n: nonce, s: service, u: req.userId, exp: Date.now() + STATE_MS }), STATE_MS);
    const url = new URL(s.authorize);
    url.search = new URLSearchParams({
      client_id: s.clientId(),
      redirect_uri: callbackUrl(req, service),
      response_type: 'code',
      scope: s.scope,
      state: nonce,
    }).toString();
    res.redirect(url.toString());
  });

  streamingRouter.get(`/api/auth/${service}/callback`, async (req, res) => {
    const state = await readSigned(req, STATE_COOKIE);
    setCookie(req, res, STATE_COOKIE, '', 0);
    const back = (result) => res.redirect(`/settings?${service}=${result}#streaming`);
    if (!state || state.s !== service || state.u !== req.userId || req.query.state !== state.n) return back('failed');
    if (req.query.error || typeof req.query.code !== 'string') return back('cancelled');
    try {
      const j = await exchange(service, {
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: callbackUrl(req, service),
      });
      if (!j.refresh_token) return back('failed');
      const me = await whoAmI(j.access_token);
      await saveLogin(req.userId, service, j.refresh_token, me.name);
      await query('UPDATE platform_logins SET "account_id" = $3 WHERE "user_id" = $1 AND "platform" = $2', [
        req.userId,
        service,
        me.id,
      ]);
      userTokens.set(`${req.userId}|${service}`, {
        token: j.access_token,
        expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
      });
      back('connected');
    } catch (err) {
      console.error(`${service} sign-in:`, err);
      back('failed');
    }
  });
}

streamingRouter.delete('/api/streaming/:service', async (req, res) => {
  const service = req.params.service;
  if (!SERVICES[service]) return res.status(404).json({ error: 'Not found.' });
  try {
    await removeLogin(req.userId, service);
    userTokens.delete(`${req.userId}|${service}`);
    res.status(204).end();
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

streamingRouter.post('/api/streaming/taste', express.json({ limit: '10kb' }), async (req, res) => {
  try {
    res.json(await streamingTaste(req.userId, cleanSlugs(req.body?.kick)));
  } catch (err) {
    res.status(502).json({ error: `Couldn't read your streamers: ${err.message}` });
  }
});

const liveFollowed = memo(2 * 60 * 1000);

/** Followed channels live now: Twitch (signed in) and Kick (typed-in channels). */
streamingRouter.post('/api/streaming/live', express.json({ limit: '10kb' }), async (req, res) => {
  const slugs = cleanSlugs(req.body?.kick);
  const c = streamingConfigured();
  try {
    const live = await liveFollowed(`${req.userId}|${slugs.join(',')}`, async () => {
      const out = [];
      if (c.twitch) {
        try {
          const token = await userToken(req.userId, 'twitch');
          const me = await accountId(req.userId, 'twitch');
          const { data = [] } = await helix(`streams/followed?user_id=${me.account_id}&first=20`, token);
          out.push(
            ...data.map((s) => ({
              platform: 'twitch',
              channel: s.user_name,
              title: s.title,
              game: s.game_name,
              viewers: s.viewer_count,
              thumbnail: twitchThumb(s.thumbnail_url),
              url: `https://www.twitch.tv/${s.user_login}`,
            })),
          );
        } catch (err) {
          if (!(err instanceof NotConnected)) throw err;
        }
      }
      if (c.kick && slugs.length) {
        for (const k of await kickChannels(slugs).catch(() => [])) {
          if (!k.stream?.is_live) continue;
          out.push({
            platform: 'kick',
            channel: k.slug,
            title: k.stream_title,
            game: k.category?.name,
            viewers: k.stream.viewer_count,
            thumbnail: k.stream.thumbnail || undefined,
            url: `https://kick.com/${k.slug}`,
          });
        }
      }
      return out.sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
    });
    res.json({ live });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
