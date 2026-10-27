// "Sign in through Steam" (Steam's OpenID 2.0). Steam's login page sends the
// browser back with a signed claim of the SteamID; Steam's server confirms the
// claim before we trust it (check_authentication), and the SteamID is the only
// thing taken from it.
//
//   GET  /api/auth/steam/start[?intent=connect]    -> Steam's login page
//   GET  /api/auth/steam/return                    <- Steam sends the browser back here
//   GET  /api/auth/steam/pending                   a Steam account that isn't linked yet
//   POST /api/auth/steam/complete { code, username }      creates an account for it
//   POST /api/auth/steam/link { username, password }      links it to an existing account
//
// A linked Steam account logs straight in. One that isn't linked goes to
// /?steam=signup, which offers both: create an account (with the invite code)
// or log in to an existing one once, which links Steam to it.
// intent=connect (Settings, Platforms, while logged in) links Steam to the
// logged-in account and goes back to /settings?steam=connected. The linked
// Steam account is also the only one whose library Savepoint imports.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { createAccount, getInviteCode, ROLES, usernameProblem, UsernameTaken } from './accounts.mjs';
import {
  checkInviteCode,
  countFailure,
  clientAddress,
  lockedOut,
  readSession,
  readSigned,
  setCookie,
  setSessionCookie,
  signValue,
} from './auth.mjs';
import { query } from './db.mjs';
import { verifyAgainstNothing, verifyPassword } from './passwords.mjs';

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const STATE_COOKIE = 'sp_steam';
const PENDING_COOKIE = 'sp_steam_new';
const STATE_MS = 10 * 60 * 1000;
const PENDING_MS = 15 * 60 * 1000;

/** This site's address as the browser sees it (behind Vite's proxy or Vercel too). */
function origin(req) {
  const proto = String(req.headers['x-forwarded-proto'] ?? (req.secure ? 'https' : 'http'))
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host)
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

const returnUrl = (req, nonce) => `${origin(req)}/api/auth/steam/return?n=${nonce}`;

/** Asks Steam's server whether the claim the browser brought back is genuine. */
async function verifyWithSteam(params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (k.startsWith('openid.')) body.set(k, String(v));
  body.set('openid.mode', 'check_authentication');
  const r = await fetch(STEAM_OPENID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  return r.ok && /(^|\n)is_valid:true(\n|$)/.test(await r.text());
}

/** The Steam profile name, as a suggested username (best effort). */
async function suggestedUsername(steamId) {
  const fallback = `steam-${steamId.slice(-6)}`;
  const key = process.env.STEAM_API_KEY?.trim();
  if (!key) return fallback;
  try {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamId}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const name = (await r.json()).response?.players?.[0]?.personaname ?? '';
    const clean = name
      .replace(/\s+/g, '_')
      .replace(/[^\w.-]/g, '')
      .slice(0, 40);
    return usernameProblem(clean) ? fallback : clean;
  } catch {
    return fallback;
  }
}

const clearCookie = (req, res, name) => setCookie(req, res, name, '', 0);

export const steamLoginRouter = express.Router();

steamLoginRouter.get('/api/auth/steam/start', async (req, res) => {
  let connectFor = null;
  if (req.query.intent === 'connect') {
    const session = await readSession(req);
    if (!session) return res.redirect('/');
    connectFor = session.id;
  }
  const nonce = randomBytes(16).toString('base64url');
  const state = await signValue({ n: nonce, c: connectFor, exp: Date.now() + STATE_MS });
  setCookie(req, res, STATE_COOKIE, state, STATE_MS);
  const url = new URL(STEAM_OPENID);
  url.search = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl(req, nonce),
    'openid.realm': origin(req),
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  }).toString();
  res.redirect(url.toString());
});

