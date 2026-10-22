import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Small JSON caches. Locally they're files in .cache/ (outside server/, so
// writing them doesn't restart the dev server). On Vercel there's no lasting
// disk, so they go to Upstash Redis (one hash per cache, one field per key)
// when KV_REST_API_URL/KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* pair)
// are set. Entries carry their own timestamp for expiry.

/** Where file caches go: .cache/ locally, the temp dir on Vercel (read-only code dir, wiped between instances). */
export const CACHE_DIR = process.env.VERCEL
  ? path.join(tmpdir(), 'savepoint-cache')
  : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache');

const REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
const REDIS_TOKEN = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
export const redisConfigured = () => Boolean(REDIS_URL && REDIS_TOKEN);

/** One Redis command through Upstash's REST API. */
async function redis(...command) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Redis: HTTP ${r.status}`);
  return (await r.json()).result;
}

function redisCache(name) {
  const hash = `savepoint:cache:${name}`;
  return {
    async load(key) {
      const raw = await redis('HGET', hash, key).catch(() => null);
      return raw ? JSON.parse(raw) : undefined;
    },
    // Awaited: a serverless function may be frozen right after it answers.
    async store(key, entry) {
      await redis('HSET', hash, key, JSON.stringify(entry)).catch(() => {});
    },
  };
}

function fileCache(name) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  let data = null;
  let saving = null;

  async function all() {
    if (data) return data;
    try {
      data = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      data = {};
    }
    return data;
  }

  function save() {
    // Coalesce bursts of writes into one.
    saving ??= new Promise((resolve) =>
      setTimeout(async () => {
        saving = null;
        await mkdir(CACHE_DIR, { recursive: true }).catch(() => {});
        await writeFile(file, JSON.stringify(data)).catch(() => {});
        resolve();
      }, 500),
    );
    return saving;
  }

  return {
    async load(key) {
      return (await all())[key];
    },
    async store(key, entry) {
      (await all())[key] = entry;
      save();
    },
  };
}

export function diskCache(name, ttlMs) {
  const backend = redisConfigured() ? redisCache(name) : fileCache(name);
  return {
    /** The cached value, or undefined when missing or expired. */
    async get(key) {
      const hit = await backend.load(key);
      if (!hit || (ttlMs && Date.now() - hit.at > ttlMs)) return undefined;
      return hit.v;
    },
    async set(key, v) {
      await backend.store(key, { at: Date.now(), v });
    },
  };
}
