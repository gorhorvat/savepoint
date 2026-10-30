// Messages between friends: one to one, text and game cards, with "Seen"
// receipts. Only accepted friends can write to each other; history is kept.
// The app polls (Vercel can't hold connections open): every few seconds while
// a chat is open, and with the header's friends check otherwise. Messages are
// private: no admin route reads them. Mounted after requireLogin.
//
//   GET  /api/messages                       conversations, newest first, with unread counts
//   GET  /api/messages/unread                { unread } for the header badge
//   GET  /api/messages/:friendId?after=&before=   the chat (50 at a time); marks theirs as read
//   POST /api/messages/:friendId             { body, game? } -> the new message
import express from 'express';
import { query } from './db.mjs';

const MAX_BODY = 2000;
const PAGE = 50;
const PER_MINUTE = 30;

function failed(res, err) {
  console.error('Messages:', err);
  res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
}

async function areFriends(a, b) {
  const { rows } = await query(
    `SELECT 1 FROM friendships WHERE "status" = 'accepted'
       AND (("requester_id" = $1 AND "addressee_id" = $2) OR ("requester_id" = $2 AND "addressee_id" = $1))`,
    [a, b],
  );
  return rows.length > 0;
}

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const strs = (v, max = 12) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 60).slice(0, max) : [];

/** A shared game, kept to what the recipient needs to show it and wishlist it. */
function cleanGame(g) {
  if (!g || typeof g !== 'object') return null;
  const title = str(g.title, 200);
  if (!title) return null;
  const imageUrl = str(g.imageUrl, 600);
  return {
    title,
    imageUrl: imageUrl && /^https:\/\//.test(imageUrl) ? imageUrl : undefined,
    steamAppId: Number.isInteger(g.steamAppId) && g.steamAppId > 0 ? g.steamAppId : undefined,
    nsuid: str(g.nsuid, 40),
    availableOn: strs(g.availableOn, 10),
    genres: strs(g.genres),
    subgenres: strs(g.subgenres),
    tags: strs(g.tags, 20),
    developer: str(g.developer, 120),
    year: Number.isInteger(g.year) ? g.year : undefined,
    releaseDate: str(g.releaseDate, 40),
    fit: Number.isFinite(g.fit) ? Math.max(0, Math.min(100, Math.round(g.fit))) : undefined,
  };
}

const message = (r, me) => ({
  id: Number(r.id),
  mine: r.sender_id === me,
  body: r.body,
  game: r.game ?? null,
  at: r.created_at,
  readAt: r.read_at ?? null,
});

// Sending is limited per account, in memory (enough to stop a runaway loop).
const recent = new Map(); // userId -> timestamps
function tooFast(userId) {
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(userId, list);
  return list.length > PER_MINUTE;
}

export const messagesRouter = express.Router();

messagesRouter.get('/api/messages', async (req, res) => {
  try {
    const { rows } = await query(
      `WITH mine AS (
         SELECT DISTINCT ON (m.other) m.*
         FROM (SELECT *, CASE WHEN "sender_id" = $1 THEN "recipient_id" ELSE "sender_id" END AS other
               FROM messages WHERE "sender_id" = $1 OR "recipient_id" = $1) m
         ORDER BY m.other, m."id" DESC
       )
       SELECT mine.*, u."username", p."data"->>'avatar' AS avatar,
              (SELECT count(*)::int FROM messages x
                 WHERE x."sender_id" = mine.other AND x."recipient_id" = $1 AND x."read_at" IS NULL) AS unread,
              EXISTS (SELECT 1 FROM friendships f WHERE f."status" = 'accepted'
                 AND ((f."requester_id" = $1 AND f."addressee_id" = mine.other)
                   OR (f."requester_id" = mine.other AND f."addressee_id" = $1))) AS friends
       FROM mine JOIN users u ON u."id" = mine.other
       LEFT JOIN public_profiles p ON p."user_id" = mine.other
       ORDER BY mine."id" DESC`,
      [req.userId],
    );
    res.json({
      conversations: rows.map((r) => ({
        friend: { id: r.other, username: r.username, avatar: r.avatar ?? null },
        last: message(r, req.userId),
        unread: r.unread,
        canWrite: r.friends,
      })),
    });
  } catch (err) {
    failed(res, err);
  }
});

