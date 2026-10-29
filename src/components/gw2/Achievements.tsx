import { Group, SimpleGrid, Stack, Text } from '@mantine/core';
import type { Gw2Account } from '../../lib/gameStats';
import { StatTile } from '../charts';
import { Section } from '../GameSection';
import { Meter } from '../StatParts';
import { fmt, pct } from './format';
import { Img } from './parts';

/** Achievement points, progress per category, and what is closest to done. */
export function AchievementsTab({ a }: { a: Gw2Account }) {
  if (a.achievementsDone == null) return <Text c="dimmed">Needs the progression permission on the API key.</Text>;
  const totalDone = a.achievementGroups?.reduce((n, g) => n + g.categories.reduce((m, c) => m + c.done, 0), 0) ?? null;
  const total = a.achievementGroups?.reduce((n, g) => n + g.categories.reduce((m, c) => m + c.total, 0), 0) ?? null;
  return (
    <Stack gap={48}>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatTile label="Achievement points" value={fmt(a.ap?.total)} note="Worked out from your achievements" />
        <StatTile label="From achievements" value={fmt(a.ap?.fromAchievements)} />
        <StatTile
          label="Daily and monthly"
          value={fmt(a.ap ? a.ap.daily + a.ap.monthly : null)}
          note="Points from the old dailies"
        />
        <StatTile
          label="Achievements done"
          value={fmt(a.achievementsDone)}
          note={total ? `${fmt(totalDone)} of ${fmt(total)} in categories (${pct(totalDone ?? 0, total)}%)` : undefined}
        />
      </SimpleGrid>

      {!!a.nearlyDone?.length && (
        <Section title="Almost done" note="Achievements in progress, closest to finishing first.">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={32} verticalSpacing={14}>
            {a.nearlyDone.map((x) => (
              <div key={x.id}>
                <Group justify="space-between" gap="sm" wrap="nowrap">
                  <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                    {x.icon && <Img src={x.icon} size={22} />}
                    <Text size="sm" fw={600} truncate>
                      {x.name}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed" className="num" style={{ flexShrink: 0 }}>
                    {fmt(x.current)} / {fmt(x.max)}
                    {x.points ? ` · ${x.points} AP left` : ''}
                  </Text>
                </Group>
                <div style={{ marginTop: 4 }}>
                  <Meter value={x.current} max={x.max} />
                </div>
                {x.requirement && (
                  <Text size="xs" c="dimmed" mt={2} lineClamp={1}>
                    {x.requirement}
                  </Text>
                )}
              </div>
            ))}
          </SimpleGrid>
        </Section>
      )}

      {a.achievementGroups?.map((g) => (
        <Section key={g.name} title={g.name}>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={12}>
            {g.categories.map((c) => (
              <div key={c.id}>
                <Group justify="space-between" gap="sm" wrap="nowrap">
                  <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                    <Img src={c.icon} size={18} />
                    <Text size="sm" truncate>
                      {c.name}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed" className="num" style={{ flexShrink: 0 }}>
                    {c.done} / {c.total}
                  </Text>
                </Group>
                <div style={{ marginTop: 4 }}>
                  <Meter value={c.done} max={c.total} />
                </div>
              </div>
            ))}
          </SimpleGrid>
        </Section>
      ))}
    </Stack>
  );
}
