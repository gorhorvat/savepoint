// Price alerts, per account. The app sends its wishlist target prices here; the
// server checks them (daily on Vercel through Cron, every six hours when run
// locally) and sends a push notification through ntfy (https://ntfy.sh) when a
// game drops to or below its target.
//
// Each account turns alerts on in Settings, which gives it its own random ntfy
// topic; the person subscribes to that topic in the free ntfy app. The topic
// name works like a password (anyone who knows it can read the alerts), so
// it's long and random, and can be replaced with a new one at any time.
import { randomBytes } from 'node:crypto';
import { query } from './db.mjs';
import { itadDeal } from './itad.mjs';
import { nintendoPrice } from './search.mjs';

const EVERY = 6 * 3600 * 1000;
let timer = null;

export async function notify(topic, { title, message, url }) {
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: {
      // Header values must be plain ASCII.
      Title: title.replace(/[^\x20-\x7e]/g, ''),
      Tags: 'video_game',
      ...(url && { Click: url }),
    },
    body: message,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`ntfy answered ${r.status}`);
}

// ---------------------------------------------------------------- topics

/** The account's ntfy topic, or null when alerts are off. */
export async function alertTopic(userId) {
  const { rows } = await query('SELECT "topic" FROM alert_topics WHERE "user_id" = $1', [userId]);
  return rows[0]?.topic ?? null;
}

/** Turns alerts on with a new random topic (replacing any old one). Returns it. */
export async function newAlertTopic(userId) {
  const topic = `savepoint-${randomBytes(15).toString('base64url').replace(/[-_]/g, 'x')}`;
  await query(
    `INSERT INTO alert_topics ("user_id", "topic") VALUES ($1, $2)
     ON CONFLICT ("user_id") DO UPDATE SET "topic" = EXCLUDED."topic", "created_at" = now()`,
    [userId, topic],
  );
  return topic;
}

export async function turnOffAlerts(userId) {
  await query('DELETE FROM alert_topics WHERE "user_id" = $1', [userId]);
}

// ---------------------------------------------------------------- watched games

/** Replaces the account's watched games (from its wishlist targets), then checks them. */
export async function setAlerts(userId, items) {
  await query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
         "id" text, "title" text, "steamAppId" integer, "nsuid" text, "pc" boolean, "switch" boolean, "target" double precision)
     ), removed AS (
       DELETE FROM price_alerts WHERE "user_id" = $1 AND "game_id" NOT IN (SELECT "id" FROM incoming)
     )
     INSERT INTO price_alerts ("user_id", "game_id", "title", "steam_app_id", "nsuid", "pc", "switch", "target")
     SELECT $1, "id", "title", "steamAppId", "nsuid", "pc", "switch", "target" FROM incoming
     ON CONFLICT ("user_id", "game_id") DO UPDATE SET
       "title" = EXCLUDED."title", "steam_app_id" = EXCLUDED."steam_app_id", "nsuid" = EXCLUDED."nsuid",
       "pc" = EXCLUDED."pc", "switch" = EXCLUDED."switch", "target" = EXCLUDED."target",
       -- A new target can be notified about again.
       "last_sent_price" = CASE WHEN price_alerts."target" = EXCLUDED."target" THEN price_alerts."last_sent_price" END`,
    [userId, JSON.stringify(items)],
  );
  return checkAlerts({ userId });
}

export async function watchedCount(userId) {
  const { rows } = await query('SELECT count(*)::int AS n FROM price_alerts WHERE "user_id" = $1', [userId]);
  return rows[0].n;
}

// ---------------------------------------------------------------- checking

/** Best current price: IsThereAnyDeal for PC, the eShop for Switch. */
async function bestPrice(item) {
  const options = [];
  if (item.pc) {
    const d = await itadDeal({ title: item.title, steamAppId: item.steam_app_id ?? undefined }).catch(() => null);
    if (d?.current) options.push({ price: d.current.price, where: d.current.shop, url: d.current.url });
  }
  if (item.switch) {
    const e = await nintendoPrice(item.title, item.nsuid ?? undefined).catch(() => null);
    if (e) options.push({ price: e.price, where: 'Nintendo eShop', url: e.url });
  }
  return options.sort((a, b) => a.price - b.price)[0] ?? null;
}

/**
 * Checks the watched games of every account with alerts on (or just `userId`)
 * and notifies each account about its own. Each game's price is looked up once
 * per check, however many accounts watch it.
 */
export async function checkAlerts({ userId = null } = {}) {
  const { rows } = await query(
    `SELECT a.*, t."topic" FROM price_alerts a JOIN alert_topics t USING ("user_id")
     WHERE $1::integer IS NULL OR a."user_id" = $1`,
    [userId],
  );
  const prices = new Map();
  let sent = 0;
  for (const item of rows) {
    const key = `${item.game_id}|${item.pc}|${item.switch}`;
    if (!prices.has(key)) prices.set(key, await bestPrice(item));
    const best = prices.get(key);
    let lastSent = item.last_sent_price;
    if (!best || best.price > item.target) {
      // Back above target: a new drop can be notified again.
      lastSent = null;
    } else if (lastSent == null || best.price < lastSent) {
      // Only notify again if the price fell further since the last alert.
      const ok = await notify(item.topic, {
        title: `${item.title}: $${best.price.toFixed(2)}`,
        message: `${item.title} is $${best.price.toFixed(2)} at ${best.where}, at or below your $${item.target.toFixed(2)} target.`,
        url: best.url,
      }).then(
        () => true,
        () => false,
      );
      if (ok) {
        lastSent = best.price;
        sent++;
      }
    }
    if (lastSent !== item.last_sent_price) {
      await query('UPDATE price_alerts SET "last_sent_price" = $3 WHERE "user_id" = $1 AND "game_id" = $2', [
        item.user_id,
        item.game_id,
        lastSent,
      ]);
    }
  }
  return { checked: rows.length, sent };
}

/** Local runs only; on Vercel a daily Cron job calls /api/cron/alerts instead. */
export function startAlertTimer() {
  if (timer) return;
  timer = setInterval(() => void checkAlerts().catch(() => {}), EVERY);
  // First check shortly after the server starts.
  setTimeout(() => void checkAlerts().catch(() => {}), 60_000);
}
