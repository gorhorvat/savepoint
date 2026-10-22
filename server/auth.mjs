// Login: you sign in with your VerBuddy username and password. Savepoint asks
// VerBuddy's API whether they're right, and only VerBuddy's SuperAdmin account
// is let in (students and teachers aren't). VerBuddy's login token goes into a
// signed, HttpOnly cookie: every other /api route requires it, and the server
// uses the token to load and save your data in VerBuddy. The login lasts as
// long as VerBuddy's token (8 hours by default).
//
// .env:
//   VERBUDDY_API_URL  VerBuddy's backend, e.g. https://verbuddy-api.azurewebsites.net
//   SESSION_SECRET    optional locally (generated into data/session-secret); required on Vercel
import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir, verbuddyUrl } from './state.mjs';

const COOKIE = 'sp_session';
const GENERIC_FAIL = 'Wrong username or password.';

const ALLOWED_ROLE = 'SuperAdmin';

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

async function makeSession(user, token, exp) {
  const data = b64(JSON.stringify({ u: user, t: token, exp }));
  return `${data}.${sign(data, await getSecret())}`;
}

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
    return s.exp > Date.now() ? s : null;
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

/** Username and roles from VerBuddy's token. */
function readToken(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    const role = p.role ?? p['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ?? [];
    return { user: String(p.unique_name ?? ''), roles: [role].flat().map(String), exp: Number(p.exp) * 1000 };
  } catch {
    return { user: '', roles: [], exp: 0 };
  }
}

export const authRouter = express.Router();

authRouter.post('/api/login', express.json({ limit: '10kb' }), async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!verbuddyUrl()) {
    return res.status(500).json({ error: 'Login is not set up: add VERBUDDY_API_URL to .env.' });
  }
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }
  let r;
  try {
    r = await fetch(`${verbuddyUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
      signal: AbortSignal.timeout(60_000), // VerBuddy may need a while to wake up.
    });
  } catch {
    return res.status(502).json({ error: "Couldn't reach VerBuddy to check your login. Try again in a moment." });
  }
  if (r.status === 401 || r.status === 400) return res.status(401).json({ error: GENERIC_FAIL });
  if (!r.ok) return res.status(502).json({ error: `VerBuddy answered with an error (${r.status}). Try again.` });

  const { token } = await r.json().catch(() => ({}));
  // The token came straight from VerBuddy over HTTPS; only the SuperAdmin gets in.
  const { user, roles, exp } = token ? readToken(token) : { user: '', roles: [], exp: 0 };
  if (!roles.includes(ALLOWED_ROLE)) {
    return res.status(403).json({ error: 'This VerBuddy account has no access to Savepoint.' });
  }

  const expires = exp > Date.now() ? exp : Date.now() + 8 * 60 * 60 * 1000;
  setCookie(req, res, await makeSession(user, token, expires), expires - Date.now());
  res.json({ user });
});

authRouter.post('/api/logout', (req, res) => {
  setCookie(req, res, '', 0);
  res.status(204).end();
});

authRouter.get('/api/session', async (req, res) => {
  const s = await readSession(req);
  if (!s) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ user: s.u });
});

/** Every other /api route needs a valid session; it carries the VerBuddy token on. */
export async function requireLogin(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const s = await readSession(req);
  if (!s?.t) return res.status(401).json({ error: 'Not logged in.' });
  req.verbuddyToken = s.t;
  next();
}
