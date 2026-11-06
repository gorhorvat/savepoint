// Images in messages. The app shrinks a picture (longest side 1600 px, WebP or
// JPEG) and uploads it here before sending the message that shows it. Files
// live in a private Vercel Blob store (BLOB_READ_WRITE_TOKEN), so only this
// server can read them, and they're served only to the two people in the chat.
// Without a Blob store (local dev), they're kept in .cache/message-images.
//
// The free Blob plan blocks the store for 30 days if it goes over 1 GB, so
// uploads stop at STORE_LIMIT, and each account can send PER_MONTH images in
// 30 days. Uploads that never got sent are removed by the daily cron.
//
//   POST /api/message-images?w=&h=    raw image body -> { image: { id, width, height } }
//   GET  /api/message-images/:id       the image (its sender and recipient only)
import { del, get, put } from '@vercel/blob';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { query } from './db.mjs';
import { CACHE_DIR } from './diskCache.mjs';

const MAX_BYTES = 3 * 1024 * 1024;
const STORE_LIMIT = 900 * 1024 * 1024;
const PER_MONTH = 150;
const LOCAL_DIR = path.join(CACHE_DIR, 'message-images');

const blobConfigured = () => !!process.env.BLOB_READ_WRITE_TOKEN?.trim();
/** Images work with a Blob store, or locally without one (never on Vercel without one). */
export const imagesAvailable = () => blobConfigured() || !process.env.VERCEL;

/** What the bytes are, from their first bytes (the Content-Type header isn't trusted). */
function imageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const pathnameOf = (id) => `message-images/${id}`;

async function store(id, buf, contentType) {
  if (blobConfigured()) {
    await put(pathnameOf(id), buf, { access: 'private', contentType, addRandomSuffix: false });
    return;
  }
  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_DIR, id), buf);
}

/** { stream, contentType } or null when the file is gone. */
async function load(id, contentType) {
  if (blobConfigured()) {
    const r = await get(pathnameOf(id), { access: 'private' });
    if (!r || r.statusCode !== 200) return null;
    return { stream: Readable.fromWeb(r.stream), contentType: r.blob.contentType || contentType };
  }
  const buf = await readFile(path.join(LOCAL_DIR, id)).catch(() => null);
  return buf ? { stream: Readable.from(buf), contentType } : null;
}

async function remove(ids) {
  if (!ids.length) return;
  if (blobConfigured()) await del(ids.map(pathnameOf));
  else await Promise.all(ids.map((id) => rm(path.join(LOCAL_DIR, id), { force: true })));
}

/** Removes uploads that were never sent, a day on. Called by the daily cron. */
export async function removeUnsentImages() {
  const { rows } = await query(
    `SELECT "id" FROM message_images WHERE "message_id" IS NULL AND "created_at" < now() - interval '1 day' LIMIT 500`,
  );
  const ids = rows.map((r) => r.id);
  await remove(ids);
  if (ids.length) await query(`DELETE FROM message_images WHERE "id" = ANY($1)`, [ids]);
  return { removed: ids.length };
}

/**
 * An uploaded image the sender may attach to a message: theirs and not sent
 * yet. Marks it as sent with `messageId`. Returns what the message stores.
 */
export async function attachImage(userId, id, messageId) {
  const { rows } = await query(
    `UPDATE message_images SET "message_id" = $3
     WHERE "id" = $1 AND "owner_id" = $2 AND "message_id" IS NULL
     RETURNING "id", "width", "height"`,
    [id, userId, messageId],
  );
  return rows[0] ? { id: rows[0].id, width: rows[0].width, height: rows[0].height } : null;
}

/** Whether `id` is an upload of this account that hasn't been sent yet. */
export async function canAttach(userId, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(id)) return false;
  const { rows } = await query(
    `SELECT 1 FROM message_images WHERE "id" = $1 AND "owner_id" = $2 AND "message_id" IS NULL`,
    [id, userId],
  );
  return rows.length > 0;
}

const side = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 4096 ? n : null;
};

export const messageImagesRouter = express.Router();

messageImagesRouter.post(
  '/api/message-images',
  express.raw({ type: () => true, limit: MAX_BYTES }),
  async (req, res) => {
    if (!imagesAvailable()) return res.status(501).json({ error: "Sending pictures isn't set up on this server." });
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    const contentType = buf && imageType(buf);
    if (!contentType) return res.status(400).json({ error: 'That file isn’t a picture Savepoint can send.' });
    const width = side(req.query.w);
    const height = side(req.query.h);
    if (!width || !height) return res.status(400).json({ error: 'Expected the picture’s size.' });
    try {
      const { rows } = await query(
        `SELECT
           (SELECT count(*)::int FROM message_images WHERE "owner_id" = $1 AND "created_at" > now() - interval '30 days') AS mine,
           (SELECT COALESCE(sum("bytes"), 0)::bigint FROM message_images) AS stored`,
        [req.userId],
      );
      if (rows[0].mine >= PER_MONTH) {
        return res
          .status(429)
          .json({ error: `You can send ${PER_MONTH} pictures in 30 days. Try again in a few days.` });
      }
      if (Number(rows[0].stored) + buf.length > STORE_LIMIT) {
        return res.status(507).json({ error: 'There’s no room for more pictures right now.' });
      }
      const id = randomBytes(16).toString('base64url');
      await store(id, buf, contentType);
      await query(
        `INSERT INTO message_images ("id", "owner_id", "content_type", "bytes", "width", "height") VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, req.userId, contentType, buf.length, width, height],
      );
      res.status(201).json({ image: { id, width, height } });
    } catch (err) {
      console.error('Message images:', err);
      res.status(502).json({ error: "Couldn't upload the picture. Try again in a moment." });
    }
  },
);

messageImagesRouter.get('/api/message-images/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return res.status(404).end();
  try {
    // The sender, or the recipient of the message it was sent in.
    const { rows } = await query(
      `SELECT i."content_type" FROM message_images i LEFT JOIN messages m ON m."id" = i."message_id"
       WHERE i."id" = $1 AND (i."owner_id" = $2 OR m."recipient_id" = $2)`,
      [id, req.userId],
    );
    if (!rows[0]) return res.status(404).end();
    const file = await load(id, rows[0].content_type);
    if (!file) return res.status(404).end();
    res.set({
      'Content-Type': file.contentType,
      // An image never changes, so the browser keeps it rather than asking Blob again.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    file.stream.on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    console.error('Message images:', err);
    res.status(502).end();
  }
});
