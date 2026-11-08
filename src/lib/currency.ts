// The currency prices are shown in (picked in Settings). Every price source
// answers in US dollars, so prices are converted with daily exchange rates
// from the server (/api/currency/rates, European Central Bank rates).
//
// Amounts you type yourself (price paid, most you'd pay, target price) are
// saved with the currency you typed them in, so they don't drift as rates
// move. Saved amounts without a currency are US dollars (from before this
// setting existed).
import { useEffect } from 'react';
import { create } from 'zustand';
import { useStore } from './store';

/** Currencies with a daily rate, most likely ones for Savepoint's friends first. */
export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US dollar' },
  { code: 'GBP', name: 'British pound' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'ISK', name: 'Icelandic króna' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'ZAR', name: 'South African rand' },
  { code: 'ILS', name: 'Israeli shekel' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'IDR', name: 'Indonesian rupiah' },
  { code: 'MYR', name: 'Malaysian ringgit' },
  { code: 'PHP', name: 'Philippine peso' },
];

export const DEFAULT_CURRENCY = 'USD';
const RATES_KEY = 'savepoint-rates';

type Rates = { date: string | null; rates: Record<string, number> } | null;

/** Exchange rates from US dollars; kept in the browser too so prices convert straight away. */
const useRates = create<{ rates: Rates }>(() => ({ rates: readSavedRates() }));

function readSavedRates(): Rates {
  try {
    const raw = localStorage.getItem(RATES_KEY);
    return raw ? (JSON.parse(raw) as Rates) : null;
  } catch {
    return null;
  }
}

let loading: Promise<void> | null = null;

/** Loads today's rates once per visit. Fails quietly: prices then stay in dollars. */
export function loadRates() {
  loading ??= fetch('/api/currency/rates')
    .then((r) => (r.ok ? r.json() : null))
    .then((body: { date?: string; rates?: Record<string, number> } | null) => {
      if (!body?.rates) return;
      const rates = { date: body.date ?? null, rates: { ...body.rates, USD: 1 } };
      useRates.setState({ rates });
      try {
        localStorage.setItem(RATES_KEY, JSON.stringify(rates));
      } catch {
        // Storage can be full or blocked; the rates still work for this visit.
      }
    })
    .catch(() => {});
  return loading;
}

/** The currency you picked, or US dollars. */
export const currentCurrency = () => useStore.getState().currency ?? DEFAULT_CURRENCY;

const rateOf = (code: string) => (code === 'USD' ? 1 : useRates.getState().rates?.rates[code]);

/** `amount` in `from` converted to `to`; null when a rate is missing. */
export function convert(amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  const a = rateOf(from);
  const b = rateOf(to);
  return a && b ? (amount / a) * b : null;
}

/** An amount in dollars, for comparing with prices (which are all in dollars). */
export function toUsd(amount: number, from = 'USD'): number {
  return convert(amount, from, 'USD') ?? amount;
}

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(code: string) {
  let f = formatters.get(code);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: 'currency', currency: code });
    formatters.set(code, f);
  }
  return f;
}

/**
 * "€17.19": an amount (in dollars unless `from` says otherwise) in your
 * currency. When the rate isn't known it's shown in its own currency.
 */
export function formatMoney(amount: number, from = 'USD'): string {
  if (amount === 0) return 'Free';
  const to = currentCurrency();
  const converted = convert(amount, from, to);
  return converted === null ? formatter(from).format(amount) : formatter(to).format(converted);
}

/** An amount saved in `from`, as a number in your currency (rounded to cents), for a form field. */
export function amountForInput(amount: number | undefined, from = 'USD'): number | undefined {
  if (amount === undefined) return undefined;
  const converted = convert(amount, from, currentCurrency());
  if (converted === null) return amount;
  const digits = formatter(currentCurrency()).resolvedOptions().maximumFractionDigits ?? 2;
  const f = 10 ** digits;
  return Math.round(converted * f) / f;
}

/**
 * Props for a money field: the symbol on the side your browser writes it
 * ({ prefix: '$' } or { suffix: ' €' }) and its decimal separator.
 */
export function currencyAffix(code = currentCurrency()): {
  prefix?: string;
  suffix?: string;
  decimalSeparator: string;
} {
  const decimalSeparator =
    formatter(code)
      .formatToParts(1.5)
      .find((p) => p.type === 'decimal')?.value ?? '.';
  const parts = formatter(code).formatToParts(1);
  const at = parts.findIndex((p) => p.type === 'currency');
  const symbol = parts[at]?.value ?? code;
  const firstNumber = parts.findIndex((p) => p.type === 'integer');
  const spaced = parts.some((p) => p.type === 'literal');
  if (at < firstNumber) return { prefix: spaced ? `${symbol} ` : symbol, decimalSeparator };
  return { suffix: ` ${symbol}`, decimalSeparator };
}

/** Digits after the decimal point in your currency (0 for yen and forint). */
export const currencyDecimals = (code = currentCurrency()) =>
  formatter(code).resolvedOptions().maximumFractionDigits ?? 2;

/** The date of the loaded rates and the currencies they cover (null until loaded). */
export function useRatesDate(): { date: string | null; codes: string[] | null } {
  const rates = useRates((s) => s.rates);
  return { date: rates?.date ?? null, codes: rates ? Object.keys(rates.rates) : null };
}

/**
 * Re-renders when the currency or rates change, and loads the rates. Use in
 * any component that shows prices; returns your currency's code.
 */
export function useCurrency(): string {
  const code = useStore((s) => s.currency ?? DEFAULT_CURRENCY);
  useRates((s) => s.rates);
  useEffect(() => {
    void loadRates();
  }, []);
  return code;
}
