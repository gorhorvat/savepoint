import { Loader, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { fetchGameHistory, type LolSnapshot, type Snapshot } from '../../lib/gameStats';
import { Section } from '../GameSection';
import { TrendChart, type TrendPoint } from '../TrendChart';
import { LADDER_TICKS, ladderName, ladderTick } from './format';

const series = (days: Snapshot<LolSnapshot>[], key: keyof LolSnapshot): TrendPoint[] =>
  days.filter((d) => d.data[key] != null).map((d) => ({ day: d.day, value: d.data[key] as number }));

/** Rank, level, mastery and challenge points over time, one point per day you refreshed. */
export function ProgressTab({ refreshedAt }: { refreshedAt: string }) {
  const [days, setDays] = useState<Snapshot<LolSnapshot>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGameHistory<LolSnapshot>('lol')
      .then(setDays)
      .catch((e: Error) => setError(e.message));
  }, [refreshedAt]);

  if (error) return <Text c="red">{error}</Text>;
  if (!days) return <Loader size="sm" />;

  const solo = series(days, 'solo');
  const flex = series(days, 'flex');
  return (
    <Stack gap={48}>
      <Text size="sm" c="dimmed">
        Savepoint saves your numbers once a day when the tab refreshes, starting{' '}
        {days.length
          ? new Date(`${days[0].day}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })
          : 'today'}
        .
      </Text>
      {(solo.length > 0 || flex.length === 0) && (
        <Section title="Solo/Duo rank">
          <TrendChart
            points={solo}
            format={ladderName}
            tickFormat={ladderTick}
            yTicks={LADDER_TICKS}
            empty="No Solo/Duo rank saved yet."
          />
        </Section>
      )}
      {flex.length > 0 && (
        <Section title="Flex rank">
          <TrendChart points={flex} format={ladderName} tickFormat={ladderTick} yTicks={LADDER_TICKS} />
        </Section>
      )}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={48}>
        <Section title="Summoner level">
          <TrendChart points={series(days, 'level')} />
        </Section>
        <Section title="Mastery score">
          <TrendChart points={series(days, 'mastery')} />
        </Section>
        <Section title="Mastery points">
          <TrendChart points={series(days, 'masteryPoints')} />
        </Section>
        <Section title="Challenge points">
          <TrendChart points={series(days, 'challenges')} />
        </Section>
      </SimpleGrid>
    </Stack>
  );
}
