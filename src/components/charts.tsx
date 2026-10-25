import { Group, Stack, Text, Tooltip } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Small, dependency-free charts for the My Stats page. Marks follow the data
// viz rules: thin bars with rounded data ends, 2px surface gaps between
// segments, values on hover, text in text colors (never the series color).

export function StatTile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <Text size="sm" c="dimmed" fw={600}>
        {label}
      </Text>
      <Text className="display num" fz={40} lh={1.05} mt={2}>
        {value}
      </Text>
      {note && (
        <Text size="xs" c="dimmed" mt={4}>
          {note}
        </Text>
      )}
    </div>
  );
}

export interface Slice {
  label: string;
  value: number;
  /** CSS color (use a palette variable). */
  color: string;
  /** Text shown in the legend and tooltip, e.g. "412 h". */
  display: string;
}

/** Donut for part-to-whole (keep it to 6 slices or fewer), with a legend listing every value. */
export function Donut({ slices, center }: { slices: Slice[]; center?: ReactNode }) {
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const r = 70;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2.5 : 0;
  // Where each slice starts along the ring, worked out before rendering.
  const lengths = slices.map((s) => (s.value / total) * c);
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((n, l) => n + l, 0));
  return (
    <Group gap="xl" align="center" wrap="wrap" justify="center">
      <div style={{ position: 'relative', width: 190, height: 190, flexShrink: 0 }}>
        <svg viewBox="0 0 190 190" width="190" height="190" role="img" aria-label="Share chart">
          <g transform="rotate(-90 95 95)">
            {slices.map((s, i) => {
              const dash = Math.max(0.5, lengths[i] - gap);
              return (
                <Tooltip key={s.label} label={`${s.label}: ${s.display} (${Math.round((s.value / total) * 100)}%)`} withArrow>
                  <circle
                    cx="95"
                    cy="95"
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="24"
                    strokeDasharray={`${dash} ${c - dash}`}
                    strokeDashoffset={-starts[i]}
                    style={{ cursor: 'default' }}
                  />
                </Tooltip>
              );
            })}
          </g>
        </svg>
        {center && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            {center}
          </div>
        )}
      </div>
      <Stack gap={6} style={{ minWidth: 200, flex: '1 1 200px' }}>
        {slices.map((s) => (
          <Group key={s.label} gap={8} wrap="nowrap" justify="space-between">
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
              <Text size="sm" truncate>
                {s.label}
              </Text>
            </Group>
            <Text size="sm" c="dimmed" className="num" style={{ flexShrink: 0 }}>
              {s.display}, {Math.round((s.value / total) * 100)}%
            </Text>
          </Group>
        ))}
      </Stack>
    </Group>
  );
}

export interface Bar {
  label: string;
  value: number;
  display: string;
  href?: string;
  /** Optional leading element, e.g. a platform logo. */
  icon?: ReactNode;
  color?: string;
}

/** Horizontal bars, longest first: label above, value at the end of the row. */
export function BarList({ bars }: { bars: Bar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <Stack gap={10}>
      {bars.map((b) => (
        <div key={b.label}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              {b.icon}
              {b.href ? (
                <Text component={Link} to={b.href} size="sm" fw={500} truncate c="inherit" style={{ textDecoration: 'none' }}>
                  {b.label}
                </Text>
              ) : (
                <Text size="sm" fw={500} truncate>
                  {b.label}
                </Text>
              )}
            </Group>
            <Text size="sm" c="dimmed" className="num" style={{ flexShrink: 0 }}>
              {b.display}
            </Text>
          </Group>
          <Tooltip label={`${b.label}: ${b.display}`} withArrow>
            <div className="strip-track" style={{ height: 8, marginTop: 4 }}>
              <div
                style={{
                  width: `${Math.max(1.5, (b.value / max) * 100)}%`,
                  height: '100%',
                  borderRadius: '0 4px 4px 0',
                  background: b.color ?? 'var(--mantine-primary-color-filled)',
                }}
              />
            </div>
          </Tooltip>
        </div>
      ))}
    </Stack>
  );
}

/** Columns along a baseline. Only the tallest column carries a value label; the rest are on hover. */
export function Columns({ columns, height = 140 }: { columns: { label: string; value: number; display: string }[]; height?: number }) {
  const max = Math.max(1, ...columns.map((c) => c.value));
  const peak = columns.findIndex((c) => c.value === max && c.value > 0);
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
          alignItems: 'end',
          gap: 2,
          height,
          borderBottom: '1px solid var(--sp-line)',
        }}
      >
        {columns.map((c, i) => (
          <Tooltip key={c.label} label={`${c.label}: ${c.display}`} withArrow>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
              {i === peak && (
                <Text size="xs" c="dimmed" className="num" mb={2}>
                  {c.display}
                </Text>
              )}
              <div
                style={{
                  width: '100%',
                  maxWidth: 24,
                  height: `${(c.value / max) * (height - 22)}px`,
                  minHeight: c.value ? 3 : 0,
                  borderRadius: '4px 4px 0 0',
                  background: 'var(--mantine-primary-color-filled)',
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, gap: 2, marginTop: 6 }}>
        {columns.map((c) => (
          <Text key={c.label} size="xs" c="dimmed" ta="center" truncate>
            {c.label}
          </Text>
        ))}
      </div>
    </div>
  );
}