steamLoginRouter.get('/api/auth/steam/return', async (req, res) => {
  const state = await readSigned(req, STATE_COOKIE);
  clearCookie(req, res, STATE_COOKIE);
  const back = state?.c ? '/settings' : '/';
  const fail = (reason) => res.redirect(`${back}?steam=${reason}`);
  try {
    const p = req.query;
    // The browser must be the one that started this, coming back to the address we gave Steam.
    if (!state || typeof p.n !== 'string' || p.n !== state.n) return fail('failed');
    if (p['openid.mode'] !== 'id_res') return fail('cancelled');
    if (p['openid.op_endpoint'] !== STEAM_OPENID || p['openid.return_to'] !== returnUrl(req, state.n)) {
      return fail('failed');
    }
    const match = CLAIMED_ID.exec(String(p['openid.claimed_id'] ?? ''));
    if (!match || p['openid.identity'] !== p['openid.claimed_id']) return fail('failed');
    if (!(await verifyWithSteam(p))) return fail('failed');
    const steamId = match[1];

    const linked = (await query('SELECT "id", "username", "role" FROM users WHERE "steam_id" = $1', [steamId])).rows[0];

    if (state.c) {
      // Connecting Steam to the account that's logged in.
      const session = await readSession(req);
      if (!session || session.id !== state.c) return fail('failed');
      if (linked && linked.id !== session.id) return fail('taken');
      await query('UPDATE users SET "steam_id" = $2 WHERE "id" = $1', [session.id, steamId]);
      return res.redirect('/settings?steam=connected');
    }

    if (linked) {
      await setSessionCookie(req, res, linked);
      return res.redirect('/');
    }
    // Not linked yet: the login screen offers a new account or linking an existing one.
    const pending = await signValue({ s: steamId, exp: Date.now() + PENDING_MS });
    setCookie(req, res, PENDING_COOKIE, pending, PENDING_MS);
    res.redirect('/?steam=signup');
  } catch (err) {
    console.error('Steam login:', err);
    fail('failed');
  }
});

steamLoginRouter.get('/api/auth/steam/pending', async (req, res) => {
  const pending = await readSigned(req, PENDING_COOKIE);
  if (!pending) return res.status(404).json({ error: 'Sign in through Steam again.' });
  const [username, invite] = await Promise.all([suggestedUsername(pending.s), getInviteCode().catch(() => '')]);
  res.json({ username, signupOpen: !!invite });
});

steamLoginRouter.post('/api/auth/steam/complete', express.json({ limit: '10kb' }), async (req, res) => {
  const pending = await readSigned(req, PENDING_COOKIE);
  if (!pending) return res.status(400).json({ error: 'That took too long. Sign in through Steam again.' });
  const { code, username } = req.body ?? {};
  const name = typeof username === 'string' ? username.trim() : '';
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
    const problem = usernameProblem(name);
    if (problem) return res.status(400).json({ error: problem });
    const user = await createAccount(name, null, ROLES.user, pending.s);
    clearCookie(req, res, PENDING_COOKIE);
    await setSessionCookie(req, res, user);
    res.status(201).json({ id: user.id, user: user.username, superAdmin: false });
  } catch (err) {
    if (err instanceof UsernameTaken) return res.status(409).json({ error: err.message });
    if (err.code === '23505')
      return res.status(409).json({ error: 'That Steam account already has a Savepoint account.' });
    console.error('Steam sign-up:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});

// "I already have an account": logging in once links this Steam account to it.
steamLoginRouter.post('/api/auth/steam/link', express.json({ limit: '10kb' }), async (req, res) => {
  const pending = await readSigned(req, PENDING_COOKIE);
  if (!pending) return res.status(400).json({ error: 'That took too long. Sign in through Steam again.' });
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
    const user = (
      await query(
        'SELECT "id", "username", "password_hash", "role", "steam_id" FROM users WHERE lower("username") = lower($1)',
        [name],
      )
    ).rows[0];
    const ok = user?.password_hash
      ? await verifyPassword(password, user.password_hash)
      : await verifyAgainstNothing(password);
    if (!ok) {
      await countFailure(keys);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    if (user.steam_id && user.steam_id !== pending.s) {
      return res.status(409).json({ error: 'That account is already linked to a different Steam account.' });
    }
    await query('UPDATE users SET "steam_id" = $2 WHERE "id" = $1', [user.id, pending.s]);
    clearCookie(req, res, PENDING_COOKIE);
    await setSessionCookie(req, res, user);
    res.json({ id: user.id, user: user.username, superAdmin: user.role === ROLES.superAdmin });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That Steam account is already linked to another Savepoint account.' });
    }
    console.error('Steam link:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});
