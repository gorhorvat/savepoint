import { Avatar, Box, Group, Paper, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useMemo, useState, type ReactNode } from 'react';
import { ago, type Snapshot } from '../../lib/gameStats';
import { ahead, COMPARE, formatMetric, type Comparison, type HistoryLine } from '../../lib/compare';
import { TrendChart, type TrendPoint } from '../TrendChart';
import { Heading } from '../StatParts';

export const MINE = 'var(--mantine-primary-color-filled)';
export const THEIRS = 'var(--mantine-color-blue-5)';

/** A section of the comparison: a heading and its content. */
export function CompareSection({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>{title}</Title>
        {note && (
          <Text size="sm" c="dimmed">
            {note}
          </Text>
        )}
      </div>
      {children}
    </Stack>
  );
}

/** Two names at the top: you on the left (gold), them on the right (blue). */
export function Heads({ c }: { c: Comparison<never, never> }) {
  const spec = COMPARE[c.game];
  const side = (who: 'me' | 'them') => {
    const s = c[who];
    const user = who === 'me' ? c.me.user.username : c.them.kind === 'friend' ? c.them.user.username : null;
    const avatar =
      spec.avatar?.(s.data) ?? (who === 'me' ? c.me.user.avatar : c.them.kind === 'friend' ? c.them.user.avatar : null);
    const color = who === 'me' ? MINE : THEIRS;
    return (
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flexDirection: who === 'me' ? 'row' : 'row-reverse' }}>
        <Avatar src={avatar} size={48} radius="xl" style={{ border: `2px solid ${color}`, flexShrink: 0 }}>
          {(s.name ?? user ?? '?').slice(0, 2).toUpperCase()}
        </Avatar>
        <div style={{ minWidth: 0, textAlign: who === 'me' ? 'left' : 'right' }}>
          <Text className="display" fz={22} lh={1.1} truncate>
            {s.name ?? user}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {[user && user !== s.name ? user : null, spec.subtitle(s.data)].filter(Boolean).join(' · ') || ' '}
          </Text>
          <Text size="xs" c="dimmed">
            {s.fetchedAt ? `read ${ago(s.fetchedAt)}` : ''}
          </Text>
        </div>
      </Group>
    );
  };
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
      {side('me')}
      <Text c="dimmed" fw={700} size="sm" style={{ flexShrink: 0 }}>
        vs
      </Text>
      {side('them')}
    </Group>
  );
}

/** One row: my value, the label, their value; the one ahead in its colour. */
export function Row({
  label,
  mine,
  theirs,
  who,
}: {
  label: ReactNode;
  mine: ReactNode;
  theirs: ReactNode;
  /** 1: I'm ahead, -1: they are, 0: neither. */
  who: -1 | 0 | 1;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs" py={6} style={{ borderTop: '1px solid var(--sp-line)' }}>
      <Group gap={4} wrap="nowrap" style={{ flex: '1 1 0', minWidth: 0 }}>
        <Text component="div" className="num" fw={who === 1 ? 700 : 400} c={who === 1 ? undefined : 'dimmed'} truncate>
          {mine}
        </Text>
        {who === 1 && <IconChevronLeft size={14} style={{ color: MINE, flexShrink: 0 }} />}
      </Group>
      <Text component="div" size="sm" ta="center" style={{ flex: '1.6 1 0', minWidth: 0 }} lineClamp={2}>
        {label}
      </Text>
      <Group gap={4} wrap="nowrap" justify="flex-end" style={{ flex: '1 1 0', minWidth: 0 }}>
        {who === -1 && <IconChevronRight size={14} style={{ color: THEIRS, flexShrink: 0 }} />}
        <Text
          component="div"
          className="num"
          fw={who === -1 ? 700 : 400}
          c={who === -1 ? undefined : 'dimmed'}
          truncate
          ta="right"
        >
          {theirs}
        </Text>
      </Group>
    </Group>
  );
}

