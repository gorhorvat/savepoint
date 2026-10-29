// Friends: requests by username or a personal friend link, accepting,
// declining and removing; what friends see of each other (the public profile
// the app sends); and whether they're online and what they're playing
// (server/presence.mjs). Mounted after requireLogin.
//
//   GET    /api/friends                    friends (with presence), incoming and outgoing requests
//   GET    /api/friends/summary            { incoming, online } for the header badge and dot
//   POST   /api/friends/requests           { username } or { code } -> sends (or accepts a crossing request)
//   POST   /api/friends/requests/:id/accept
//   DELETE /api/friends/requests/:id       declines an incoming or cancels an outgoing request
//   DELETE /api/friends/:id                removes a friend
//   GET    /api/friends/:id                a friend's profile and presence
//   GET    /api/friends/link, POST /api/friends/link   your friend code, or a new one
//   PUT    /api/profile/public             what friends see of you
//   GET    /api/leaderboard?scope=friends|global  ranked by XP
import express from 'express';
import { randomBytes } from 'node:crypto';
import { query } from './db.mjs';
import { presenceFor } from './presence.mjs';

const MAX_FRIENDS = 300;
const MAX_PROFILE_BYTES = 400_000;

const newCode = () => randomBytes(9).toString('base64url');

function failed(res, err) {
  console.error('Friends:', err);
  res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
}

const userId = (req) => Number(req.params.id);

/** The friendship row between two accounts, either direction. */
async function between(a, b) {
  const { rows } = await query(
    `SELECT * FROM friendships WHERE ("requester_id" = $1 AND "addressee_id" = $2)
       OR ("requester_id" = $2 AND "addressee_id" = $1)`,
    [a, b],
  );
  return rows[0] ?? null;
}

/** Picture, level and rank from a public profile, for lists. */
const card = (u) => ({
  id: u.id,
  username: u.username,
  avatar: u.data?.avatar ?? null,
  level: u.data?.level ?? null,
  rank: u.data?.rank ?? null,
  into: u.data?.into ?? null,
  needed: u.data?.needed ?? null,
});

export const friendsRouter = express.Router();

friendsRouter.get('/api/friends', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT f."requester_id", f."addressee_id", f."status", f."accepted_at", u."id", u."username", p."data"
       FROM friendships f
       JOIN users u ON u."id" = CASE WHEN f."requester_id" = $1 THEN f."addressee_id" ELSE f."requester_id" END
       LEFT JOIN public_profiles p ON p."user_id" = u."id"
       WHERE f."requester_id" = $1 OR f."addressee_id" = $1
       ORDER BY lower(u."username")`,
      [req.userId],
    );
    const friends = rows.filter((r) => r.status === 'accepted');
    const presence = await presenceFor(friends.map((f) => f.id));
    res.json({
      friends: friends.map((f) => ({ ...card(f), since: f.accepted_at, presence: presence.get(f.id) ?? [] })),
      incoming: rows.filter((r) => r.status === 'pending' && r.addressee_id === req.userId).map(card),
      outgoing: rows.filter((r) => r.status === 'pending' && r.requester_id === req.userId).map(card),
    });
  } catch (err) {
    failed(res, err);
  }
});

friendsRouter.get('/api/friends/summary', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM friendships WHERE "addressee_id" = $1 AND "status" = 'pending'`,
      [req.userId],
    );
    const { rows: friends } = await query(
      `SELECT CASE WHEN "requester_id" = $1 THEN "addressee_id" ELSE "requester_id" END AS id
       FROM friendships WHERE "status" = 'accepted' AND ("requester_id" = $1 OR "addressee_id" = $1)`,
      [req.userId],
    );
    // Presence is cached for a minute, so this stays cheap when polled.
    const presence = await presenceFor(friends.map((f) => f.id)).catch(() => new Map());
    const online = [...presence.values()].filter((list) => list.some((p) => p.online)).length;
    res.json({ incoming: rows[0].n, online });
  } catch (err) {
    failed(res, err);
  }
});

friendsRouter.get('/api/friends/link', async (req, res) => {
  try {
    let { rows } = await query('SELECT "friend_code" FROM users WHERE "id" = $1', [req.userId]);
    let code = rows[0]?.friend_code;
    if (!code) {
      code = newCode();
      await query('UPDATE users SET "friend_code" = $2 WHERE "id" = $1', [req.userId, code]);
    }
    res.json({ code });
  } catch (err) {
    failed(res, err);
  }
});

// A new link; the old one stops working.
friendsRouter.post('/api/friends/link', async (req, res) => {
  try {
    const code = newCode();
    await query('UPDATE users SET "friend_code" = $2 WHERE "id" = $1', [req.userId, code]);
    res.json({ code });
  } catch (err) {
    failed(res, err);
  }
});

