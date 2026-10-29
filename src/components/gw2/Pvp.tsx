import { SimpleGrid, Stack, Table, Text } from '@mantine/core';
import type { Gw2Account } from '../../lib/gameStats';
import { BarList, StatTile } from '../charts';
import { Section } from '../GameSection';
import { Line } from '../StatParts';
import { fmt, pct } from './format';

/** Structured PvP and World vs. World. */
export function PvpTab({ a }: { a: Gw2Account }) {
  const p = a.pvp;
  return (
    <Stack gap={48}>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatTile label="PvP rank" value={p ? fmt(p.rank) : '—'} />
        <StatTile
          label="PvP games"
          value={p ? fmt(p.wins + p.losses) : '—'}
          note={p ? `${fmt(p.wins)}W ${fmt(p.losses)}L (${pct(p.wins, p.wins + p.losses)}%)` : undefined}
        />
        <StatTile
          label="Ranked rating"
          value={p?.standing?.rating != null ? fmt(p.standing.rating) : '—'}
          note={p?.standing?.best != null ? `Best ${fmt(p.standing.best)} this season` : undefined}
        />
        <StatTile label="WvW rank" value={fmt(a.wvwRank)} note={a.wvwTitle ?? undefined} />
      </SimpleGrid>
      {!p ? (
        <Text c="dimmed">PvP needs the pvp permission on the API key.</Text>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} verticalSpacing={48}>
            <Section title="By profession" note="Games played in PvP, with win rate.">
              <BarList
                bars={(p.professions ?? [])
                  .filter((x) => x.wins + x.losses > 0)
                  .map((x) => ({
                    label: x.name,
                    value: x.wins + x.losses,
                    display: `${fmt(x.wins + x.losses)} · ${pct(x.wins, x.wins + x.losses)}%`,
                    icon: x.icon ? <img src={x.icon} alt="" width={16} height={16} /> : undefined,
                  }))}
              />
            </Section>
            <Section title="Ladders">
              <Stack gap={4}>
                {(p.ladders ?? []).map((l) => (
                  <Line key={l.name} label={l.name} value={`${fmt(l.wins)}W ${fmt(l.losses)}L`} />
                ))}
                <Line label="Desertions" value={fmt(p.desertions)} />
                <Line label="Byes" value={fmt(p.byes)} />
                <Line label="Forfeits" value={fmt(p.forfeits)} />
              </Stack>
            </Section>
          </SimpleGrid>
          {!!p.games?.length && (
            <Section title="Last games" note="Your last ten PvP games, from ArenaNet.">
              <div style={{ overflowX: 'auto' }}>
                <Table verticalSpacing={6} miw={560}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Result</Table.Th>
                      <Table.Th>Profession</Table.Th>
                      <Table.Th>Type</Table.Th>
                      <Table.Th ta="right">Score</Table.Th>
                      <Table.Th ta="right">Rating</Table.Th>
                      <Table.Th ta="right">When</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {p.games.map((g) => (
                      <Table.Tr key={g.id}>
                        <Table.Td>
                          <Text
                            size="sm"
                            fw={600}
                            c={g.result === 'Victory' ? 'teal.5' : g.result === 'Defeat' ? 'red.5' : 'dimmed'}
                          >
                            {g.result}
                          </Text>
                        </Table.Td>
                        <Table.Td>{g.profession}</Table.Td>
                        <Table.Td>{g.type && g.type !== 'None' ? g.type : 'Unranked'}</Table.Td>
                        <Table.Td ta="right" className="num">
                          {g.scores
                            ? g.team === 'Red'
                              ? `${g.scores.red} – ${g.scores.blue}`
                              : `${g.scores.blue} – ${g.scores.red}`
                            : '—'}
                        </Table.Td>
                        <Table.Td ta="right" className="num">
                          {g.ratingChange ? `${g.ratingChange > 0 ? '+' : ''}${g.ratingChange}` : '—'}
                        </Table.Td>
                        <Table.Td ta="right">
                          {new Date(g.ended).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            </Section>
          )}
        </>
      )}
    </Stack>
  );
}
