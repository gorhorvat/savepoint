// Small formatters shared by the Counter-Strike 2 and Dota 2 stats tabs.

/** Win, loss and draw colours (the same as League of Legends). */
export const resultColor = (outcome: 'win' | 'loss' | 'tie' | string) =>
  outcome === 'win'
    ? 'var(--mantine-color-teal-5)'
    : outcome === 'loss'
      ? 'var(--mantine-color-red-5)'
      : 'var(--mantine-color-dimmed)';

export const num = (v: number | null | undefined, digits = 0) =>
  v == null ? '–' : v.toLocaleString(undefined, { maximumFractionDigits: digits });

export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