/** The headline numbers every game lists in lib/compare.ts. */
function Headline({ c }: { c: Comparison<never, never> }) {
  const spec = COMPARE[c.game];
  const rows = spec.metrics.map((m) => {
    const a = m.value(c.me.data);
    const b = m.value(c.them.data);
    return { m, a, b, who: ahead(m, a, b) };
  });
  const wins = rows.filter((r) => r.who === 1).length;
  const losses = rows.filter((r) => r.who === -1).length;
  return (
    <CompareSection
      title="Head to head"
      note={
        wins || losses
          ? `You're ahead on ${wins} of ${wins + losses} ${wins + losses === 1 ? 'number' : 'numbers'} that differ.`
          : 'Nothing to separate you yet.'
      }
    >
      <Paper p="md" radius="md">
        <Stack gap={0}>
          {rows.map(({ m, a, b, who }) => (
            <Row key={m.key} label={m.label} mine={formatMetric(m, a)} theirs={formatMetric(m, b)} who={who} />
          ))}
        </Stack>
      </Paper>
    </CompareSection>
  );
}

function series<S>(days: Snapshot<S>[], line: HistoryLine<S>): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (const d of days) {
    const value = line.value(d.data);
    if (value != null) out.push({ day: d.day, value });
  }
  return out;
}

/** Both progress lines on one graph, for a friend on Savepoint. */
function Progress({ c }: { c: Comparison<never, never> }) {
  const spec = COMPARE[c.game];
  const [key, setKey] = useState(spec.history[0]?.key ?? '');
  const line = spec.history.find((h) => h.key === key) ?? spec.history[0];
  const mine = useMemo(() => (line ? series(c.history.me, line) : []), [c.history.me, line]);
  const theirs = useMemo(() => (line && c.history.them ? series(c.history.them, line) : []), [c.history.them, line]);
  if (!line || c.them.kind !== 'friend') return null;
  const theirName = c.them.name ?? c.them.user.username;
  const myName = c.me.name ?? c.me.user.username;
  return (
    <CompareSection title="Progress" note="A point for each day either of you refreshed.">
      <Select
        data={spec.history.map((h) => ({ value: h.key, label: h.label }))}
        value={line.key}
        onChange={(v) => v && setKey(v)}
        allowDeselect={false}
        maw={280}
        size="sm"
      />
      <Paper p="md" radius="md">
        <TrendChart
          points={mine}
          other={theirs}
          labels={[myName, theirName]}
          format={line.format}
          tickFormat={line.tickFormat}
          yTicks={line.yTicks}
          empty="Not enough days on your side yet. Savepoint saves a point each day you refresh."
        />
      </Paper>
    </CompareSection>
  );
}

/** Two values side by side as a pair of bars, for a game's own sections. */
export function PairBars({ mine, theirs, max }: { mine: number; theirs: number; max: number }) {
  const w = (v: number) => `${Math.max(2, Math.min(100, (v / Math.max(1, max)) * 100))}%`;
  return (
    <Stack gap={3}>
      <Box h={6} style={{ background: 'var(--sp-line)', borderRadius: 3, overflow: 'hidden' }}>
        <Box h="100%" w={w(mine)} style={{ background: MINE, borderRadius: 3 }} />
      </Box>
      <Box h={6} style={{ background: 'var(--sp-line)', borderRadius: 3, overflow: 'hidden' }}>
        <Box h="100%" w={w(theirs)} style={{ background: THEIRS, borderRadius: 3 }} />
      </Box>
    </Stack>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <Heading>{children}</Heading>;
}

export function CompareView({
  c,
  extra,
}: {
  c: Comparison<never, never>;
  /** A game's own sections, between the headline and the progress graph. */
  extra?: ReactNode;
}) {
  return (
    <Stack gap={36}>
      <Heads c={c} />
      <Headline c={c} />
      {extra}
      <Progress c={c} />
      {c.them.kind === 'lookup' && (
        <Text size="xs" c="dimmed">
          Read from the game&apos;s public pages; Savepoint keeps it for a day. Progress graphs compare only with
          friends on Savepoint.
        </Text>
      )}
    </Stack>
  );
}

/** Small grid helper for a game's own sections. */
export const Cols = SimpleGrid;
