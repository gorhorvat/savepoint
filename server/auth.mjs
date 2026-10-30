// Login: Savepoint's own accounts, in the users table. An account logs in with
// a username and password, through Steam (server/steamLogin.mjs), or both.
// People with the invite code can create an account from the login screen;
// the super admin sets or changes that code in Profile.
// `npm run setup-account` creates accounts and resets passwords from the
// command line. The super admin also manages the invite code.
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
import {
  createAccount,
  getInviteCode,
  inviteCodeProblem,
  randomInviteCode,
  ROLES,
  setInviteCode,
  tidyUsername,
  usernameProblem,
  UsernameTaken,
} from './accounts.mjs';
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
export async function getSecret() {
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

/** A signed cookie value holding `value` (an object with an exp time). */
export async function signValue(value) {
  const data = b64(JSON.stringify(value));
  return `${data}.${sign(data, await getSecret())}`;
}

/** The signed cookie `name`, or null when it's missing, tampered with or expired. */
export async function readSigned(req, name) {
  const raw = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!raw) return null;
  const [data, mac] = raw.split('.');
  if (!data || !mac) return null;
  const expected = Buffer.from(sign(data, await getSecret()));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const value = JSON.parse(Buffer.from(data, 'base64url').toString());
    return value.exp > Date.now() ? value : null;
  } catch {
    return null;
  }
}

/** The login session, or null. */
export async function readSession(req) {
  const s = await readSigned(req, COOKIE);
  return s && Number.isInteger(s.id) ? s : null;
}

