// Nintendo Switch play time, unofficially, through the Nintendo Switch
// Parental Controls app's service (as the open-source pynintendoparental
// library does). Nintendo keeps lifetime play time on the console only; this
// service reports minutes played per game per day, for the consoles linked to
// the Parental Controls app. So Savepoint logs play time from the day you
// connect: each sync stores the days it sees (from the connect day on), and a
// game's hours are the sum of those days.
//
// Signing in: Savepoint makes a Nintendo sign-in link (with a PKCE secret kept
// encrypted until it's used). After signing in, Nintendo shows "Select this
// person"; the user copies that button's link (npf54789befb391a838://auth#…)
// and pastes it here. The resulting session token (long-lived) is kept
// encrypted in platform_logins; the days are kept in game_connections.
//
//   GET    /api/nintendo/login          -> { url }
//   POST   /api/nintendo/connect        { link, timeZone } -> { account }
//   DELETE /api/nintendo/connect
//   GET    /api/nintendo/library        -> { games, players: [{ id, name, selected }], since }
//   GET    /api/nintendo/players        -> { players, since } (no sync)
//   POST   /api/nintendo/players        { selected: [player ids] | null }
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { query } from './db.mjs';
import { loadLogin, NotConnected, removeLogin, saveLogin } from './platformLogins.mjs';

const CLIENT_ID = '54789befb391a838';
const REDIRECT = `npf${CLIENT_ID}://auth`;
const SCOPES = [
  'openid',
  'user',
  'moonUser:administration',
  'moonDevice:create',
  'moonOwnedDevice:administration',
  'moonParentalControlSetting',
  'moonParentalControlSetting:update',
  'moonParentalControlSettingState',
  'moonPairingState',
  'moonSmartDevice:administration',
  'moonDailySummary',
  'moonMonthlySummary',
];
const ACCOUNTS = 'https://accounts.nintendo.com/connect/1.0.0';
const BASE = 'https://app.lp1.znma.srv.nintendo.net';
// The Parental Controls app these requests present themselves as; Nintendo
// refuses ("update_required") app versions it no longer supports.
const APP = { pkg: 'com.nintendo.znma', version: '2.6.0', build: '700', os: 'ANDROID', osVersion: '34' };
const UA = `moon_ANDROID/${APP.version} (${APP.pkg}; build:${APP.build}; ${APP.os} ${APP.osVersion})`;

export class NintendoError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const b64url = (buf) => buf.toString('base64url');

/** The session_token_code in the pasted "Select this person" link. */
export function findNintendoCode(text) {
  return /session_token_code=([\w.-]+)/.exec(String(text ?? ''))?.[1] ?? null;
}

const localDay = (date, timeZone) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      date,
    );
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

async function postForm(url, body, json = false) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': UA,
      },
      body: json ? JSON.stringify(body) : new URLSearchParams(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new NintendoError("Couldn't reach Nintendo. Try again in a moment.");
  }
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const sessions = new Map(); // userId -> { idToken, accessToken, expiresAt }

async function tokensFrom(sessionToken) {
  const { status, body } = await postForm(
    `${ACCOUNTS}/api/token`,
    {
      client_id: CLIENT_ID,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer-session-token',
      session_token: sessionToken,
    },
    true,
  );
  if (status >= 500) throw new NintendoError("Nintendo isn't answering. Try again later.");
  if (status !== 200 || !body.id_token) {
    throw new NotConnected('Your Nintendo connection has expired. Disconnect it and connect again.');
  }
  return {
    idToken: body.id_token,
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 900) * 1000,
  };
}

async function authFor(userId) {
  const cached = sessions.get(userId);
  if (cached && cached.expiresAt > Date.now() + 5 * 60_000) return cached;
  const stored = await loadLogin(userId, 'nintendo');
  if (!stored) throw new NotConnected('Connect Nintendo first (Platforms page).');
  const auth = await tokensFrom(stored.secret);
  sessions.set(userId, auth);
  return auth;
}

