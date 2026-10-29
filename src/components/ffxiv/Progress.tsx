import { Loader, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { fetchGameHistory, type FfxivSnapshot, type Snapshot } from '../../lib/gameStats';
import { Section } from '../GameSection';
import { TrendChart, type TrendPoint } from '../TrendChart';

const series = (days: Snapshot<FfxivSnapshot>[], key: keyof FfxivSnapshot): TrendPoint[] =>
  days.filter((d) => d.data[key] != null).map((d) => ({ day: d.day, value: d.data[key] as number }));

const CHARTS: [string, keyof FfxivSnapshot][] = [
  ['Achievement points', 'points'],
  ['Achievements', 'achievements'],
  ['Average item level', 'itemLevel'],
  ['Job levels, all jobs added up', 'levels'],
  ['Jobs at the level cap', 'maxed'],
  ['Mounts', 'mounts'],
  ['Minions', 'minions'],
];

/** The character's numbers over time, one point per day it was refreshed. */
export function ProgressTab({ refreshedAt }: { refreshedAt: string }) {
  const [days, setDays] = useState<Snapshot<FfxivSnapshot>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGameHistory<FfxivSnapshot>('ffxiv')
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
        {CHARTS.filter(([, key]) => series(days, key).length).map(([title, key]) => (
          <Section key={key} title={title}>
            <TrendChart points={series(days, key)} />
          </Section>
        ))}
      </SimpleGrid>
      {!days.length && <Text c="dimmed">Nothing saved yet. Refresh to save today.</Text>}
    </Stack>
  );
}
