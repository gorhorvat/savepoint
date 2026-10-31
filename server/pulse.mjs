// One small answer for the header badges, asked for every 20-60 seconds while
// the app is open and its user is active (src/lib/pulse.ts): unread messages
// (and the newest one, to announce it), friend requests, gifts to open, and
// friends online. One query for the counts; presence is cached for a minute.
//
//   GET /api/me/pulse -> { unread, latest, requests, gifts, online, at }
import express from 'express';
import { query } from './db.mjs';
import { presenceFor } from './presence.mjs';

export const pulseRouter = express.Router();

pulseRouter.get('/api/me/pulse', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         (SELECT count(*)::int FROM messages WHERE "recipient_id" = $1 AND "read_at" IS NULL) AS unread,
         (SELECT count(*)::int FROM friendships WHERE "addressee_id" = $1 AND "status" = 'pending') AS requests,
         (SELECT count(*)::int FROM gifts WHERE "to_id" = $1 AND "opened_at" IS NULL) AS gifts,
         (SELECT array_agg(CASE WHEN "requester_id" = $1 THEN "addressee_id" ELSE "requester_id" END)
            FROM friendships WHERE "status" = 'accepted' AND ("requester_id" = $1 OR "addressee_id" = $1)) AS friends`,
      [req.userId],
    );
    const r = rows[0];
    let latest = null;
    if (r.unread) {
      const { rows: last } = await query(
        `SELECT m."id", m."body", m."game"->>'title' AS game, u."id" AS uid, u."username", p."data"->>'avatar' AS avatar
         FROM messages m JOIN users u ON u."id" = m."sender_id"
         LEFT JOIN public_profiles p ON p."user_id" = m."sender_id"
         WHERE m."recipient_id" = $1 AND m."read_at" IS NULL ORDER BY m."id" DESC LIMIT 1`,
        [req.userId],
      );
      const m = last[0];
      if (m) {
        const text = m.body.replace(/\s+/g, ' ').trim();
        latest = {
          id: Number(m.id),
          from: { id: m.uid, username: m.username, avatar: m.avatar ?? null },
          preview: text ? (text.length > 120 ? `${text.slice(0, 117)}…` : text) : m.game ? `Sent you ${m.game}` : '',
        };
      }
    }
    const presence = await presenceFor(r.friends ?? []).catch(() => new Map());
    const online = [...presence.values()].filter((list) => list.some((p) => p.online)).length;
    res.set('Cache-Control', 'no-store');
    res.json({ unread: r.unread, latest, requests: r.requests, gifts: r.gifts, online, at: new Date().toISOString() });
  } catch (err) {
    console.error('Pulse:', err);
    res.status(502).json({ error: "Couldn't reach the database. Try again in a moment." });
  }
});