async function moon(auth, path, timeZone) {
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      headers: {
        'User-Agent': UA,
        'X-Moon-App-Id': APP.pkg,
        'X-Moon-Os': APP.os,
        'X-Moon-Os-Version': APP.osVersion,
        'X-Moon-Model': 'Pixel 4 XL',
        'X-Moon-App-Display-Version': APP.version,
        'X-Moon-App-Internal-Version': APP.build,
        'X-Moon-TimeZone': timeZone,
        'X-Moon-Os-Language': 'en-US',
        'X-Moon-App-Language': 'en-US',
        Authorization: `Bearer ${auth.idToken}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new NintendoError("Couldn't reach Nintendo. Try again in a moment.");
  }
  if (r.status === 401)
    throw new NotConnected('Your Nintendo connection has expired. Disconnect it and connect again.');
  const body = await r.json().catch(() => ({}));
  if (body?.errorCode === 'update_required') {
    throw new NintendoError('Nintendo changed its Parental Controls service; Savepoint needs an update to read it.');
  }
  if (!r.ok) throw new NintendoError(`Nintendo answered ${r.status}`);
  return body;
}

// ---------------------------------------------------------------- stored days

async function loadData(userId) {
  const { rows } = await query('SELECT "data" FROM game_connections WHERE "user_id" = $1 AND "game" = \'nintendo\'', [
    userId,
  ]);
  return rows[0]?.data ?? null;
}

async function saveData(userId, data) {
  await query(
    `INSERT INTO game_connections ("user_id", "game", "external_id", "name", "data", "fetched_at")
     VALUES ($1, 'nintendo', $2, $3, $4, now())
     ON CONFLICT ("user_id", "game") DO UPDATE SET "data" = EXCLUDED."data", "fetched_at" = now()`,
    [userId, data.accountId ?? 'nintendo', data.account ?? null, JSON.stringify(data)],
  );
}

/** Reads the consoles' daily summaries and stores every day since the connect day. */
export async function syncNintendo(userId) {
  const data = await loadData(userId);
  if (!data) throw new NotConnected('Connect Nintendo first (Platforms page).');
  const auth = await authFor(userId);
  const tz = data.timeZone || 'UTC';
  const owned = await moon(auth, '/v2/actions/user/fetchOwnedDevices', tz);
  const devices = owned?.ownedDevices ?? [];
  data.players ??= {};
  data.titles ??= {};
  data.days ??= {};
  for (const device of devices) {
    const j = await moon(
      auth,
      `/v2/actions/playSummary/fetchDailySummaries?deviceId=${encodeURIComponent(device.deviceId)}`,
      tz,
    );
    for (const day of j?.dailySummaries ?? []) {
      if (!day?.date || day.date < data.since) continue;
      const titlesToday = new Map((day.playedApps ?? []).map((a) => [a.applicationId, a]));
      const byPlayer = {};
      for (const p of day.players ?? []) {
        const id = p.profile?.playerId;
        if (!id) continue;
        data.players[id] = p.profile.nickname || data.players[id] || 'Player';
        const apps = {};
        for (const g of p.playedGames ?? []) {
          const appId = g.meta?.applicationId ?? g.applicationId;
          // playingTime is in minutes.
          const minutes = Number(g.playingTime) || 0;
          if (!appId || !minutes) continue;
          apps[appId] = (apps[appId] ?? 0) + minutes;
          const meta = { ...titlesToday.get(appId), ...g.meta };
          if (meta.title) {
            data.titles[appId] = {
              title: meta.title,
              image:
                meta.imageUri?.large ??
                meta.imageUri?.small ??
                (typeof meta.imageUri === 'string' ? meta.imageUri : undefined),
            };
          }
        }
        if (Object.keys(apps).length) byPlayer[id] = apps;
      }
      // A day's totals grow until it's over, so the newest reading replaces the old one.
      const key = `${device.deviceId}|${day.date}`;
      if (Object.keys(byPlayer).length) data.days[key] = byPlayer;
    }
  }
  data.syncedAt = new Date().toISOString();
  await saveData(userId, data);
  return data;
}

function libraryFrom(data) {
  const selected = data.selected?.length ? new Set(data.selected) : null;
  const totals = new Map(); // appId -> { minutes, last }
  for (const [key, byPlayer] of Object.entries(data.days ?? {})) {
    const date = key.slice(key.indexOf('|') + 1);
    for (const [playerId, apps] of Object.entries(byPlayer)) {
      if (selected && !selected.has(playerId)) continue;
      for (const [appId, minutes] of Object.entries(apps)) {
        const t = totals.get(appId) ?? { minutes: 0, last: '' };
        t.minutes += minutes;
        if (date > t.last) t.last = date;
        totals.set(appId, t);
      }
    }
  }
  return [...totals]
    .filter(([appId]) => data.titles?.[appId]?.title)
    .map(([appId, t]) => ({
      externalId: appId,
      name: data.titles[appId].title,
      minutes: t.minutes,
      lastPlayed: t.last ? `${t.last}T12:00:00.000Z` : null,
      imageUrl: data.titles[appId].image,
    }));
}

const playersOf = (data) =>
  Object.entries(data.players ?? {}).map(([id, name]) => ({
    id,
    name,
    selected: !data.selected?.length || data.selected.includes(id),
  }));

// ---------------------------------------------------------------- routes

export const nintendoRouter = express.Router();

nintendoRouter.get('/api/nintendo/login', async (req, res) => {
  const verifier = b64url(randomBytes(36));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'session_token_code',
    scope: SCOPES.join(' '),
    session_token_code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    session_token_code_challenge_method: 'S256',
    state: b64url(randomBytes(24)),
    theme: 'login_form',
  });
  try {
    // Kept until the pasted link comes back.
    await saveLogin(req.userId, 'nintendo-pending', verifier, null, new Date(Date.now() + 30 * 60_000));
    res.json({ url: `${ACCOUNTS}/authorize?${params.toString().replace(/%2B/g, '+')}` });
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

nintendoRouter.post('/api/nintendo/connect', express.json({ limit: '20kb' }), async (req, res) => {
  const code = findNintendoCode(req.body?.link);
  if (!code) {
    return res
      .status(400)
      .json({ error: 'No sign-in in what was pasted. Copy the link of the "Select this person" button.' });
  }
  const pending = await loadLogin(req.userId, 'nintendo-pending').catch(() => null);
  if (!pending || (pending.expiresAt && new Date(pending.expiresAt) < new Date())) {
    return res.status(400).json({ error: 'That sign-in link is too old. Start again with "Sign in to Nintendo".' });
  }
  try {
    const st = await postForm(`${ACCOUNTS}/api/session_token`, {
      client_id: CLIENT_ID,
      session_token_code: code,
      session_token_code_verifier: pending.secret,
    });
    if (st.status !== 200 || !st.body.session_token) {
      return res
        .status(400)
        .json({ error: 'Nintendo didn’t accept that link. Sign in again and copy the new "Select this person" link.' });
    }
    const auth = await tokensFrom(st.body.session_token);
    const me = await fetch('https://api.accounts.nintendo.com/2.0.0/users/me', {
      headers: { Authorization: `Bearer ${auth.accessToken}`, 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    const account = me.nickname ?? me.screenName ?? null;
    const timeZone =
      typeof req.body?.timeZone === 'string' && req.body.timeZone.length < 60 ? req.body.timeZone : 'UTC';
    await saveLogin(req.userId, 'nintendo', st.body.session_token, account);
    await removeLogin(req.userId, 'nintendo-pending');
    sessions.set(req.userId, auth);
    const prev = await loadData(req.userId);
    // Logging starts today; reconnecting keeps the days already logged.
    await saveData(req.userId, {
      ...prev,
      accountId: me.id ?? prev?.accountId,
      account,
      timeZone,
      since: prev?.since ?? localDay(new Date(), timeZone),
    });
    res.json({ account });
  } catch (err) {
    res.status(err.status ?? 502).json({ error: err.message });
  }
});

nintendoRouter.delete('/api/nintendo/connect', async (req, res) => {
  try {
    sessions.delete(req.userId);
    await removeLogin(req.userId, 'nintendo');
    await query('DELETE FROM game_connections WHERE "user_id" = $1 AND "game" = \'nintendo\'', [req.userId]);
    res.status(204).end();
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

nintendoRouter.get('/api/nintendo/library', async (req, res) => {
  try {
    const data = await syncNintendo(req.userId);
    res.json({ games: libraryFrom(data), players: playersOf(data), since: data.since });
  } catch (err) {
    res.status(err instanceof NotConnected ? 409 : (err.status ?? 502)).json({ error: err.message });
  }
});

// What's stored, without syncing: the players and the day logging started.
nintendoRouter.get('/api/nintendo/players', async (req, res) => {
  try {
    const data = await loadData(req.userId);
    if (!data) return res.status(409).json({ error: 'Connect Nintendo first.' });
    res.json({ players: playersOf(data), since: data.since });
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

nintendoRouter.post('/api/nintendo/players', express.json({ limit: '5kb' }), async (req, res) => {
  const selected = Array.isArray(req.body?.selected) ? req.body.selected.map(String).slice(0, 16) : null;
  try {
    const data = await loadData(req.userId);
    if (!data) return res.status(409).json({ error: 'Connect Nintendo first.' });
    data.selected = selected;
    await saveData(req.userId, data);
    res.json({ games: libraryFrom(data), players: playersOf(data), since: data.since });
  } catch {
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});
