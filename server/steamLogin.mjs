// "Sign in through Steam" (Steam's OpenID 2.0). Steam's login page sends the
// browser back with a signed claim of the SteamID; Steam's server confirms the
// claim before we trust it (check_authentication), and the SteamID is the only
// thing taken from it.
//
//   GET  /api/auth/steam/start?intent=login|link  -> Steam's login page
//   GET  /api/auth/steam/return                    <- Steam sends the browser back here
//   GET  /api/auth/steam/pending                   a new Steam account waiting for its invite code
//   POST /api/auth/steam/complete { code, username } creates that account
//
// login: a linked Steam account logs straight in; an unlinked one goes to
// /?steam=signup, where the invite code and a username create the account.
// link:  adds Steam as a way to log in to the account that's logged in.
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
  const intent = req.query.intent === 'link' ? 'link' : 'login';
  let userId = null;
  if (intent === 'link') {
    const s = await readSession(req);
    if (!s) return res.redirect('/');
    userId = s.id;
  }
  const nonce = randomBytes(16).toString('base64url');
  const state = await signValue({ n: nonce, i: intent, u: userId, exp: Date.now() + STATE_MS });
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
  const back = state?.i === 'link' ? '/profile' : '/';
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

    if (state.i === 'link') {
      const s = await readSession(req);
      if (!s || s.id !== state.u) return fail('failed');
      if (linked && linked.id !== s.id) return fail('taken');
      await query('UPDATE users SET "steam_id" = $2 WHERE "id" = $1', [s.id, steamId]);
      return res.redirect('/profile?steam=linked');
    }

    if (linked) {
      await setSessionCookie(req, res, linked);
      return res.redirect('/');
    }
    // A Steam account that has no Savepoint account yet.
    if (!(await getInviteCode())) return fail('closed');
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
  res.json({ username: await suggestedUsername(pending.s) });
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
