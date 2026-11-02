// Epic Games, unofficially: Epic has no public API for someone's library or
// play time, so this signs in the way the Epic Games Launcher (and open-source
// launchers like Legendary, Heroic and Playnite) do. The user signs in on
// epicgames.com, copies the one-time authorization code Epic shows, and pastes
// it here. Only the refresh token is kept (encrypted, in platform_logins);
// each sync swaps it for a new one, so syncing keeps the connection alive.
//
//   POST   /api/epic/connect       { code } -> { account }
//   DELETE /api/epic/connect
//   GET    /api/epic/library       -> { games: [{ externalId, name, minutes, imageUrl, isApp, achievements? }] }
//   GET    /api/epic/achievements?ref=<namespace>  -> { items } (the game page's list)
//
// Play time is Epic's own record (what the launcher shows), so it counts as
// confirmed. Epic only records games started through its launcher.
import express from 'express';
import { diskCache } from './diskCache.mjs';
import { loadLogin, NotConnected, removeLogin, saveLogin } from './platformLogins.mjs';

// The Epic Games Launcher's public client, as used by Legendary.
const LAUNCHER_ID = '34a02cf8f4414e29b15921876da36f9a';
const CLIENT = Buffer.from(`${LAUNCHER_ID}:daafbccc737745039dffe53d94fc76cf`).toString('base64');
const OAUTH = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token';
const LIBRARY = 'https://library-service.live.use1a.on.epicgames.com/library/api/public';
const CATALOG = 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace';
const STORE_GQL = 'https://launcher.store.epicgames.com/graphql';
const UA = 'UELauncher/11.0.1-14907503+++Portal+Release-Live Windows/10.0.19041.1.256.64bit';
const STORE_UA = 'EpicGamesLauncher/14.0.8-22004686+++Portal+Release-Live';

/** Where the user signs in and sees the code to copy. */
export const EPIC_CODE_PAGE = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(
  `https://www.epicgames.com/id/api/redirect?clientId=${LAUNCHER_ID}&responseType=code`,
)}`;

const MAX_ACHIEVEMENT_GAMES = 40; // per sync; the rest come from the cache or the next sync
const catalogCache = diskCache('epic-catalog', 0);
const achievementDefs = diskCache('epic-achievement-defs', 7 * 24 * 3600 * 1000);
const achievementUser = diskCache('epic-achievements', 0);

export class EpicError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** The authorization code in whatever was pasted: Epic's whole JSON page, or the code itself. */
export function findEpicCode(text) {
  const t = String(text ?? '').trim();
  return /"authorizationCode"\s*:\s*"([0-9a-f]{32})"/i.exec(t)?.[1] ?? (/^[0-9a-f]{32}$/i.test(t) ? t : null);
}

async function tokenRequest(params) {
  let r;
  try {
    r = await fetch(OAUTH, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${CLIENT}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
      },
      body: new URLSearchParams({ ...params, token_type: 'eg1' }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new EpicError("Couldn't reach Epic. Try again in a moment.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errorCode) return { error: j.errorCode ?? `status ${r.status}`, status: r.status };
  return j;
}

const sessions = new Map(); // userId -> { accessToken, accountId, expiresAt }

/** A fresh Epic access token for the user. Throws NotConnected when there's no (working) connection. */
export async function epicAuthFor(userId) {
  const cached = sessions.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  const stored = await loadLogin(userId, 'epic');
  if (!stored) throw new NotConnected('Connect Epic Games first (Platforms page).');
  let saved;
  try {
    saved = JSON.parse(stored.secret);
  } catch {
    throw new NotConnected('Connect Epic Games again (Platforms page).');
  }
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refreshToken });
  if (j.error) {
    if (j.status >= 500) throw new EpicError("Epic isn't answering. Try again later.");
    throw new NotConnected('Your Epic Games connection has expired. Disconnect it and connect again.');
  }
  await keep(userId, j);
  return sessions.get(userId);
}

/** Saves the newest refresh token (Epic hands out a new one each time) and caches the access token. */
async function keep(userId, j) {
  const expires = j.refresh_expires_at ? new Date(j.refresh_expires_at) : null;
  await saveLogin(
    userId,
    'epic',
    JSON.stringify({ refreshToken: j.refresh_token, accountId: j.account_id }),
    j.displayName ?? null,
    expires,
  );
  sessions.set(userId, {
    accessToken: j.access_token,
    accountId: j.account_id,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  });
}

async function epicGet(auth, url) {
  const r = await fetch(url, {
    headers: { Authorization: `bearer ${auth.accessToken}`, 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 401) {
    sessions.clear();
    throw new NotConnected('Your Epic Games connection has expired. Disconnect it and connect again.');
  }
  if (!r.ok) throw new EpicError(`Epic answered ${r.status}`);
  return r.json();
}

async function libraryItems(auth) {
  const records = [];
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({ includeMetadata: 'true' });
    if (cursor) qs.set('cursor', cursor);
    const j = await epicGet(auth, `${LIBRARY}/items?${qs}`);
    records.push(...(j.records ?? []));
    cursor = j.responseMetadata?.nextCursor;
    if (!cursor) break;
  }
  return records;
}

/** Title, cover and kind of a catalog item. Doesn't change, so it's kept for good. */
async function catalogItem(auth, namespace, id) {
  const key = `${namespace}:${id}`;
  const hit = await catalogCache.get(key);
  if (hit) return hit;
  const qs = new URLSearchParams({
    id,
    includeDLCDetails: 'true',
    includeMainGameDetails: 'true',
    country: 'US',
    locale: 'en',
  });
  const j = await epicGet(auth, `${CATALOG}/${encodeURIComponent(namespace)}/bulk/items?${qs}`);
  const item = j?.[id];
  if (!item) return null;
  const images = item.keyImages ?? [];
  const image =
    images.find((i) => i.type === 'DieselGameBoxTall') ??
    images.find((i) => i.type === 'Thumbnail') ??
    images.find((i) => i.type === 'DieselGameBox') ??
    images[0];
  const paths = (item.categories ?? []).map((c) => c.path);
  const info = {
    title: item.title,
    imageUrl: image?.url,
    // DLC points at the game it belongs to.
    dlc: !!item.mainGameItem || paths.some((p) => p.startsWith('addons')),
    app: !paths.includes('games') && paths.some((p) => /applications|software/.test(p)),
  };
  await catalogCache.set(key, info);
  return info;
}

/** Runs `fn` over `items`, `limit` at a time. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i).catch(() => null);
      }
    }),
  );
  return out;
}

const DEFS_QUERY = `query Achievement($sandboxId: String!, $locale: String!) {
  Achievement { productAchievementsRecordBySandbox(sandboxId: $sandboxId, locale: $locale) {
    totalAchievements
    achievements { achievement { name hidden unlockedDisplayName lockedDisplayName unlockedDescription
      lockedDescription unlockedIconLink lockedIconLink rarity { percent } } }
  } }
}`;
const USER_QUERY = `query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) {
  PlayerAchievement { playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) {
    records { totalUnlocked playerAchievements { playerAchievement { achievementName unlocked unlockDate } } }
  } }
}`;

async function gql(auth, query, variables) {
  const r = await fetch(STORE_GQL, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${auth.accessToken}`,
      'User-Agent': STORE_UA,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new EpicError(`Epic's store answered ${r.status}`);
  return r.json();
}

