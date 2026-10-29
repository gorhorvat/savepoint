// User administration, for the super admin: every account, when it was made
// and last used, its connections; disabling, deleting, and password reset links.
// Savepoint sends no email, so a reset is a one-time link the admin passes on.
// It works for 24 hours; using it sets a new password and logs the account out
// everywhere else.
//
//   GET    /api/admin/users               the accounts
//   PATCH  /api/admin/users/:id           { disabled: true|false }
//   DELETE /api/admin/users/:id           deletes the account and all its data
//   POST   /api/admin/users/:id/reset     -> { url, expiresAt } (replaces any earlier link)
//   GET    /api/reset/:token              -> { username } while the link works (no login needed)
//   POST   /api/reset/:token              { password } -> sets it and logs in
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { ROLES } from './accounts.mjs';
import { forgetAccountState, setSessionCookie, superAdminOnly } from './auth.mjs';
import { query } from './db.mjs';
import { hashPassword, passwordProblem } from './passwords.mjs';

const RESET_MS = 24 * 3600 * 1000;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function failed(res, err, what) {
  console.error(`${what}:`, err);
  res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
}

/** This site's address as the browser sees it. */
function origin(req) {
  const first = (v) => String(v).split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto'] ?? (req.secure ? 'https' : 'http'));
  return `${proto}://${first(req.headers['x-forwarded-host'] ?? req.headers.host)}`;
}

/** The account an admin action is about, refusing your own account and other super admins. */
async function target(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'No such account.' });
    return null;
  }
  if (id === req.userId) {
    res.status(400).json({ error: "That's your own account." });
    return null;
  }
  const { rows } = await query('SELECT "id", "username", "role" FROM users WHERE "id" = $1', [id]);
  if (!rows[0]) {
    res.status(404).json({ error: 'No such account.' });
    return null;
  }
  return rows[0];
}

// ---------------------------------------------------------------- admin (after requireLogin)

export const adminRouter = express.Router();
adminRouter.use('/api/admin/users', superAdminOnly);

adminRouter.get('/api/admin/users', async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT u."id", u."username", u."role", u."created_at", u."last_seen_at", u."disabled_at",
              u."steam_id" IS NOT NULL AS steam, u."password_hash" IS NOT NULL AS has_password,
              COALESCE((SELECT array_agg(l."platform" ORDER BY l."platform") FROM platform_logins l
                        WHERE l."user_id" = u."id"), '{}') AS logins,
              (SELECT count(*)::int FROM play_entries e WHERE e."user_id" = u."id") AS games,
              (SELECT count(*)::int FROM friendships f WHERE f."status" = 'accepted'
                 AND (f."requester_id" = u."id" OR f."addressee_id" = u."id")) AS friends,
              (SELECT max(r."expires_at") FROM password_resets r
                 WHERE r."user_id" = u."id" AND r."expires_at" > now()) AS reset_until,
              p."data"->>'level' AS level
       FROM users u LEFT JOIN public_profiles p ON p."user_id" = u."id"
       ORDER BY u."created_at" DESC`,
    );
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        superAdmin: r.role === ROLES.superAdmin,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at ?? null,
        disabled: !!r.disabled_at,
        steam: r.steam,
        hasPassword: r.has_password,
        platforms: [...(r.steam ? ['steam'] : []), ...r.logins],
        games: r.games,
        friends: r.friends,
        level: r.level != null ? Number(r.level) : null,
        resetUntil: r.reset_until ?? null,
      })),
    });
  } catch (err) {
    failed(res, err, 'Admin users');
  }
});

adminRouter.patch('/api/admin/users/:id', express.json({ limit: '1kb' }), async (req, res) => {
  try {
    const user = await target(req, res);
    if (!user) return;
    if (user.role === ROLES.superAdmin) return res.status(400).json({ error: "A super admin can't be disabled." });
    const disabled = !!req.body?.disabled;
    await query(`UPDATE users SET "disabled_at" = ${disabled ? 'now()' : 'NULL'} WHERE "id" = $1`, [user.id]);
    forgetAccountState(user.id);
    res.json({ ok: true, disabled });
  } catch (err) {
    failed(res, err, 'Admin disable');
  }
});

adminRouter.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const user = await target(req, res);
    if (!user) return;
    if (user.role === ROLES.superAdmin) return res.status(400).json({ error: "A super admin can't be deleted." });
    // Everything the account owns goes with it (ON DELETE CASCADE).
    await query('DELETE FROM users WHERE "id" = $1', [user.id]);
    forgetAccountState(user.id);
    res.status(204).end();
  } catch (err) {
    failed(res, err, 'Admin delete');
  }
});

adminRouter.post('/api/admin/users/:id/reset', async (req, res) => {
  try {
    const user = await target(req, res);
    if (!user) return;
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + RESET_MS).toISOString();
    // One working link per account.
    await query('DELETE FROM password_resets WHERE "user_id" = $1', [user.id]);
    await query('INSERT INTO password_resets ("token_hash", "user_id", "expires_at") VALUES ($1, $2, $3)', [
      hashToken(token),
      user.id,
      expiresAt,
    ]);
    res.json({ url: `${origin(req)}/reset/${token}`, expiresAt });
  } catch (err) {
    failed(res, err, 'Admin reset');
  }
});

// ---------------------------------------------------------------- reset links (before requireLogin)

export const resetRouter = express.Router();

async function resetFor(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { rows } = await query(
    `SELECT r."user_id", u."username", u."role", u."disabled_at", u."session_version"
     FROM password_resets r JOIN users u ON u."id" = r."user_id"
     WHERE r."token_hash" = $1 AND r."expires_at" > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

const GONE = 'This reset link has expired or was already used. Ask the admin for a new one.';

resetRouter.get('/api/reset/:token', async (req, res) => {
  try {
    const r = await resetFor(req.params.token);
    if (!r) return res.status(404).json({ error: GONE });
    res.json({ username: r.username });
  } catch (err) {
    failed(res, err, 'Reset link');
  }
});

resetRouter.post('/api/reset/:token', express.json({ limit: '10kb' }), async (req, res) => {
  const problem = passwordProblem(req.body?.password);
  if (problem) return res.status(400).json({ error: problem });
  try {
    const r = await resetFor(req.params.token);
    if (!r) return res.status(404).json({ error: GONE });
    if (r.disabled_at) return res.status(403).json({ error: 'This account is disabled. Ask the Savepoint admin.' });
    // New password, every other session logged out, and the link used up.
    const { rows } = await query(
      `UPDATE users SET "password_hash" = $2, "session_version" = "session_version" + 1
       WHERE "id" = $1 RETURNING "session_version"`,
      [r.user_id, await hashPassword(req.body.password)],
    );
    await query('DELETE FROM password_resets WHERE "user_id" = $1', [r.user_id]);
    forgetAccountState(r.user_id);
    await setSessionCookie(req, res, {
      id: r.user_id,
      username: r.username,
      role: r.role,
      session_version: rows[0].session_version,
    });
    res.json({ ok: true });
  } catch (err) {
    failed(res, err, 'Reset password');
  }
});
