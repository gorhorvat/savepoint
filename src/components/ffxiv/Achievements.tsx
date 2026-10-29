import { Group, Loader, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { fetchFfxivAchievements, type FfxivCharacter } from '../../lib/gameStats';
import { Columns, StatTile } from '../charts';
import { Section } from '../GameSection';

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
const PAGE = 100;

/** Every achievement the Lodestone lists, by month and searchable. */
export function AchievementsTab({ ch, refreshedAt }: { ch: FfxivCharacter; refreshedAt: string }) {
  const a = ch.achievements;
  const [list, setList] = useState<{ id: number | null; name: string; time: string | null }[] | null>(null);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!a.public) return;
    fetchFfxivAchievements()
      .then((r) => {
        setList(r.achievements);
        setComplete(r.complete);
      })
      .catch((e: Error) => setError(e.message));
  }, [a.public, refreshedAt]);

  const months = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of list ?? []) if (e.time) counts.set(e.time.slice(0, 7), (counts.get(e.time.slice(0, 7)) ?? 0) + 1);
    const now = new Date(refreshedAt);
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 23 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const n = counts.get(key) ?? 0;
      return {
        label: d.toLocaleDateString(undefined, { month: 'short', ...(d.getMonth() === 0 ? { year: '2-digit' } : {}) }),
        value: n,
        display: `${n} in ${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`,
      };
    });
  }, [list, refreshedAt]);

  const filtered = useMemo(
    () => (list ?? []).filter((e) => e.name.toLowerCase().includes(search.trim().toLowerCase())),
    [list, search],
  );

  if (!a.public) {
    return (
      <Text c="dimmed">
        This character&apos;s achievements are private. Make them public in the Lodestone&apos;s character settings,
        then refresh.
      </Text>
    );
  }

  return (
    <Stack gap={48}>
      <SimpleGrid cols={{ base: 2, md: 3 }} spacing="md">
        <StatTile label="Achievements" value={fmt(a.total)} />
        <StatTile label="Achievement points" value={fmt(a.points)} />
        <StatTile
          label="History read"
          value={list ? fmt(list.length) : '—'}
          note={complete ? 'Everything the Lodestone lists' : 'More is read with each refresh'}
        />
      </SimpleGrid>
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      {!list ? (
        <Loader size="sm" />
      ) : (
        <>
          <Section title="Earned per month" note="The last two years.">
            <Columns columns={months} />
          </Section>
          <Section title="History" note="Newest first, with the date each was earned.">
            <TextInput
              placeholder="Find an achievement"
              aria-label="Find an achievement"
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                setShown(PAGE);
              }}
              maw={320}
              mb="md"
            />
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={40} verticalSpacing={4}>
              {filtered.slice(0, shown).map((e, i) => (
                <Group key={`${e.id}-${i}`} justify="space-between" gap="sm" wrap="nowrap" mih={22}>
                  <Text size="sm" truncate>
                    {e.name}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {e.time
                      ? new Date(e.time).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : ''}
                  </Text>
                </Group>
              ))}
            </SimpleGrid>
            {filtered.length > shown && (
              <Text
                component="button"
                type="button"
                size="sm"
                mt="md"
                c="var(--mantine-primary-color-filled)"
                onClick={() => setShown(shown + PAGE)}
                style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
              >
                Show more ({fmt(filtered.length - shown)} left)
              </Text>
            )}
            {!filtered.length && <Text c="dimmed">No achievements match.</Text>}
          </Section>
        </>
      )}
    </Stack>
  );
}