/** A game's achievements (definitions), or [] when it has none. */
async function achievementList(auth, namespace) {
  const hit = await achievementDefs.get(namespace);
  if (hit) return hit;
  const j = await gql(auth, DEFS_QUERY, { sandboxId: namespace, locale: 'en' });
  const rec = j?.data?.Achievement?.productAchievementsRecordBySandbox;
  const list = (rec?.achievements ?? []).map(({ achievement: a }) => ({
    id: a.name,
    name: a.unlockedDisplayName || a.lockedDisplayName || a.name,
    description: a.unlockedDescription || a.lockedDescription || '',
    icon: a.unlockedIconLink || null,
    lockedIcon: a.lockedIconLink || null,
    hidden: !!a.hidden,
    rarity: a.rarity?.percent ?? null,
  }));
  await achievementDefs.set(namespace, list);
  return list;
}

async function unlockedBy(auth, namespace) {
  const j = await gql(auth, USER_QUERY, { epicAccountId: auth.accountId, sandboxId: namespace });
  const records = j?.data?.PlayerAchievement?.playerAchievementGameRecordsBySandbox?.records ?? [];
  const out = new Map();
  for (const rec of records) {
    for (const { playerAchievement: p } of rec.playerAchievements ?? []) {
      if (p?.unlocked) out.set(p.achievementName, p.unlockDate ?? null);
    }
  }
  return out;
}

/** Earned and total achievements of a game, or null when it has none. */
async function achievementCounts(auth, namespace) {
  const list = await achievementList(auth, namespace);
  if (!list.length) return null;
  const unlocked = await unlockedBy(auth, namespace);
  return { earned: list.filter((a) => unlocked.has(a.id)).length, total: list.length };
}

/** The game page's list: every achievement with its unlock date (null when locked). */
export async function epicAchievementItems(userId, namespace) {
  const auth = await epicAuthFor(userId);
  const [list, unlocked] = await Promise.all([achievementList(auth, namespace), unlockedBy(auth, namespace)]);
  return list.map((a) => ({
    name: a.name,
    description: a.description,
    icon: unlocked.has(a.id) ? a.icon : (a.lockedIcon ?? a.icon),
    earnedAt: unlocked.has(a.id) ? (unlocked.get(a.id) ?? '') : null,
    hidden: a.hidden,
    rarity: a.rarity,
  }));
}

