// Each account connects its own PlayStation and Xbox in Settings, Platforms;
// there are no server-wide platform keys.
//
// PlayStation: the user pastes the NPSSO token from Sony's site once. It's
// exchanged straight away for PSN tokens and only the refresh token is kept
// (Sony lets it live about two months; then the user connects again).
// Xbox: the user's own OpenXBL key (xbl.io, signed in with their Microsoft
// account), which only reads their own Xbox account.
//
// Both are stored encrypted (AES-256-GCM) with a key derived from
// SESSION_SECRET. Changing SESSION_SECRET means connecting them again.
import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  exchangeRefreshTokenForAuthTokens,
  getProfileFromAccountId,
} from 'psn-api';
import { getSecret } from './auth.mjs';
import { query } from './db.mjs';
import { xboxAccount } from './xbox.mjs';

// ---------------------------------------------------------------- encryption

let cipherKey = null;
async function key() {
  cipherKey ??= Buffer.from(hkdfSync('sha256', await getSecret(), 'savepoint', 'platform-logins', 32));
  return cipherKey;
}

async function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await key(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((x) => (typeof x === 'string' ? x : x.toString('base64url')))
    .join('.');
}

async function decrypt(stored) {
  const [version, iv, tag, data] = String(stored).split('.');
  if (version !== 'v1') throw new Error('Unknown format');
  const decipher = createDecipheriv('aes-256-gcm', await key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------- storage

async function load(userId, platform) {
  const { rows } = await query(
    'SELECT "secret", "account_name", "expires_at" FROM platform_logins WHERE "user_id" = $1 AND "platform" = $2',
    [userId, platform],
  );
  if (!rows[0]) return null;
  try {
    return { secret: await decrypt(rows[0].secret), account: rows[0].account_name, expiresAt: rows[0].expires_at };
  } catch {
    return null; // Encrypted with an older SESSION_SECRET: connect again.
  }
}

async function save(userId, platform, secret, account, expiresAt = null) {
  await query(
    `INSERT INTO platform_logins ("user_id", "platform", "secret", "account_name", "expires_at", "updated_at")
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT ("user_id", "platform") DO UPDATE SET "secret" = EXCLUDED."secret",
       "account_name" = COALESCE(EXCLUDED."account_name", platform_logins."account_name"),
       "expires_at" = EXCLUDED."expires_at", "updated_at" = now()`,
    [userId, platform, await encrypt(secret), account, expiresAt],
  );
}

async function remove(userId, platform) {
  await query('DELETE FROM platform_logins WHERE "user_id" = $1 AND "platform" = $2', [userId, platform]);
}

/** { playstation: { account, expiresAt } | null, xbox: { account } | null } for Settings. */
export async function platformLogins(userId) {
  const { rows } = await query(
    'SELECT "platform", "account_name", "expires_at" FROM platform_logins WHERE "user_id" = $1',
    [userId],
  );
  const by = Object.fromEntries(rows.map((r) => [r.platform, r]));
  return {
    playstation: by.playstation ? { account: by.playstation.account_name, expiresAt: by.playstation.expires_at } : null,
    xbox: by.xbox ? { account: by.xbox.account_name } : null,
  };
}

// ---------------------------------------------------------------- PlayStation

export class NotConnected extends Error {}

const psnSessions = new Map(); // userId -> { accessToken, expiresAt }

/** PSN tokens for the user's own PlayStation account. Throws NotConnected. */
export async function psnAuthFor(userId) {
  const cached = psnSessions.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  const stored = await load(userId, 'playstation');
  if (!stored) throw new NotConnected('Connect PlayStation first (Settings, Platforms).');
  let tokens;
  try {
    tokens = await exchangeRefreshTokenForAuthTokens(stored.secret);
  } catch {
    throw new NotConnected(
      'Your PlayStation connection has expired. Disconnect it and connect again with a new token.',
    );
  }
  // Sony may hand out a new refresh token; keep the newest.
  if (tokens.refreshToken && tokens.refreshToken !== stored.secret) {
    await save(
      userId,
      'playstation',
      tokens.refreshToken,
      null,
      new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000),
    );
  }
  const auth = { accessToken: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 };
  psnSessions.set(userId, auth);
  return auth;
}

/** Forget a cached PSN session (after an error), so the next call signs in again. */
export const resetPsnSession = (userId) => psnSessions.delete(userId);

// ---------------------------------------------------------------- Xbox

/** The user's own OpenXBL key. Throws NotConnected. */
export async function xboxKeyFor(userId) {
  const stored = await load(userId, 'xbox');
  if (!stored) throw new NotConnected('Connect Xbox first (Settings, Platforms).');
  return stored.secret;
}

// ---------------------------------------------------------------- per-request context

// Code deep inside a request (the PlayStation Store part of game search) asks
// for "the PSN sign-in of whoever is searching" without it being passed down.
const context = new AsyncLocalStorage();

/** Middleware (after requireLogin): makes the logged-in user available to currentPsnAuth(). */
export function platformContext(req, _res, next) {
  context.run({ userId: req.userId }, next);
}

/** PSN tokens of the user making this request, or null when they haven't connected PlayStation. */
export async function currentPsnAuth() {
  const userId = context.getStore()?.userId;
  if (!userId) return null;
  try {
    return await psnAuthFor(userId);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- routes

export const platformLoginRouter = express.Router();

// Body: { npsso } -> { account }
platformLoginRouter.post('/api/psn/connect', express.json({ limit: '10kb' }), async (req, res) => {
  const npsso = typeof req.body?.npsso === 'string' ? req.body.npsso.trim() : '';
  // People often paste the whole {"npsso":"…"} answer; take the value out of it.
  const token = /"npsso"\s*:\s*"([^"]+)"/.exec(npsso)?.[1] ?? npsso;
  if (!/^[\w-]{20,200}$/.test(token)) {
    return res.status(400).json({ error: 'That doesn’t look like an NPSSO token. Copy the value after "npsso".' });
  }
  let tokens;
  try {
    tokens = await exchangeAccessCodeForAuthTokens(await exchangeNpssoForAccessCode(token));
  } catch {
    return res.status(400).json({ error: 'Sony didn’t accept that token. Get a fresh one and try again.' });
  }
  let account = null;
  try {
    account = (await getProfileFromAccountId({ accessToken: tokens.accessToken }, 'me')).onlineId ?? null;
  } catch {
    // The name is only shown in Settings; connecting works without it.
  }
  try {
    const expiresAt = new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000);
    await save(req.userId, 'playstation', tokens.refreshToken, account, expiresAt);
    psnSessions.set(req.userId, { accessToken: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 });
    res.json({ account });
  } catch (err) {
    console.error('Connect PlayStation:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

// Body: { key } -> { account }
platformLoginRouter.post('/api/xbox/connect', express.json({ limit: '10kb' }), async (req, res) => {
  const apiKey = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!/^[\w-]{10,200}$/.test(apiKey)) return res.status(400).json({ error: 'Paste your OpenXBL API key.' });
  let account;
  try {
    account = await xboxAccount(apiKey);
  } catch (err) {
    const refused = /refused/.test(err.message);
    return res.status(400).json({
      error: refused ? "OpenXBL didn't accept that key. Check it on xbl.io and try again." : err.message,
    });
  }
  try {
    await save(req.userId, 'xbox', apiKey, account);
    res.json({ account });
  } catch (err) {
    console.error('Connect Xbox:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

for (const platform of ['playstation', 'xbox']) {
  const route = platform === 'playstation' ? '/api/psn/connect' : '/api/xbox/connect';
  platformLoginRouter.delete(route, async (req, res) => {
    try {
      await remove(req.userId, platform);
      if (platform === 'playstation') psnSessions.delete(req.userId);
      res.status(204).end();
    } catch (err) {
      console.error('Disconnect:', err);
      res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
    }
  });
}
