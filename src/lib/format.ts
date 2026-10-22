export function hours(minutes: number): number {
  return minutes / 60;
}

/** "212 h", "6.5 h", "40 min" */
export function formatPlaytime(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return `${h >= 10 ? Math.round(h).toLocaleString() : (Math.round(h * 10) / 10).toString()} h`;
}

/** Just the number part, for big display figures. */
export function formatHoursNumber(minutes: number): string {
  const h = minutes / 60;
  return h >= 10 ? Math.round(h).toLocaleString() : (Math.round(h * 10) / 10).toString();
}

const monthYear = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/** Mid-sentence form: "today", "3 days ago", "21 Aug", "Feb 2025". */
export function formatLastPlayed(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 300) return dayMonth.format(d);
  return monthYear.format(d);
}

export function formatPrice(usd: number): string {
  if (usd === 0) return 'Free';
  return `$${usd.toFixed(2)}`;
}

/**
 * "Out 14 Oct 2027", "Out Q4 2027", "Coming soon" for unreleased games;
 * null once a game is out.
 */
export function upcomingLabel(game: {
  releaseDate?: string;
  releaseLabel?: string;
  comingSoon?: boolean;
}): string | null {
  const future = game.releaseDate ? Date.parse(game.releaseDate) > Date.now() : false;
  if (!game.comingSoon && !future) return null;
  const label = game.releaseLabel ?? (game.releaseDate ? fullDate.format(new Date(game.releaseDate)) : null);
  if (!label || /coming soon|tba|tbd/i.test(label)) return label ?? 'Coming soon';
  return `Out ${label}`;
}

const fullDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
