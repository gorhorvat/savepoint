// Saved app state: the library, wishlist, ratings, play history and the rest.
// It's stored in VerBuddy's database (VerBuddy's /api/savepoint endpoints),
// using the VerBuddy login of whoever is signed in, so it doesn't depend on a
// browser and every device sees the same data.
//
// Each save carries the rev its copy is based on. VerBuddy refuses (409) a
// save from an out-of-date copy, so one device can't overwrite another's newer
// data. Responses are passed through as they are.
//
// One-time move: if VerBuddy has nothing saved yet and data/savepoint.json (the
// older file-based storage) exists, it's uploaded and renamed to
// savepoint.uploaded.json, which stays as a local copy.
import express from 'express';
import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = path.resolve(ROOT, process.env.SAVEPOINT_DATA_DIR?.trim() || 'data');
const LEGACY_FILE = path.join(dataDir, 'savepoint.json');

export const verbuddyUrl = () => (process.env.VERBUDDY_API_URL || '').trim().replace(/\/+$/, '');

/** A request to VerBuddy as the logged-in user. VerBuddy may need a while to wake up. */
function verbuddy(req, route, init = {}) {
  return fetch(`${verbuddyUrl()}/api/savepoint/${route}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${req.verbuddyToken}` },
    signal: AbortSignal.timeout(90_000),
  });
}

/**
 * Sends VerBuddy's answer on, compressed when the browser accepts it (the
 * library shrinks to about a quarter). 401 = the VerBuddy login expired.
 */
async function pass(r, req, res) {
  res.set('Cache-Control', 'no-store');
  if (r.status === 401) return res.status(401).json({ error: 'Not logged in.' });
  let body = Buffer.from(await r.arrayBuffer());
  if (body.length > 1024 && req.acceptsEncodings('gzip')) {
    body = await gzipAsync(body);
    res.set('Content-Encoding', 'gzip');
  }
  res.status(r.status).type('application/json').set('Vary', 'Accept-Encoding').send(body);
}

async function uploadLegacyFile(req) {
  let saved;
  try {
    saved = JSON.parse(await readFile(LEGACY_FILE, 'utf8'));
  } catch {
    return false;
  }
  const r = await verbuddy(req, 'state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRev: 0, version: saved.version, state: saved.state }),
  });
  if (!r.ok) return false;
  await rename(LEGACY_FILE, path.join(dataDir, 'savepoint.uploaded.json')).catch(() => {});
  console.log('Uploaded data/savepoint.json to VerBuddy (kept as data/savepoint.uploaded.json).');
  return true;
}

const unreachable = (res) =>
  res.status(502).json({ error: "Couldn't reach VerBuddy, where your library is stored. Try again in a moment." });

export const stateRouter = express.Router();

// A 404 from a VerBuddy without the Savepoint endpoints has no rev in it.
async function storageMissing(r) {
  if (r.status !== 404) return false;
  const body = await r
    .clone()
    .json()
    .catch(() => null);
  return typeof body?.rev !== 'number';
}

stateRouter.get('/api/state', async (req, res) => {
  try {
    let r = await verbuddy(req, 'state');
    if (await storageMissing(r)) {
      // Never fall back to the sample library: it could later be saved over your data.
      return res
        .status(502)
        .json({ error: "VerBuddy doesn't have Savepoint storage yet. Deploy the latest VerBuddy." });
    }
    if (r.status === 404 && (await uploadLegacyFile(req))) r = await verbuddy(req, 'state');
    await pass(r, req, res);
  } catch {
    unreachable(res);
  }
});

// Cheap check for "has another device saved since I loaded?".
stateRouter.get('/api/state/rev', async (req, res) => {
  try {
    await pass(await verbuddy(req, 'rev'), req, res);
  } catch {
    unreachable(res);
  }
});

// express.raw unpacks the browser's gzip; VerBuddy gets plain JSON.
stateRouter.put('/api/state', express.raw({ type: 'application/json', limit: '50mb' }), async (req, res) => {
  try {
    // While data/savepoint.json still waits to be uploaded, a first save from a
    // browser must not create the stored copy: 409 makes it reload, which uploads the file.
    const { baseRev } = JSON.parse(req.body.toString() || '{}');
    if (
      baseRev === 0 &&
      (await readFile(LEGACY_FILE).then(
        () => true,
        () => false,
      ))
    ) {
      return res.status(409).json({ rev: 0 });
    }
    const r = await verbuddy(req, 'state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: req.body,
    });
    await pass(r, req, res);
  } catch {
    unreachable(res);
  }
});
