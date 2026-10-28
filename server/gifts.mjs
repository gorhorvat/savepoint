// Gifting game keys to friends. The key is stored encrypted (like platform
// sign-ins) and shown only to the friend it was sent to, when they open it.
// The friend gets a push through their ntfy topic when they have alerts on;
// the sender sees when it was opened and redeemed. Mounted after requireLogin.
//
//   GET    /api/gifts                 { received, sent }, newest first (no keys)
//   GET    /api/gifts/summary         { unopened } for the header badge
//   POST   /api/gifts                 { to, title, platform, key, message?, gameId? } -> { id }
//   POST   /api/gifts/:id/open        -> { key } (recipient only)
//   POST   /api/gifts/:id/redeemed    marks it redeemed (recipient only)
//   DELETE /api/gifts/:id             takes back a gift nobody opened yet (sender only)
import express from 'express';
import { alertTopic, notify } from './alerts.mjs';
import { query } from './db.mjs';
import { decrypt, encrypt } from './platformLogins.mjs';

export const GIFT_PLATFORMS = [
  'Steam',
  'Epic Games',
  'GOG',
  'PlayStation',
  'Xbox',
  'Nintendo',
  'Ubisoft',
  'EA',
  'Battle.net',
  'Other',
];

function failed(res, err) {
  console.error('Gifts:', err);
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

async function username(id) {
  const { rows } = await query('SELECT "username" FROM users WHERE "id" = $1', [id]);
  return rows[0]?.username ?? 'A friend';
}

/** Push to someone's ntfy topic, if they have one. Never fails the request. */
async function tell(userId, message) {
  try {
    const topic = await alertTopic(userId);
    if (topic) await notify(topic, message);
  } catch {
    // A missed push isn't worth an error.
  }
}

const row = (r) => ({
  id: r.id,
  from: r.from_id ? { id: r.from_id, username: r.from_name } : undefined,
  to: r.to_id ? { id: r.to_id, username: r.to_name } : undefined,
  title: r.title,
  platform: r.platform,
  message: r.message ?? undefined,
  gameId: r.game_id ?? undefined,
  sentAt: r.created_at,
  openedAt: r.opened_at ?? undefined,
  redeemedAt: r.redeemed_at ?? undefined,
});

export const giftsRouter = express.Router();

giftsRouter.get('/api/gifts', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT g.*, f."username" AS from_name, t."username" AS to_name
       FROM gifts g JOIN users f ON f."id" = g."from_id" JOIN users t ON t."id" = g."to_id"
       WHERE g."from_id" = $1 OR g."to_id" = $1
       ORDER BY g."created_at" DESC LIMIT 200`,
      [req.userId],
    );
    res.json({
      received: rows.filter((r) => r.to_id === req.userId).map((r) => ({ ...row(r), to: undefined })),
      sent: rows.filter((r) => r.from_id === req.userId).map((r) => ({ ...row(r), from: undefined })),
    });
  } catch (err) {
    failed(res, err);
  }
});

giftsRouter.get('/api/gifts/summary', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT count(*)::int AS n FROM gifts WHERE "to_id" = $1 AND "opened_at" IS NULL',
      [req.userId],
    );
    res.json({ unopened: rows[0].n });
  } catch (err) {
    failed(res, err);
  }
});

giftsRouter.post('/api/gifts', express.json({ limit: '10kb' }), async (req, res) => {
  const b = req.body ?? {};
  const to = Number(b.to);
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
  const platform = GIFT_PLATFORMS.includes(b.platform) ? b.platform : null;
  const key = typeof b.key === 'string' ? b.key.trim() : '';
  const message = typeof b.message === 'string' && b.message.trim() ? b.message.trim().slice(0, 500) : null;
  const gameId = typeof b.gameId === 'string' && b.gameId ? b.gameId.slice(0, 200) : null;
  if (!Number.isInteger(to) || !title || !platform) return res.status(400).json({ error: 'Pick a game and a platform.' });
  if (!key || key.length > 500) return res.status(400).json({ error: 'Paste the key.' });
  try {
    if (to === req.userId || !(await areFriends(req.userId, to))) {
      return res.status(404).json({ error: 'You can only send gifts to friends.' });
    }
    const { rows } = await query(
      `INSERT INTO gifts ("from_id", "to_id", "title", "platform", "secret", "message", "game_id")
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING "id"`,
      [req.userId, to, title, platform, await encrypt(key), message, gameId],
    );
    const from = await username(req.userId);
    res.status(201).json({ id: rows[0].id });
    void tell(to, {
      title: `${from} sent you a gift`,
      message: `${title} (${platform}). Open it in Savepoint, under Friends.`,
    });
  } catch (err) {
    failed(res, err);
  }
});

giftsRouter.post('/api/gifts/:id/open', async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE gifts SET "opened_at" = COALESCE("opened_at", now())
       WHERE "id" = $1 AND "to_id" = $2 RETURNING "secret"`,
      [Number(req.params.id), req.userId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'That gift is gone.' });
    res.json({ key: await decrypt(rows[0].secret) });
  } catch (err) {
    failed(res, err);
  }
});

giftsRouter.post('/api/gifts/:id/redeemed', async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE gifts SET "redeemed_at" = COALESCE("redeemed_at", now()), "opened_at" = COALESCE("opened_at", now())
       WHERE "id" = $1 AND "to_id" = $2 RETURNING "from_id", "title", "game_id"`,
      [Number(req.params.id), req.userId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'That gift is gone.' });
    const by = await username(req.userId);
    res.json({ ok: true, gameId: rows[0].game_id ?? undefined });
    void tell(rows[0].from_id, {
      title: `${by} redeemed your gift`,
      message: `${rows[0].title} is in their library now.`,
    });
  } catch (err) {
    failed(res, err);
  }
});

giftsRouter.delete('/api/gifts/:id', async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM gifts WHERE "id" = $1 AND "from_id" = $2 AND "opened_at" IS NULL',
      [Number(req.params.id), req.userId],
    );
    if (!rowCount) return res.status(409).json({ error: "It's been opened already, so it can't be taken back." });
    res.status(204).end();
  } catch (err) {
    failed(res, err);
  }
});
