// GOG, unofficially: GOG has no public API for someone's library, so this signs
// in the way GOG Galaxy (and Heroic) do. The user signs in on gog.com, which
// then lands on a page whose address holds a one-time code; they copy that
// address and paste it here. The refresh token is kept encrypted in
// platform_logins and replaced each time GOG hands out a new one.
//
//   POST   /api/gog/connect       { code } -> { account }
//   DELETE /api/gog/connect
//   GET    /api/gog/library       -> { games: [{ externalId, name, minutes: 0, imageUrl, achievements? }] }
//   GET    /api/gog/achievements?ref=<product id>  -> { items }
//
// GOG doesn't share play time, so games come in with no hours. Achievements
// belong to each game's own Galaxy client, found in the game's build files.
import express from 'express';
import { inflateSync } from 'node:zlib';
import { diskCache } from './diskCache.mjs';
import { mapLimit } from './epic.mjs';
import { loadLogin, NotConnected, removeLogin, saveLogin } from './platformLogins.mjs';

// GOG Galaxy's public client.
const CLIENT_ID = '46899977096215655';
const CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';
const REDIRECT = 'https://embed.gog.com/on_login_success?origin=client';
const UA = 'Savepoint/0.1 (self-hosted game library app)';

/** Where the user signs in; afterwards the address bar holds the code. */
export const GOG_LOGIN_PAGE = `https://auth.gog.com/auth?${new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  layout: 'client2',
})}`;

const MAX_ACHIEVEMENT_GAMES = 25; // per sync; the rest come from the cache or later syncs
const ACHIEVEMENTS_MAX_AGE = 24 * 3600 * 1000;
const clientCache = diskCache('gog-clients', 0); // product id -> { clientId, clientSecret } | { none: true }
const achievementCache = diskCache('gog-achievements', 0); // user:product -> { at, counts }

export class GogError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** The code in whatever was pasted: the address GOG lands on, or the code itself. */
export function findGogCode(text) {
  const t = String(text ?? '').trim();
  return /[?&]code=([\w-]{20,})/.exec(t)?.[1] ?? (/^[\w-]{30,}$/.test(t) ? t : null);
}

async function token(params) {
  let r;
  try {
    r = await fetch(`https://auth.gog.com/token?${new URLSearchParams(params)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new GogError("Couldn't reach GOG. Try again in a moment.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return { error: j.error ?? `status ${r.status}`, status: r.status };
  return j;
}

const sessions = new Map(); // userId -> { accessToken, refreshToken, gogUserId, expiresAt }

export async function gogAuthFor(userId) {
  const cached = sessions.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  const stored = await loadLogin(userId, 'gog');
  if (!stored) throw new NotConnected('Connect GOG first (Platforms page).');
  let saved;
  try {
    saved = JSON.parse(stored.secret);
  } catch {
    throw new NotConnected('Connect GOG again (Platforms page).');
  }
  const j = await token({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: saved.refreshToken,
  });
  if (j.error) {
    if (j.status >= 500) throw new GogError("GOG isn't answering. Try again later.");
    throw new NotConnected('Your GOG connection has expired. Disconnect it and connect again.');
  }
  await keep(userId, j, null);
  return sessions.get(userId);
}

async function keep(userId, j, account) {
  await saveLogin(userId, 'gog', JSON.stringify({ refreshToken: j.refresh_token, gogUserId: j.user_id }), account);
  sessions.set(userId, {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    gogUserId: j.user_id,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  });
}

async function gogGet(accessToken, url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 401) throw new NotConnected('Your GOG connection has expired. Disconnect it and connect again.');
  if (!r.ok) throw new GogError(`GOG answered ${r.status}`);
  return r.json();
}

/** The games the account owns, from GOG's own account page data. */
async function ownedProducts(auth) {
  const out = [];
  for (let page = 1, pages = 1; page <= pages && page <= 100; page++) {
    const j = await gogGet(
      auth.accessToken,
      `https://embed.gog.com/account/getFilteredProducts?mediaType=1&sortBy=title&page=${page}`,
    );
    out.push(...(j.products ?? []));
    pages = Number(j.totalPages) || 1;
  }
  return out;
}

/** A game's own Galaxy client, from its build files. Kept for good. */
async function gameClient(productId) {
  const hit = await clientCache.get(productId);
  if (hit) return hit.none ? null : hit;
  const builds = await fetch(
    `https://content-system.gog.com/products/${encodeURIComponent(productId)}/os/windows/builds?generation=2`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) },
  ).then((r) => (r.ok ? r.json() : null));
  const link = builds?.items?.[0]?.link;
  let meta = null;
  if (link) {
    const buf = Buffer.from(await (await fetch(link, { signal: AbortSignal.timeout(15000) })).arrayBuffer());
    try {
      meta = JSON.parse(inflateSync(buf).toString('utf8'));
    } catch {
      meta = JSON.parse(buf.toString('utf8'));
    }
  }
  const found =
    meta?.clientId && meta?.clientSecret ? { clientId: meta.clientId, clientSecret: meta.clientSecret } : null;
  await clientCache.set(productId, found ?? { none: true });
  return found;
}

