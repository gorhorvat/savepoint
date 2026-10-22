// One-time copy of the local .cache/*.json caches into Upstash Redis, so the
// deployed app starts with everything already looked up (OpenCritic's free
// quota is only 25 searches a day). Existing Redis entries are overwritten.
// The Steam app list is skipped: it's re-downloaded on Vercel when needed.
//
//   node --env-file=.env.vercel scripts/seed-redis.mjs
//
// Needs KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* pair).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
if (!url || !token) {
  console.error('Set KV_REST_API_URL and KV_REST_API_TOKEN first.');
  process.exit(1);
}

async function redis(...command) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error(`Redis: HTTP ${r.status}`);
  return (await r.json()).result;
}

const dir = '.cache';
for (const file of await readdir(dir)) {
  if (!file.endsWith('.json') || file.startsWith('steam-apps')) continue;
  const name = path.basename(file, '.json');
  const entries = Object.entries(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
  // HSET in batches of about 500 KB.
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (batch.length) await redis('HSET', `savepoint:cache:${name}`, ...batch);
    batch = [];
    size = 0;
  };
  for (const [key, entry] of entries) {
    const value = JSON.stringify(entry);
    batch.push(key, value);
    size += value.length;
    if (size > 500_000) await flush();
  }
  await flush();
  console.log(`${name}: ${entries.length} entries`);
}