messagesRouter.get('/api/messages/unread', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM messages WHERE "recipient_id" = $1 AND "read_at" IS NULL`,
      [req.userId],
    );
    res.json({ unread: rows[0].n });
  } catch (err) {
    failed(res, err);
  }
});

messagesRouter.get('/api/messages/:friendId', async (req, res) => {
  const other = Number(req.params.friendId);
  if (!Number.isInteger(other) || other === req.userId) return res.status(404).json({ error: 'No such chat.' });
  try {
    const { rows: users } = await query(
      `SELECT u."id", u."username", p."data"->>'avatar' AS avatar
       FROM users u LEFT JOIN public_profiles p ON p."user_id" = u."id" WHERE u."id" = $1`,
      [other],
    );
    if (!users[0]) return res.status(404).json({ error: 'No such account.' });
    const friends = await areFriends(req.userId, other);
    const params = [req.userId, other];
    let where = '';
    if (req.query.after) {
      params.push(Number(req.query.after) || 0);
      where = `AND "id" > $${params.length}`;
    } else if (req.query.before) {
      params.push(Number(req.query.before) || 0);
      where = `AND "id" < $${params.length}`;
    }
    params.push(PAGE + 1);
    const { rows } = await query(
      `SELECT * FROM messages
       WHERE (("sender_id" = $1 AND "recipient_id" = $2) OR ("sender_id" = $2 AND "recipient_id" = $1)) ${where}
       ORDER BY "id" ${req.query.after ? 'ASC' : 'DESC'} LIMIT $${params.length}`,
      params,
    );
    const more = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    if (!req.query.after) page.reverse();
    // Opening the chat reads their messages.
    await query(
      `UPDATE messages SET "read_at" = now()
       WHERE "sender_id" = $2 AND "recipient_id" = $1 AND "read_at" IS NULL`,
      [req.userId, other],
    );
    // The newest of your messages they've read, for "Seen".
    const { rows: seen } = await query(
      `SELECT max("id") AS id FROM messages
       WHERE "sender_id" = $1 AND "recipient_id" = $2 AND "read_at" IS NOT NULL`,
      [req.userId, other],
    );
    res.json({
      friend: { id: users[0].id, username: users[0].username, avatar: users[0].avatar ?? null },
      canWrite: friends,
      messages: page.map((r) => message(r, req.userId)),
      more: req.query.after ? false : more,
      seenUpTo: seen[0].id ? Number(seen[0].id) : null,
    });
  } catch (err) {
    failed(res, err);
  }
});

messagesRouter.post('/api/messages/:friendId', express.json({ limit: '16kb' }), async (req, res) => {
  const other = Number(req.params.friendId);
  if (!Number.isInteger(other) || other === req.userId) return res.status(404).json({ error: 'No such chat.' });
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  const game = cleanGame(req.body?.game);
  if (!body && !game) return res.status(400).json({ error: 'Write something first.' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: `Keep it under ${MAX_BODY} characters.` });
  if (tooFast(req.userId)) return res.status(429).json({ error: 'That’s a lot of messages. Wait a moment.' });
  try {
    if (!(await areFriends(req.userId, other))) {
      return res.status(403).json({ error: 'You can only message friends.' });
    }
    const { rows } = await query(
      `INSERT INTO messages ("sender_id", "recipient_id", "body", "game") VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.userId, other, body, game ? JSON.stringify(game) : null],
    );
    res.status(201).json(message(rows[0], req.userId));
  } catch (err) {
    failed(res, err);
  }
});