/** The user's achievements in one game (every one, with unlock dates), or null when it has none. */
async function gameAchievements(auth, productId) {
  const client = await gameClient(productId);
  if (!client) return null;
  // A token for the game's own client, from the same sign-in.
  const t = await token({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    without_new_session: '1',
  });
  if (t.error) throw new GogError("GOG didn't hand out a token for this game.");
  const j = await gogGet(
    t.access_token,
    `https://gameplay.gog.com/clients/${client.clientId}/users/${auth.gogUserId}/achievements`,
  );
  const items = j.items ?? [];
  return items.length ? items : null;
}

export async function gogAchievementItems(userId, productId) {
  const auth = await gogAuthFor(userId);
  const items = (await gameAchievements(auth, productId)) ?? [];
  return items.map((a) => ({
    name: a.name,
    description: a.description ?? '',
    icon: (a.date_unlocked ? a.image_url_unlocked : a.image_url_locked) || null,
    earnedAt: a.date_unlocked || null,
    hidden: a.visible === false,
    rarity: typeof a.rarity === 'number' ? a.rarity : null,
  }));
}

/** The account's GOG games, with achievements for those GOG Galaxy tracks. */
export async function gogLibrary(userId) {
  const auth = await gogAuthFor(userId);
  const products = await ownedProducts(auth);
  const games = products
    .filter((p) => p.id && p.title && p.isGame !== false)
    .map((p) => ({
      externalId: String(p.id),
      name: p.title,
      minutes: 0,
      lastPlayed: null,
      imageUrl: p.image ? `https:${p.image}_392.jpg` : undefined,
      galaxy: p.isGalaxyCompatible !== false,
    }));

  // Achievement counts, refreshed a few games at a time, oldest first.
  const cached = await Promise.all(games.map((g) => achievementCache.get(`${userId}:${g.externalId}`)));
  const due = games
    .map((g, i) => ({ g, hit: cached[i] }))
    .filter(({ g, hit }) => g.galaxy && (!hit || Date.now() - hit.at > ACHIEVEMENTS_MAX_AGE))
    .sort((a, b) => (a.hit?.at ?? 0) - (b.hit?.at ?? 0))
    .slice(0, MAX_ACHIEVEMENT_GAMES);
  await mapLimit(due, 4, async ({ g }) => {
    const items = await gameAchievements(auth, g.externalId);
    const counts = items ? { earned: items.filter((a) => a.date_unlocked).length, total: items.length } : null;
    await achievementCache.set(`${userId}:${g.externalId}`, { at: Date.now(), counts });
    cached[games.indexOf(g)] = { counts };
  });
  return games.map((game, i) => {
    const { galaxy: _galaxy, ...g } = game;
    return cached[i]?.counts ? { ...g, achievements: cached[i].counts } : g;
  });
}

export const gogRouter = express.Router();

gogRouter.post('/api/gog/connect', express.json({ limit: '20kb' }), async (req, res) => {
  const code = findGogCode(req.body?.code);
  if (!code) {
    return res
      .status(400)
      .json({ error: 'No code in what was pasted. Copy the whole address of the page GOG lands on.' });
  }
  const j = await token({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
  }).catch((err) => ({ error: err.message }));
  if (j.error) {
    return res
      .status(400)
      .json({ error: 'GOG didn’t accept that code. Codes work once: sign in again and copy the new address.' });
  }
  const account = await gogGet(j.access_token, 'https://embed.gog.com/userData.json')
    .then((d) => d.username ?? null)
    .catch(() => null);
  try {
    await keep(req.userId, j, account);
    res.json({ account });
  } catch (err) {
    console.error('Connect GOG:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

gogRouter.delete('/api/gog/connect', async (req, res) => {
  try {
    sessions.delete(req.userId);
    await removeLogin(req.userId, 'gog');
    res.status(204).end();
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

const sendError = (res, err, what) =>
  res
    .status(err instanceof NotConnected ? 409 : (err.status ?? 502))
    .json({ error: err instanceof NotConnected || err instanceof GogError ? err.message : `${what}: ${err.message}` });

gogRouter.get('/api/gog/library', async (req, res) => {
  try {
    res.json({ games: await gogLibrary(req.userId) });
  } catch (err) {
    sendError(res, err, 'GOG import failed');
  }
});

gogRouter.get('/api/gog/achievements', async (req, res) => {
  const ref = String(req.query.ref ?? '');
  if (!/^\d{1,20}$/.test(ref)) return res.status(400).json({ error: 'Which game?' });
  try {
    res.json({ items: await gogAchievementItems(req.userId, ref) });
  } catch (err) {
    sendError(res, err, 'GOG achievements failed');
  }
});
