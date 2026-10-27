// Postgres (Neon) connection, shared by login and library storage.
//
// .env: DATABASE_URL, the pooled connection string from the Neon console.
// The tables are created on first use (CREATE TABLE IF NOT EXISTS), so a new
// database needs no setup step.
import pg from 'pg';
import { SCHEMA } from './schema.mjs';

// Timestamps come back as ISO strings and dates as YYYY-MM-DD, the way the
// app stores them, instead of JavaScript Date objects.
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
pg.types.setTypeParser(1082, (v) => v); // date

export const dbConfigured = () => !!process.env.DATABASE_URL?.trim();

/**
 * Neon's connection strings say sslmode=require, which node-postgres already
 * treats as full certificate checking; spelling that out silences its warning.
 */
function connectionConfig() {
  const url = new URL(process.env.DATABASE_URL.trim());
  const config = {};
  if (['require', 'prefer', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')) {
    url.searchParams.set('sslmode', 'verify-full');
  }
  if (url.searchParams.get('channel_binding') === 'require') config.enableChannelBinding = true;
  url.searchParams.delete('channel_binding');
  return { ...config, connectionString: url.toString() };
}

let pool = null;
let schemaReady = null;

function getPool() {
  if (!dbConfigured()) throw new DbError('DATABASE_URL is not set in .env.');
  if (!pool) {
    pool = new pg.Pool({
      ...connectionConfig(),
      // Each Vercel instance handles one request at a time; locally a few
      // parallel reads make loading the library quicker.
      max: process.env.VERCEL ? 3 : 6,
      idleTimeoutMillis: 30_000,
      // Neon wakes a sleeping database in about a second; allow for a slow one.
      connectionTimeoutMillis: 20_000,
    });
    // Neon closes idle connections; the pool replaces them on the next query.
    pool.on('error', (err) => console.error('Database connection dropped:', err.message));
  }
  return pool;
}

export class DbError extends Error {}

/** Creates any missing tables, once per server start. */
export function ensureSchema() {
  schemaReady ??= getPool()
    .query(SCHEMA)
    .catch((err) => {
      schemaReady = null; // Try again on the next request.
      throw err;
    });
  return schemaReady;
}

export async function query(text, params) {
  await ensureSchema();
  return getPool().query(text, params);
}

/** Runs fn(client) in one transaction; rolled back if it throws. */
export async function transaction(fn) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** For scripts: lets the process exit. */
export async function closeDb() {
  await pool?.end();
  pool = null;
  schemaReady = null;
}