/** The user's Epic games with Epic's play time and achievements. */
export async function epicLibrary(userId) {
  const auth = await epicAuthFor(userId);
  const [items, playtime] = await Promise.all([
    libraryItems(auth),
    epicGet(auth, `${LIBRARY}/playtime/account/${encodeURIComponent(auth.accountId)}/all`).catch(() => []),
  ]);
  // totalTime is in seconds, per app (artifactId = the library item's appName).
  const seconds = new Map(
    (Array.isArray(playtime) ? playtime : []).map((p) => [p.artifactId, Number(p.totalTime) || 0]),
  );
  // Unreal Engine assets and private sandboxes (test builds) aren't games you own.
  const own = items.filter((i) => i.namespace !== 'ue' && i.sandboxType !== 'PRIVATE' && i.catalogItemId);
  const infos = await mapLimit(own, 8, (i) => catalogItem(auth, i.namespace, i.catalogItemId));

  const games = new Map(); // one entry per namespace: a game's editions share it
  own.forEach((item, i) => {
    const info = infos[i];
    if (!info?.title || info.dlc) return;
    const minutes = Math.round((seconds.get(item.appName) ?? 0) / 60);
    const prev = games.get(item.namespace);
    if (prev) {
      prev.minutes += minutes;
      return;
    }
    games.set(item.namespace, {
      externalId: item.namespace,
      name: info.title,
      minutes,
      lastPlayed: null,
      // Epic sends no dates: the app dates hours that grew since its previous sync.
      recentMinutes: minutes || undefined,
      imageUrl: info.imageUrl,
      isApp: info.app,
    });
  });

  // Achievements for the most played games, remembered until play time changes.
  const played = [...games.values()].filter((g) => g.minutes > 0 && !g.isApp).sort((a, b) => b.minutes - a.minutes);
  let asked = 0;
  for (const g of played) {
    const key = `${userId}:${g.externalId}`;
    const hit = await achievementUser.get(key);
    if (hit && hit.minutes === g.minutes) {
      if (hit.counts) g.achievements = hit.counts;
      continue;
    }
    if (asked >= MAX_ACHIEVEMENT_GAMES) {
      if (hit?.counts) g.achievements = hit.counts;
      continue;
    }
    asked++;
    try {
      const counts = await achievementCounts(auth, g.externalId);
      await achievementUser.set(key, { minutes: g.minutes, counts });
      if (counts) g.achievements = counts;
    } catch {
      if (hit?.counts) g.achievements = hit.counts;
    }
  }
  return [...games.values()];
}

/** Keeps the connection alive between visits (the daily cron calls this for every Epic account). */
export async function refreshEpicLogin(userId) {
  sessions.delete(userId);
  await epicAuthFor(userId);
}

export const epicRouter = express.Router();

epicRouter.post('/api/epic/connect', express.json({ limit: '20kb' }), async (req, res) => {
  const code = findEpicCode(req.body?.code);
  if (!code) {
    return res
      .status(400)
      .json({ error: 'No code in what was pasted. Copy the whole page Epic shows after you sign in.' });
  }
  const j = await tokenRequest({ grant_type: 'authorization_code', code }).catch((err) => ({ error: err.message }));
  if (j.error) {
    return res.status(400).json({
      error: 'Epic didn’t accept that code. Codes work once and only for a few minutes: get a new one and try again.',
    });
  }
  try {
    await keep(req.userId, j);
    res.json({ account: j.displayName ?? null });
  } catch (err) {
    console.error('Connect Epic:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

epicRouter.delete('/api/epic/connect', async (req, res) => {
  try {
    sessions.delete(req.userId);
    await removeLogin(req.userId, 'epic');
    res.status(204).end();
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

const sendError = (res, err, what) =>
  res
    .status(err instanceof NotConnected ? 409 : (err.status ?? 502))
    .json({ error: err instanceof NotConnected || err instanceof EpicError ? err.message : `${what}: ${err.message}` });

epicRouter.get('/api/epic/library', async (req, res) => {
  try {
    res.json({ games: await epicLibrary(req.userId) });
  } catch (err) {
    sendError(res, err, 'Epic import failed');
  }
});

epicRouter.get('/api/epic/achievements', async (req, res) => {
  const ref = String(req.query.ref ?? '');
  if (!/^[\w-]{1,80}$/.test(ref)) return res.status(400).json({ error: 'Which game?' });
  try {
    res.json({ items: await epicAchievementItems(req.userId, ref) });
  } catch (err) {
    sendError(res, err, 'Epic achievements failed');
  }
});
