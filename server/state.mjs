// Saved app state: the library, wishlist, ratings, play history and the rest,
// stored in the database (server/library.mjs) per logged-in user, so every
// device sees the same data.
//
// Each save carries the rev its copy is based on. A save from an out-of-date
// copy is refused (409), so one device can't overwrite another's newer data.
import express from 'express';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { libraryRev, loadLibrary, saveLibrary } from './library.mjs';

const gzipAsync = promisify(gzip);

/** Sends JSON, compressed when the browser accepts it (the library shrinks to about a quarter). */
async function send(req, res, status, value) {
  res.set('Cache-Control', 'no-store').set('Vary', 'Accept-Encoding');
  let body = Buffer.from(JSON.stringify(value));
  if (body.length > 1024 && req.acceptsEncodings('gzip')) {
    body = await gzipAsync(body);
    res.set('Content-Encoding', 'gzip');
  }
  res.status(status).type('application/json').send(body);
}

function failed(res, err) {
  console.error('Library storage:', err);
  res.status(502).json({ error: "Couldn't reach the database where your library is stored. Try again in a moment." });
}

export const stateRouter = express.Router();

stateRouter.get('/api/state', async (req, res) => {
  try {
    const saved = await loadLibrary(req.userId);
    if (!saved) return send(req, res, 404, { rev: 0, savedAt: null });
    await send(req, res, 200, saved);
  } catch (err) {
    failed(res, err);
  }
});

// Cheap check for "has another device saved since I loaded?".
stateRouter.get('/api/state/rev', async (req, res) => {
  try {
    await send(req, res, 200, await libraryRev(req.userId));
  } catch (err) {
    failed(res, err);
  }
});

// express.raw unpacks the browser's gzip.
stateRouter.put('/api/state', express.raw({ type: 'application/json', limit: '50mb' }), async (req, res) => {
  let body;
  try {
    body = JSON.parse(req.body.toString() || '{}');
  } catch {
    return res.status(400).json({ error: 'Expected { baseRev, version, state }.' });
  }
  const { baseRev, version, state } = body;
  if (
    !Number.isInteger(baseRev) ||
    !Number.isInteger(version) ||
    !state ||
    typeof state !== 'object' ||
    !Array.isArray(state.entries)
  ) {
    return res.status(400).json({ error: 'Expected { baseRev, version, state }.' });
  }
  try {
    const result = await saveLibrary(req.userId, { baseRev, version, state });
    res.status(result.ok ? 200 : 409).json({ rev: result.rev, savedAt: result.savedAt });
  } catch (err) {
    failed(res, err);
  }
});