export function setCookie(req, res, name, value, maxAgeMs) {
  const https = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append(
    'Set-Cookie',
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${https ? '; Secure' : ''}`,
  );
}

/**
 * Logs `user` ({ id, username, role, session_version? }) in on this browser.
 * The session version is bumped when a password is reset, which logs every
 * other session out.
 */
export async function setSessionCookie(req, res, user) {
  const value = await signValue({
    id: user.id,
    u: user.username,
    r: user.role,
    sv: user.session_version ?? 0,
    exp: Date.now() + SESSION_MS,
  });
  setCookie(req, res, COOKIE, value, SESSION_MS);
}

export const clearSessionCookie = (req, res) => setCookie(req, res, COOKIE, '', 0);

export const DISABLED = 'This account is disabled. Ask the Savepoint admin.';

// What a session is checked against on each request: whether the account still
// exists, is enabled, and the session isn't from before a password reset. Kept
// for 30 seconds per instance, so a disabled account is locked out within that.
const accountStates = new Map();

async function accountState(id) {
  const hit = accountStates.get(id);
  if (hit && hit.at > Date.now() - 30_000) return hit.row;
  const { rows } = await query(
    'SELECT "role", "disabled_at", "session_version", "last_seen_at" FROM users WHERE "id" = $1',
    [id],
  );
  const row = rows[0] ?? null;
  accountStates.set(id, { at: Date.now(), row });
  // Last seen, at most once a minute per account: friends see you as online on
  // Savepoint for a few minutes after it (server/presence.mjs).
  if (row && (!row.last_seen_at || Date.now() - new Date(row.last_seen_at).getTime() > 60_000)) {
    row.last_seen_at = new Date().toISOString();
    void query('UPDATE users SET "last_seen_at" = now() WHERE "id" = $1', [id]).catch(() => {});
  }
  return row;
}

/** After the admin changes an account, this instance checks it again at once. */
export const forgetAccountState = (id) => accountStates.delete(id);

export const clientAddress = (req) =>
  String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '')
    .split(',')[0]
    .trim();

export async function lockedOut(keys) {
  for (const key of keys) if (((await failures.get(key)) ?? 0) >= MAX_FAILURES) return true;
  return false;
}

export async function countFailure(keys) {
  for (const key of keys) await failures.set(key, ((await failures.get(key)) ?? 0) + 1);
}

export const authRouter = express.Router();

authRouter.post('/api/login', express.json({ limit: '10kb' }), async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }
  const name = tidyUsername(username);
  const keys = [`user:${name.toLowerCase()}`, `ip:${clientAddress(req)}`];
  try {
    if (await lockedOut(keys)) {
      return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
    }
    const { rows } = await query(
      `SELECT "id", "username", "password_hash", "role", "disabled_at", "session_version"
       FROM users WHERE lower("username") = lower($1)`,
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
    if (user.disabled_at) return res.status(403).json({ error: DISABLED });
    await setSessionCookie(req, res, user);
    res.json({ id: user.id, user: user.username, superAdmin: user.role === ROLES.superAdmin });
  } catch (err) {
    console.error('Login:', err);
    res.status(502).json({ error: "Couldn't reach the database to check your login. Try again in a moment." });
  }
});

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 'ok', 'wrong' or 'closed' (no invite code set). Case, spaces and dashes don't matter. */
export async function checkInviteCode(code) {
  const invite = await getInviteCode();
  if (!invite) return 'closed';
  const tidy = (c) => c.replace(/[\s\-\u2010-\u2015]+/g, '').toUpperCase();
  return typeof code === 'string' && sameText(tidy(code), tidy(invite)) ? 'ok' : 'wrong';
}

// Whether the login screen should offer "Create an account".
authRouter.get('/api/signup', async (_req, res) => {
  res.json({ open: !!(await getInviteCode().catch(() => '')) });
});

authRouter.post('/api/signup', express.json({ limit: '10kb' }), async (req, res) => {
  const { username, password, code } = req.body ?? {};
  const name = tidyUsername(username);
  const keys = [`signup:${clientAddress(req)}`];
  try {
    if (await lockedOut(keys)) {
      return res.status(429).json({ error: 'Too many wrong invite codes. Try again in 15 minutes.' });
    }
    const invite = await checkInviteCode(code);
    if (invite === 'closed') return res.status(403).json({ error: 'Sign-up is closed.' });
    if (invite === 'wrong') {
      await countFailure(keys);
      return res.status(403).json({ error: "That invite code isn't right." });
    }
    const problem = usernameProblem(name) ?? passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });
    const user = await createAccount(name, await hashPassword(password));
    await setSessionCookie(req, res, user);
    res.status(201).json({ id: user.id, user: user.username, superAdmin: false });
  } catch (err) {
    if (err instanceof UsernameTaken) return res.status(409).json({ error: err.message });
    console.error('Sign-up:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

authRouter.post('/api/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.status(204).end();
});

authRouter.get('/api/session', async (req, res) => {
  const s = await readSession(req);
  if (!s) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: s.u, superAdmin: isSuperAdmin(s) });
});

/** Every other /api route needs a valid session. */
export async function requireLogin(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const s = await readSession(req);
  if (!s) return res.status(401).json({ error: 'Not logged in.' });
  let account;
  try {
    account = await accountState(s.id);
  } catch (err) {
    console.error('Session check:', err);
    return res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
  // Deleted, disabled, or logged out everywhere by a password reset.
  if (!account || account.disabled_at || (account.session_version ?? 0) !== (s.sv ?? 0)) {
    clearSessionCookie(req, res);
    return res.status(401).json({ error: account?.disabled_at ? DISABLED : 'Not logged in.' });
  }
  req.userId = s.id;
  req.username = s.u;
  // The role as it is now, not as it was at login.
  req.isSuperAdmin = account.role === ROLES.superAdmin;
  next();
}

// Sessions from before roles carried an owner flag (o) instead.
const isSuperAdmin = (s) => s.r === ROLES.superAdmin || s.o === true;

/** Only for the super admin: the invite code. */
export function superAdminOnly(req, res, next) {
  if (req.isSuperAdmin) return next();
  res.status(403).json({ error: 'Only the super admin can use this.' });
}

/** Routes for the logged-in user's own account (mounted after requireLogin). */
export const accountRouter = express.Router();

// The account's login methods, for Profile.
accountRouter.get('/api/account', async (req, res) => {
  try {
    const { rows } = await query('SELECT "username", "password_hash", "steam_id" FROM users WHERE "id" = $1', [
      req.userId,
    ]);
    if (!rows[0]) return res.status(401).json({ error: 'Not logged in.' });
    res.json({ username: rows[0].username, hasPassword: !!rows[0].password_hash, steamId: rows[0].steam_id });
  } catch (err) {
    console.error('Account:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

// Changes the password, or sets the first one for an account made through Steam.
accountRouter.post('/api/account/password', express.json({ limit: '10kb' }), async (req, res) => {
  const { current, next } = req.body ?? {};
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  const keys = [`user:${req.username.toLowerCase()}`];
  try {
    if (await lockedOut(keys)) {
      return res.status(429).json({ error: 'Too many wrong passwords. Try again in 15 minutes.' });
    }
    const { rows } = await query('SELECT "password_hash" FROM users WHERE "id" = $1', [req.userId]);
    if (!rows[0]) return res.status(401).json({ error: 'Not logged in.' });
    if (rows[0].password_hash) {
      if (typeof current !== 'string' || !current)
        return res.status(400).json({ error: 'Enter your current password.' });
      if (!(await verifyPassword(current, rows[0].password_hash))) {
        await countFailure(keys);
        return res.status(400).json({ error: 'Your current password is wrong.' });
      }
    }
    await query('UPDATE users SET "password_hash" = $2 WHERE "id" = $1', [req.userId, await hashPassword(next)]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Change password:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

// Removes Steam as a way to log in; only with a password to log in with instead.
accountRouter.post('/api/account/steam/unlink', async (req, res) => {
  try {
    const { rowCount } = await query(
      'UPDATE users SET "steam_id" = NULL WHERE "id" = $1 AND "password_hash" IS NOT NULL',
      [req.userId],
    );
    if (!rowCount) return res.status(400).json({ error: 'Set a password first, so you can still log in.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Unlink Steam:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

// The invite code for sign-up (super admin only). Body for PUT: { code } to set
// it, { generate: true } for a new random one, or { code: '' } to close sign-up.
accountRouter.get('/api/admin/invite', superAdminOnly, async (_req, res) => {
  try {
    res.json({ code: await getInviteCode() });
  } catch (err) {
    console.error('Invite code:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

accountRouter.put('/api/admin/invite', superAdminOnly, express.json({ limit: '10kb' }), async (req, res) => {
  const { code, generate } = req.body ?? {};
  let next = '';
  if (generate) next = randomInviteCode();
  else if (code) {
    const problem = inviteCodeProblem(code);
    if (problem) return res.status(400).json({ error: problem });
    next = code.trim();
  }
  try {
    await setInviteCode(next);
    res.json({ code: next });
  } catch (err) {
    console.error('Invite code:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});