// Body: { username } or { code } -> { status: 'sent' | 'accepted', friend: { id, username } }
friendsRouter.post('/api/friends/requests', express.json({ limit: '10kb' }), async (req, res) => {
  const { username, code } = req.body ?? {};
  try {
    const { rows } =
      typeof code === 'string' && code.trim()
        ? await query('SELECT "id", "username" FROM users WHERE "friend_code" = $1', [code.trim()])
        : typeof username === 'string' && username.trim()
          ? await query('SELECT "id", "username" FROM users WHERE lower("username") = lower($1)', [username.trim()])
          : { rows: [] };
    const other = rows[0];
    if (!other) {
      return res.status(404).json({
        error: code ? 'That friend link no longer works. Ask for a new one.' : 'No account has that username.',
      });
    }
    if (other.id === req.userId) return res.status(400).json({ error: "That's you." });
    const friend = { id: other.id, username: other.username };
    const existing = await between(req.userId, other.id);
    if (existing?.status === 'accepted')
      return res.status(409).json({ error: `You're already friends with ${other.username}.` });
    if (existing && existing.requester_id === req.userId) {
      return res.status(409).json({ error: `You've already sent ${other.username} a request.` });
    }
    if (existing) {
      // They asked first: this accepts their request.
      await query(
        `UPDATE friendships SET "status" = 'accepted', "accepted_at" = now() WHERE "requester_id" = $1 AND "addressee_id" = $2`,
        [other.id, req.userId],
      );
      return res.json({ status: 'accepted', friend });
    }
    const { rows: count } = await query(
      `SELECT count(*)::int AS n FROM friendships WHERE "requester_id" = $1 OR "addressee_id" = $1`,
      [req.userId],
    );
    if (count[0].n >= MAX_FRIENDS) return res.status(409).json({ error: 'You have too many friends and requests.' });
    await query('INSERT INTO friendships ("requester_id", "addressee_id") VALUES ($1, $2)', [req.userId, other.id]);
    res.status(201).json({ status: 'sent', friend });
  } catch (err) {
    failed(res, err);
  }
});

friendsRouter.post('/api/friends/requests/:id/accept', async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE friendships SET "status" = 'accepted', "accepted_at" = now()
       WHERE "requester_id" = $1 AND "addressee_id" = $2 AND "status" = 'pending'`,
      [userId(req), req.userId],
    );
    if (!rowCount) return res.status(404).json({ error: 'That request is gone.' });
    res.json({ ok: true });
  } catch (err) {
    failed(res, err);
  }
});

friendsRouter.delete('/api/friends/requests/:id', async (req, res) => {
  try {
    await query(
      `DELETE FROM friendships WHERE "status" = 'pending'
       AND (("requester_id" = $1 AND "addressee_id" = $2) OR ("requester_id" = $2 AND "addressee_id" = $1))`,
      [userId(req), req.userId],
    );
    res.status(204).end();
  } catch (err) {
    failed(res, err);
  }
});

friendsRouter.delete('/api/friends/:id', async (req, res) => {
  try {
    await query(
      `DELETE FROM friendships WHERE "status" = 'accepted'
       AND (("requester_id" = $1 AND "addressee_id" = $2) OR ("requester_id" = $2 AND "addressee_id" = $1))`,
      [userId(req), req.userId],
    );
    res.status(204).end();
  } catch (err) {
    failed(res, err);
  }
});

// Only friends see each other's profile.
friendsRouter.get('/api/friends/:id', async (req, res) => {
  const id = userId(req);
  if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found.' });
  try {
    const link = await between(req.userId, id);
    if (link?.status !== 'accepted') return res.status(404).json({ error: "You're not friends with this account." });
    const { rows } = await query(
      `SELECT u."id", u."username", p."data", p."updated_at" FROM users u
       LEFT JOIN public_profiles p ON p."user_id" = u."id" WHERE u."id" = $1`,
      [id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
    const presence = await presenceFor([id]);
    res.json({
      id,
      username: rows[0].username,
      since: link.accepted_at,
      profile: rows[0].data ?? null,
      updatedAt: rows[0].updated_at ?? null,
      presence: presence.get(id) ?? [],
    });
  } catch (err) {
    failed(res, err);
  }
});

friendsRouter.put('/api/profile/public', express.json({ limit: '600kb' }), async (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return res.status(400).json({ error: 'Expected an object.' });
  const json = JSON.stringify(data);
  if (json.length > MAX_PROFILE_BYTES) return res.status(413).json({ error: 'Too large.' });
  try {
    await query(
      `INSERT INTO public_profiles ("user_id", "data", "updated_at") VALUES ($1, $2, now())
       ON CONFLICT ("user_id") DO UPDATE SET "data" = EXCLUDED."data", "updated_at" = now()`,
      [req.userId, json],
    );
    res.status(204).end();
  } catch (err) {
    failed(res, err);
  }
});

// ---------------------------------------------------------------- leaderboards

/**
 * GET /api/leaderboard?scope=friends|global -> { rows, you }
 * Ranked by Savepoint XP (level and rank follow from it), from what each
 * account's app last sent (public_profiles). Disabled accounts are left out.
 * Global lists the top 100; `you` is your own row and place either way.
 */
friendsRouter.get('/api/leaderboard', async (req, res) => {
  const scope = req.query.scope === 'global' ? 'global' : 'friends';
  try {
    const { rows } = await query(
      `SELECT u."id", u."username", p."data"
       FROM users u JOIN public_profiles p ON p."user_id" = u."id"
       WHERE u."disabled_at" IS NULL AND ($2 = 'global' OR u."id" = $1 OR u."id" IN (
         SELECT CASE WHEN "requester_id" = $1 THEN "addressee_id" ELSE "requester_id" END
         FROM friendships WHERE "status" = 'accepted' AND ("requester_id" = $1 OR "addressee_id" = $1)))`,
      [req.userId, scope],
    );
    const ranked = rows
      .map((r) => ({
        ...card(r),
        xp: Number(r.data?.xp) || 0,
        hours: Number(r.data?.totalHours) || 0,
        games: Number(r.data?.gameCount) || 0,
        you: r.id === req.userId,
      }))
      .sort((a, b) => b.xp - a.xp || a.username.localeCompare(b.username))
      .map((r, i) => ({ ...r, place: i + 1 }));
    res.json({ scope, total: ranked.length, rows: ranked.slice(0, 100), you: ranked.find((r) => r.you) ?? null });
  } catch (err) {
    failed(res, err);
  }
});
