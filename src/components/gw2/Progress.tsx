import { Loader, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { fetchGameHistory, type Gw2Snapshot, type Snapshot } from '../../lib/gameStats';
import { Section } from '../GameSection';
import { TrendChart, type TrendPoint } from '../TrendChart';
import { coinText } from './format';

const series = (days: Snapshot<Gw2Snapshot>[], key: keyof Gw2Snapshot): TrendPoint[] =>
  days.filter((d) => d.data[key] != null).map((d) => ({ day: d.day, value: d.data[key] as number }));
const gold = (v: number) => coinText(v);
const goldTick = (v: number) => `${Math.round(v / 10000).toLocaleString()}g`;

const CHARTS: [string, keyof Gw2Snapshot, ((v: number) => string)?, ((v: number) => string)?][] = [
  ['Account value (listed)', 'valueSell', gold, goldTick],
  ['Wallet gold', 'coins', gold, goldTick],
  ['Achievement points', 'ap'],
  ['Hours played', 'hours'],
  ['Fractal level', 'fractal'],
  ['WvW rank', 'wvwRank'],
  ['PvP rank', 'pvpRank'],
  ['Mastery points', 'masteryPoints'],
  ['Skins unlocked', 'skins'],
  ['Legendaries', 'legendaries'],
];

/** The account's numbers over time, one point per day it was refreshed. */
export function ProgressTab({ refreshedAt }: { refreshedAt: string }) {
  const [days, setDays] = useState<Snapshot<Gw2Snapshot>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGameHistory<Gw2Snapshot>('gw2')
      .then(setDays)
      .catch((e: Error) => setError(e.message));
  }, [refreshedAt]);

  if (error) return <Text c="red">{error}</Text>;
  if (!days) return <Loader size="sm" />;
  return (
    <Stack gap={48}>
      <Text size="sm" c="dimmed">
        Savepoint saves your numbers once a day when the tab refreshes, starting{' '}
        {days.length
          ? new Date(`${days[0].day}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })
          : 'today'}
        .
      </Text>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={48} verticalSpacing={48}>
        {CHARTS.filter(([, key]) => series(days, key).length).map(([title, key, format, tick]) => (
          <Section key={key} title={title}>
            <TrendChart points={series(days, key)} format={format} tickFormat={tick} />
          </Section>
        ))}
      </SimpleGrid>
      {!days.length && <Text c="dimmed">Nothing saved yet. Refresh to save today.</Text>}
    </Stack>
  );
}
