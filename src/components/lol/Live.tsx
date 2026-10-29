import { Button, Group, Loader, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { fetchLolLive, type LolLive } from '../../lib/gameStats';
import { Champ, Icon } from './common';
import { pct, rankName } from './format';

/** The game the player is in right now, with all ten players and their Solo/Duo ranks. */
export function LiveTab() {
  const [state, setState] = useState<{ live: LolLive | null; at: number } | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(
    () =>
      fetchLolLive()
        .then((live) => {
          setState({ live, at: Date.now() });
          setError(null);
        })
        .catch((e: Error) => {
          setError(e.message);
          setState((s) => s ?? { live: null, at: Date.now() });
        }),
    [],
  );

  useEffect(() => {
    void read();
  }, [read]);

  const again = () => {
    setBusy(true);
    void read().finally(() => setBusy(false));
  };

  if (state === undefined) return <Loader size="sm" />;

  const { live, at } = state;
  const minutes = live?.since ? Math.max(0, Math.round((at - new Date(live.since).getTime()) / 60000)) : null;
  const teams = live ? [...new Set(live.players.map((p) => p.team))].sort() : [];

  return (
    <Stack gap="lg">
      <Group justify="space-between" gap="sm">
        <Text size="sm" c="dimmed">
          {live
            ? `${live.queue}${minutes != null ? ` · ${minutes} min in` : ''}. Ranks are Solo/Duo.`
            : 'Not in a game right now.'}
        </Text>
        <Button size="xs" variant="default" loading={busy} leftSection={<IconRefresh size={14} />} onClick={again}>
          Check again
        </Button>
      </Group>
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      {live && (
        <SimpleGrid cols={{ base: 1, md: teams.length > 1 ? 2 : 1 }} spacing={40}>
          {teams.map((team) => (
            <Stack key={team} gap={8}>
              <Group justify="space-between" gap="sm">
                <Text size="sm" fw={700}>
                  {team === 100 ? 'Blue side' : team === 200 ? 'Red side' : `Team ${team}`}
                </Text>
                <Group gap={2}>
                  {live.bans
                    .filter((b) => b.team === team)
                    .map((b, i) => (
                      <Icon key={i} thing={{ id: i, name: b.name, image: b.image }} size={18} />
                    ))}
                </Group>
              </Group>
              {live.players
                .filter((p) => p.team === team)
                .map((p, i) => (
                  <Group
                    key={i}
                    justify="space-between"
                    gap="sm"
                    wrap="nowrap"
                    p={4}
                    style={{ background: p.me ? 'var(--mantine-primary-color-light)' : undefined, borderRadius: 6 }}
                  >
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      <Champ image={p.image} size={32} label={p.champion} />
                      <Stack gap={2}>
                        <Group gap={2} wrap="nowrap">
                          <Icon thing={p.spells[0]} size={15} />
                          <Icon thing={p.spells[1]} size={15} />
                        </Group>
                        <Group gap={2} wrap="nowrap">
                          <Icon thing={p.keystone} size={15} round />
                          <Icon thing={p.secondary} size={15} round />
                        </Group>
                      </Stack>
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={p.me ? 700 : 500} truncate>
                          {p.bot ? `${p.champion} (bot)` : (p.name ?? p.champion)}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {p.champion}
                        </Text>
                      </div>
                    </Group>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <Text size="sm">{p.rank ? rankName(p.rank.tier, p.rank.division) : 'Unranked'}</Text>
                      {p.rank && (
                        <Text size="xs" c="dimmed" className="num">
                          {p.rank.lp} LP · {pct(p.rank.wins, p.rank.losses)}% of {p.rank.wins + p.rank.losses}
                        </Text>
                      )}
                    </div>
                  </Group>
                ))}
            </Stack>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}
