// Number and name formatting for the League of Legends tab.

export const fmt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
export const pct = (w: number, l: number) => (w + l ? Math.round((w / (w + l)) * 100) : 0);
export const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
export const kda = (k: number, d: number, a: number) => (d ? ((k + a) / d).toFixed(2) : 'Perfect');
export const short = (n: number) =>
  Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n));
export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** "GOLD", "II" -> "Gold II"; Master and above have no division. */
export const rankName = (tier: string, division: string) =>
  ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier) ? title(tier) : `${title(tier)} ${division}`;

export const ROLES: Record<string, string> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'Bot',
  UTILITY: 'Support',
};

export const TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
];
const DIVISIONS = ['IV', 'III', 'II', 'I'];

/** The server's rank number (400 per tier, 100 per division, plus LP) as a name. */
export function ladderName(v: number) {
  if (v >= 2800) return `Master+ · ${Math.round(v - 2800)} LP`;
  const t = Math.max(0, Math.floor(v / 400));
  const d = Math.floor((v % 400) / 100);
  return `${title(TIERS[t])} ${DIVISIONS[d]} · ${Math.round(v % 100)} LP`;
}
/** Axis labels: a division at its boundary ("Gold II"), otherwise the full name. */
export const ladderTick = (v: number) =>
  v >= 2800
    ? `${Math.round(v - 2800)} LP`
    : v % 100 === 0
      ? `${title(TIERS[Math.floor(v / 400)] ?? '')} ${DIVISIONS[Math.floor((v % 400) / 100)]}`
      : `${title(TIERS[Math.floor(v / 400)] ?? '')} ${DIVISIONS[Math.floor((v % 400) / 100)]} ${Math.round(v % 100)}`;
/** Every division boundary from Iron IV to Master. */
export const LADDER_TICKS = Array.from({ length: 29 }, (_, i) => i * 100);

export const winColor = (win: boolean, remake = false) =>
  remake ? 'var(--mantine-color-dimmed)' : win ? 'var(--mantine-color-teal-5)' : 'var(--mantine-color-red-5)';
