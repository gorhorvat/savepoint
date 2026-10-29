// Formatting for the Guild Wars 2 tab.

export const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
export const pct = (a: number, b: number | null | undefined) => (b ? Math.round((a / b) * 100) : 0);
export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** Copper as "1,234g 5s 6c" (10000 copper = 1 gold). */
export function coinText(copper: number) {
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  return g ? `${g.toLocaleString()}g ${s}s` : `${s}s ${Math.round(copper % 100)}c`;
}

/** Item rarity colours as the game shows them. */
export const RARITY: Record<string, string> = {
  Junk: '#aaaaaa',
  Basic: '#c8c8c8',
  Fine: '#62a4da',
  Masterwork: '#1a9306',
  Rare: '#fcd00b',
  Exotic: '#ffa405',
  Ascended: '#fb3e8d',
  Legendary: '#9a4ce6',
};

/** Whole gold, for big numbers. */
export const goldText = (copper: number) => `${Math.floor(copper / 10000).toLocaleString()}g`;
