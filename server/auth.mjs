// Login: Savepoint's own accounts, a username and a password, in the users
// table. Accounts are created with `npm run setup-account` (there's no sign-up
// page yet). The owner account (is_owner) can use the features tied to the
// owner's own accounts: their PlayStation and Xbox, and price alerts to their phone.
//
// A successful login sets a signed, HttpOnly cookie with the user's id; every
// other /api route requires it. It lasts 30 days.
//
// .env:
//   DATABASE_URL    the database (see server/db.mjs)
//   SESSION_SECRET  optional locally (generated into data/session-secret); required on Vercel
import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.mjs';
import { diskCache } from './diskCache.mjs';
import { hashPassword, passwordProblem, verifyAgainstNothing, verifyPassword } from './passwords.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(ROOT, process.env.SAVEPOINT_DATA_DIR?.trim() || 'data');

const COOKIE = 'sp_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const GENERIC_FAIL = 'Wrong username or password.';

// After this many wrong passwords for one username (or from one address),
// logins are refused for a while.
const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const failures = diskCache('login-failures', LOCKOUT_MS);

let secret = null;
async function getSecret() {
  if (secret) return secret;
  if (process.env.SESSION_SECRET?.trim()) return (secret = process.env.SESSION_SECRET.trim());
  // No lasting disk on Vercel: a generated secret would log you out on every new instance.
  if (process.env.VERCEL) throw new Error('SESSION_SECRET is not set in the Vercel project settings.');
  const file = path.join(dataDir, 'session-secret');
  try {
    secret = (await readFile(file, 'utf8')).trim();
  } catch {
    secret = randomBytes(32).toString('hex');
    await mkdir(dataDir, { recursive: true });
    await writeFile(file, secret, { mode: 0o600 });
  }
  return secret;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data, key) => createHmac('sha256', key).update(data).digest('base64url');

async function makeSession(user) {
  const exp = Date.now() + SESSION_MS;
  const data = b64(JSON.stringify({ id: user.id, u: user.username, o: user.is_owner, exp }));
  return `${data}.${sign(data, await getSecret())}`;
}

/** The session from the cookie, or null. Sessions from the VerBuddy login (no id) no longer count. */
async function readSession(req) {
  const raw = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [data, mac] = raw.split('.');
  if (!data || !mac) return null;
  const expected = Buffer.from(sign(data, await getSecret()));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(data, 'base64url').toString());
    return s.exp > Date.now() && Number.isInteger(s.id) ? s : null;
  } catch {
    return null;
  }
}

function setCookie(req, res, value, maxAgeMs) {
  const https = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append(
    'Set-Cookie',
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${https ? '; Secure' : ''}`,
  );
}

const clientAddress = (req) =>
  String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '')
    .split(',')[0]
    .trim();

async function lockedOut(keys) {
  for (const key of keys) if (((await failures.get(key)) ?? 0) >= MAX_FAILURES) return true;
  return false;
}

async function countFailure(keys) {
  for (const key of keys) await failures.set(key, ((await failures.get(key)) ?? 0) + 1);
}

export const authRouter = express.Router();

authRouter.post('/api/login', express.json({ limit: '10kb' }), async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }
  const name = username.trim();
  const keys = [`user:${name.toLowerCase()}`, `ip:${clientAddress(req)}`];
  try {
    if (await lockedOut(keys)) {
      return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
    }
    const { rows } = await query(
      'SELECT "id", "username", "password_hash", "is_owner" FROM users WHERE lower("username") = lower($1)',
      [name],
    );
    const user = rows[0];
    const ok = user?.password_hash
      ? await verifyPassword(password, user.password_hash)
      : await verifyAgainstNothing(password);
    if (!ok) {
      await countFailure(keys);
      return res.status(401).json({ error: GENERIC_FAIL });
    }
    setCookie(req, res, await makeSession(user), SESSION_MS);
    res.json({ user: user.username, owner: user.is_owner });
  } catch (err) {
    console.error('Login:', err);
    res.status(502).json({ error: "Couldn't reach the database to check your login. Try again in a moment." });
  }
});

authRouter.post('/api/logout', (req, res) => {
  setCookie(req, res, '', 0);
  res.status(204).end();
});

authRouter.get('/api/session', async (req, res) => {
  const s = await readSession(req);
  if (!s) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: s.u, owner: !!s.o });
});

/** Every other /api route needs a valid session. */
export async function requireLogin(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const s = await readSession(req);
  if (!s) return res.status(401).json({ error: 'Not logged in.' });
  req.userId = s.id;
  req.username = s.u;
  req.isOwner = !!s.o;
  next();
}

/** For things that use the owner's own accounts: their PlayStation and Xbox, alerts to their phone. */
export function ownerOnly(req, res, next) {
  if (req.isOwner) return next();
  res.status(403).json({ error: "This uses the owner's own account, so it's only available to them." });
}

/** Routes for the logged-in user's own account (mounted after requireLogin). */
export const accountRouter = express.Router();

accountRouter.post('/api/account/password', express.json({ limit: '10kb' }), async (req, res) => {
  const { current, next } = req.body ?? {};
  if (typeof current !== 'string' || !current) return res.status(400).json({ error: 'Enter your current password.' });
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  const keys = [`user:${req.username.toLowerCase()}`];
  try {
    if (await lockedOut(keys)) {
      return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
    }
    const { rows } = await query('SELECT "password_hash" FROM users WHERE "id" = $1', [req.userId]);
    if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
      await countFailure(keys);
      return res.status(400).json({ error: 'Your current password is wrong.' });
    }
    await query('UPDATE users SET "password_hash" = $2 WHERE "id" = $1', [req.userId, await hashPassword(next)]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Change password:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});
