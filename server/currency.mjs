// Exchange rates for showing prices in each account's own currency. Every price
// source Savepoint uses answers in US dollars, so prices are converted for
// display. Rates come from Frankfurter (European Central Bank reference rates,
// free, no key), refreshed twice a day and kept when a refresh fails.
import { query } from './db.mjs';
import { diskCache } from './diskCache.mjs';

const cache = diskCache('exchange-rates');
const FRESH_MS = 12 * 60 * 60_000;
let memory = null;

/** -> { base: 'USD', date, rates: { EUR: 0.86, … } } (rates include USD: 1), or null. */
export async function exchangeRates() {
  if (memory && Date.now() - memory.at < FRESH_MS) return memory.v;
  const saved =
    memory ??
    (await cache
      .get('usd')
      .then((v) => (v ? { at: v.at, v: v.data } : null))
      .catch(() => null));
  if (saved && Date.now() - saved.at < FRESH_MS) {
    memory = saved;
    return saved.v;
  }
  try {
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=USD', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    if (!body?.rates || typeof body.rates !== 'object') throw new Error('No rates');
    const data = { base: 'USD', date: body.date ?? null, rates: { ...body.rates, USD: 1 } };
    memory = { at: Date.now(), v: data };
    await cache.set('usd', { at: memory.at, data }).catch(() => {});
    return data;
  } catch {
    // Older rates beat none.
    if (saved) memory = { at: Date.now() - FRESH_MS + 30 * 60_000, v: saved.v };
    return saved?.v ?? null;
  }
}

/** The currency an account picked in Settings (saved with its app state), or USD. */
export async function userCurrency(userId) {
  const { rows } = await query(`SELECT "other_fields"->>'currency' AS "currency" FROM user_data WHERE "user_id" = $1`, [
    userId,
  ]).catch(() => ({ rows: [] }));
  const code = rows[0]?.currency;
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

/**
 * A money formatter for one account: (usd) => "€17.19". Falls back to dollars
 * when the rate isn't known.
 */
export async function moneyFor(userId) {
  const code = await userCurrency(userId);
  const rate = code === 'USD' ? 1 : (await exchangeRates())?.rates?.[code];
  const currency = rate ? code : 'USD';
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  return (usd) => (Number.isFinite(usd) ? fmt.format(usd * (rate || 1)) : '');
}
