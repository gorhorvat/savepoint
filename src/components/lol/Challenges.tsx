import { Badge, Group, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useMemo, useState } from 'react';
import type { LolPlayer } from '../../lib/gameStats';
import { StatTile } from '../charts';
import { Meter } from './common';
import { fmt, title } from './format';

const LEVELS = [
  'NONE',
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
];
const PAGE = 60;

/** Every challenge: level, progress to the next level, and how rare it is. */
export function ChallengesTab({ player }: { player: LolPlayer }) {
  const c = player.challenges;
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<string | null>(null);
  const [sort, setSort] = useState('closest');
  const [shown, setShown] = useState(PAGE);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (c?.list ?? []).filter(
      (x) =>
        (!q || x.name.toLowerCase().includes(q) || x.description.toLowerCase().includes(q)) &&
        (!level || x.level === level),
    );
    const progress = (x: (typeof rows)[number]) => (x.next ? x.value / x.next.value : -1);
    return rows.sort((a, b) =>
      sort === 'level'
        ? LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || (a.percentile ?? 1) - (b.percentile ?? 1)
        : sort === 'rare'
          ? (a.percentile ?? 1) - (b.percentile ?? 1)
          : progress(b) - progress(a) || a.name.localeCompare(b.name),
    );
  }, [c, search, level, sort]);

  if (!c) return <Text c="dimmed">Riot has no challenge data for this player.</Text>;

  const levels = LEVELS.filter((l) => c.list?.some((x) => x.level === l)).map((l) => ({
    value: l,
    label: `${l === 'NONE' ? 'Not started' : title(l)} (${c.list!.filter((x) => x.level === l).length})`,
  }));
  const top = (p: number | null | undefined) => (p != null ? `top ${Math.max(0.1, p * 100).toFixed(1)}%` : null);

  return (
    <Stack gap="xl">
      <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }} spacing="md">
        <StatTile
          label="Total"
          value={c.level ? title(c.level) : '—'}
          note={[`${fmt(c.points)}${c.max ? ` / ${fmt(c.max)}` : ''}`, top(c.percentile)].filter(Boolean).join(' · ')}
        />
        {c.categories.map((k) => (
          <StatTile
            key={k.name}
            label={k.name}
            value={k.level ? title(k.level) : '—'}
            note={[`${fmt(k.points)}${k.max ? ` / ${fmt(k.max)}` : ''}`, top(k.percentile)].filter(Boolean).join(' · ')}
          />
        ))}
      </SimpleGrid>

      {!c.list?.length ? (
        <Text size="sm" c="dimmed">
          Refresh to load each challenge.
        </Text>
      ) : (
        <>
          <Group gap="sm" wrap="wrap" align="flex-end">
            <TextInput
              placeholder="Find a challenge"
              aria-label="Find a challenge"
              value={search}
              onChange={(e) => {
                setSearch(e.currentTarget.value);
                setShown(PAGE);
              }}
              w={240}
            />
            <Select
              placeholder="Any level"
              data={levels}
              value={level}
              onChange={setLevel}
              clearable
              w={200}
              aria-label="Level"
            />
            <SegmentedControl
              value={sort}
              onChange={setSort}
              data={[
                { value: 'closest', label: 'Closest to next' },
                { value: 'level', label: 'Highest' },
                { value: 'rare', label: 'Rarest' },
              ]}
            />
          </Group>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={32} verticalSpacing={16}>
            {list.slice(0, shown).map((x) => (
              <div key={x.id}>
                <Group justify="space-between" gap="sm" wrap="nowrap" align="flex-start">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600}>
                      {x.name}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {x.description}
                    </Text>
                  </div>
                  <Badge
                    variant={x.level === 'NONE' ? 'outline' : 'light'}
                    color="gray"
                    radius="xs"
                    style={{ flexShrink: 0 }}
                  >
                    {x.level === 'NONE' ? 'Not started' : title(x.level)}
                  </Badge>
                </Group>
                <div style={{ marginTop: 6 }}>
                  <Meter value={x.value} max={x.next?.value ?? x.value} />
                </div>
                <Text size="xs" c="dimmed" mt={2} className="num">
                  {fmt(x.value)}
                  {x.next ? ` / ${fmt(x.next.value)} for ${title(x.next.level)}` : ' · highest level'}
                  {x.percentile != null && x.level !== 'NONE' ? ` · ${top(x.percentile)} of players` : ''}
                </Text>
              </div>
            ))}
          </SimpleGrid>
          {list.length > shown && (
            <Text
              component="button"
              type="button"
              size="sm"
              c="var(--mantine-primary-color-filled)"
              onClick={() => setShown(shown + PAGE)}
              style={{ background: 'none', border: 0, cursor: 'pointer', alignSelf: 'flex-start', padding: 0 }}
            >
              Show more ({list.length - shown} left)
            </Text>
          )}
          {!list.length && <Text c="dimmed">No challenges match.</Text>}
        </>
      )}
    </Stack>
  );
}
