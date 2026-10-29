import { Group, Loader, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconArrowDown } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchLolChampions, type LolChampionStats, type LolGroupStats, type LolPlayer } from '../../lib/gameStats';
import { BarList } from '../charts';
import { Section } from '../GameSection';
import { Champ, Meter } from './common';
import { day, fmt, kda, pct, ROLES } from './format';

type Row = LolChampionStats['champions'][number];
type SortKey = 'games' | 'winrate' | 'kda' | 'cs' | 'dmg' | 'gold' | 'kp' | 'mastery' | 'last';

const per = (g: LolGroupStats, n: number) => n / Math.max(1, g.minutes);

/** Per-champion and per-role numbers from the whole match archive, and every champion's mastery. */
export function ChampionsTab({ player }: { player: LolPlayer }) {
  const [queue, setQueue] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; stats: LolChampionStats } | null>(null);
  const [queues, setQueues] = useState<{ value: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('games');
  const [search, setSearch] = useState('');

  const key = `${queue}|${player.archive?.count}`;
  const stats = result?.key === key ? result.stats : null;

  useEffect(() => {
    let alive = true;
    fetchLolChampions(queue ? Number(queue) : null)
      .then((s) => {
        if (!alive) return;
        setResult({ key: `${queue}|${player.archive?.count}`, stats: s });
        if (!queue) setQueues(s.queues.map((q) => ({ value: String(q.queueId), label: `${q.name} (${q.games})` })));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [queue, player.archive?.count]);

  const mastery = useMemo(() => new Map(player.mastery.top.map((m) => [m.championId, m])), [player.mastery.top]);

  const rows = useMemo(() => {
    if (!stats) return [];
    const value = (c: Row): number => {
      switch (sort) {
        case 'winrate':
          return c.wins / c.games + c.games / 1e6;
        case 'kda':
          return (c.k + c.a) / Math.max(1, c.d);
        case 'cs':
          return per(c, c.cs);
        case 'dmg':
          return per(c, c.dmg);
        case 'gold':
          return per(c, c.gold);
        case 'kp':
          return c.kp ?? 0;
        case 'mastery':
          return mastery.get(c.championId)?.points ?? 0;
        case 'last':
          return c.last ? new Date(c.last).getTime() : 0;
        default:
          return c.games;
      }
    };
    return [...stats.champions].sort((a, b) => value(b) - value(a));
  }, [stats, sort, mastery]);

  const head = (key: SortKey, label: string) => (
    <Table.Th ta={key === 'games' ? undefined : 'right'}>
      <UnstyledButton onClick={() => setSort(key)} aria-label={`Sort by ${label}`}>
        <Group gap={2} wrap="nowrap" justify="flex-end">
          <Text size="xs" fw={sort === key ? 700 : 500} c={sort === key ? undefined : 'dimmed'}>
            {label}
          </Text>
          {sort === key && <IconArrowDown size={12} />}
        </Group>
      </UnstyledButton>
    </Table.Th>
  );

  const shownMastery = player.mastery.top.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Stack gap={48}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Text size="sm" c="dimmed">
            {stats
              ? `${fmt(stats.games)} games from your saved matches${player.archive && !player.archive.complete ? ' (older ones are still being added)' : ''}. Remakes left out.`
              : ' '}
          </Text>
          <Select
            placeholder="All queues"
            data={queues}
            value={queue}
            onChange={setQueue}
            clearable
            w={240}
            aria-label="Queue"
          />
        </Group>
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        {!stats ? (
          <Loader size="sm" />
        ) : !stats.champions.length ? (
          <Text c="dimmed">No games here yet.</Text>
        ) : (
          <Paper p={0} style={{ overflowX: 'auto' }}>
            <Table verticalSpacing={6} horizontalSpacing="sm" miw={820} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>
                    <Text size="xs" c="dimmed">
                      Champion
                    </Text>
                  </Table.Th>
                  {head('games', 'Games')}
                  {head('winrate', 'Win rate')}
                  {head('kda', 'KDA')}
                  {head('cs', 'CS/min')}
                  {head('dmg', 'Dmg/min')}
                  {head('gold', 'Gold/min')}
                  {head('kp', 'KP')}
                  {head('mastery', 'Mastery')}
                  {head('last', 'Last played')}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((c) => {
                  const m = mastery.get(c.championId);
                  return (
                    <Table.Tr key={c.championId}>
                      <Table.Td>
                        <Group gap={8} wrap="nowrap">
                          <Champ image={c.image} size={26} />
                          <Text size="sm" fw={600}>
                            {c.name}
                          </Text>
                          {c.pentas > 0 && (
                            <Text size="xs" c="dimmed">
                              {c.pentas} penta{c.pentas > 1 ? 's' : ''}
                            </Text>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {c.games}
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {pct(c.wins, c.games - c.wins)}%
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {kda(c.k, c.d, c.a)}
                        <Text size="xs" c="dimmed" className="num">
                          {(c.k / c.games).toFixed(1)}/{(c.d / c.games).toFixed(1)}/{(c.a / c.games).toFixed(1)}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {per(c, c.cs).toFixed(1)}
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {fmt(per(c, c.dmg))}
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {fmt(per(c, c.gold))}
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {c.kp != null ? `${Math.round(c.kp * 100)}%` : '—'}
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {m ? `${fmt(m.points)}` : '—'}
                        {m && (
                          <Text size="xs" c="dimmed">
                            level {m.level}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">{c.last ? day(c.last) : '—'}</Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </Stack>

      {stats && stats.roles.length > 0 && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
          <Section title="Roles" note="Games per position, with win rate and KDA.">
            <BarList
              bars={stats.roles.map((r) => ({
                label: ROLES[r.role] ?? r.role,
                value: r.games,
                display: `${r.games} games · ${pct(r.wins, r.games - r.wins)}% · ${kda(r.k, r.d, r.a)} KDA`,
              }))}
            />
          </Section>
          <Section title="Queues" note="Games per queue, with win rate.">
            <BarList
              bars={stats.queues.map((q) => ({
                label: q.name,
                value: q.games,
                display: `${q.games} games · ${pct(q.wins, q.games - q.wins)}%`,
              }))}
            />
          </Section>
        </SimpleGrid>
      )}

      <Section
        title="Champion mastery"
        note={`${fmt(player.mastery.champions)} champions · ${fmt(player.mastery.points)} points · mastery score ${fmt(player.mastery.score)}.`}
      >
        <TextInput
          placeholder="Find a champion"
          aria-label="Find a champion"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          maw={280}
          mb="md"
        />
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={14}>
          {shownMastery.map((c) => {
            const toNext = c.untilLevel != null && c.sinceLevel != null && c.untilLevel > 0;
            return (
              <div key={c.championId}>
                <Group justify="space-between" gap="sm" wrap="nowrap">
                  <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                    <Champ image={c.image} />
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>
                        {c.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Level {c.level}
                        {c.lastPlayed ? ` · played ${day(c.lastPlayed)}` : ''}
                      </Text>
                    </div>
                  </Group>
                  <Text size="sm" className="num" style={{ flexShrink: 0 }}>
                    {fmt(c.points)}
                  </Text>
                </Group>
                {toNext && (
                  <div style={{ marginTop: 6 }}>
                    <Meter value={c.sinceLevel!} max={c.sinceLevel! + c.untilLevel!} />
                    <Text size="10px" c="dimmed" mt={2}>
                      {fmt(c.untilLevel)} points to level {c.level + 1}
                    </Text>
                  </div>
                )}
              </div>
            );
          })}
        </SimpleGrid>
      </Section>
    </Stack>
  );
}
