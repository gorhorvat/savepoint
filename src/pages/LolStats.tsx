import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Menu,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDots, IconRefresh, IconUnlink } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { StatTile } from '../components/charts';
import { Section } from '../components/GameSection';
import { ChallengesTab } from '../components/lol/Challenges';
import { ChampionsTab } from '../components/lol/Champions';
import { Champ, Heading, Line } from '../components/lol/common';
import { fmt, pct, rankName, title } from '../components/lol/format';
import { LiveTab } from '../components/lol/Live';
import { MatchesTab, MatchRow } from '../components/lol/Matches';
import { ProgressTab } from '../components/lol/Progress';
import {
  ago,
  connectLol,
  disconnectLol,
  fetchGameConnections,
  fetchLolSetup,
  refreshLol,
  type GameConnection,
  type LolPlayer,
} from '../lib/gameStats';

type Region = { value: string; label: string };

/** League of Legends in My Stats: connect a Riot ID, then ranked, mastery, matches and challenges. */
export function LolStats() {
  const [conn, setConn] = useState<GameConnection<LolPlayer> | null | undefined>(undefined);
  const [setup, setSetup] = useState<{ configured: boolean; regions: Region[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchLolSetup(), fetchGameConnections()])
      .then(([s, all]) => {
        setSetup(s);
        setConn((all.find((c) => c.game === 'lol') as GameConnection<LolPlayer> | undefined) ?? null);
      })
      .catch((e: Error) => {
        setError(e.message);
        setConn(null);
      });
  }, []);

  if (conn === undefined) return <Loader />;
  if (conn) return <PlayerStats conn={conn} regions={setup?.regions ?? []} onChange={setConn} />;
  if (setup && !setup.configured) {
    return (
      <Alert color="yellow" variant="light" maw={640}>
        League of Legends stats aren&apos;t set up on this Savepoint yet: the server needs a Riot API key
        (RIOT_API_KEY).
      </Alert>
    );
  }
  return <ConnectPlayer regions={setup?.regions ?? []} onConnected={setConn} loadError={error} />;
}

function ConnectPlayer({
  regions,
  onConnected,
  loadError,
}: {
  regions: Region[];
  onConnected: (c: GameConnection<LolPlayer>) => void;
  loadError: string | null;
}) {
  const [riotId, setRiotId] = useState('');
  const [region, setRegion] = useState<string | null>('eun1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(loadError);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!region) return;
    setBusy(true);
    setError(null);
    try {
      onConnected(await connectLol(riotId, region));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder padding="lg" maw={640}>
      <form onSubmit={submit}>
        <Stack gap="md">
          <div>
            <Title order={3}>Connect your Riot ID</Title>
            <Text size="sm" c="dimmed" mt={4}>
              Savepoint reads your public League of Legends stats from Riot: ranked, champion mastery, recent matches
              and challenges. Nothing to log in to.
            </Text>
          </div>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput
              label="Riot ID"
              placeholder="Name#TAG"
              value={riotId}
              onChange={(e) => setRiotId(e.currentTarget.value)}
              required
              style={{ flex: '2 1 200px' }}
            />
            <Select
              label="Region"
              data={regions}
              value={region}
              onChange={setRegion}
              allowDeselect={false}
              style={{ flex: '1 1 180px' }}
            />
            <Button type="submit" loading={busy}>
              Connect
            </Button>
          </Group>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </form>
    </Card>
  );
}

function PlayerStats({
  conn,
  regions,
  onChange,
}: {
  conn: GameConnection<LolPlayer>;
  regions: Region[];
  onChange: (c: GameConnection<LolPlayer> | null) => void;
}) {
  const p = conn.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('overview');

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      onChange(await refreshLol());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try {
      await disconnectLol();
      onChange(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const solo = p.ranked.find((r) => r.queue === 'Solo/Duo');
  const flex = p.ranked.find((r) => r.queue === 'Flex');
  const played = p.matches.filter((m) => !m.remake);
  const wins = played.filter((m) => m.win).length;
  const sum = (k: 'kills' | 'deaths' | 'assists') => played.reduce((n, m) => n + m[k], 0);
  const avgKda = played.length ? (sum('kills') + sum('assists')) / Math.max(1, sum('deaths')) : null;
  const csMin = played.length
    ? played.reduce((n, m) => n + m.cs, 0) /
      Math.max(
        1,
        played.reduce((n, m) => n + m.minutes, 0),
      )
    : null;
  const byChamp = new Map<string, { image: string | null; games: number; wins: number }>();
  for (const m of played) {
    const c = byChamp.get(m.champion) ?? { image: m.image, games: 0, wins: 0 };
    c.games++;
    if (m.win) c.wins++;
    byChamp.set(m.champion, c);
  }
  const favourites = [...byChamp].sort((a, b) => b[1].games - a[1].games).slice(0, 5);
  const region = regions.find((r) => r.value === p.platform)?.label ?? p.platform.toUpperCase();

  const rankTile = (label: string, r: typeof solo) => (
    <StatTile
      label={label}
      value={r ? rankName(r.tier, r.division) : 'Unranked'}
      note={r ? `${r.lp} LP · ${r.wins}W ${r.losses}L (${pct(r.wins, r.losses)}%)` : undefined}
    />
  );

  return (
    <Stack gap={48}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
          <Avatar src={p.icon} size={64} radius="xl" />
          <div style={{ minWidth: 0 }}>
            <Text className="display" fz={28} lh={1.1} truncate>
              {p.gameName}
              <Text span c="dimmed" fz={20}>
                {' '}
                #{p.tagLine}
              </Text>
            </Text>
            <Text size="sm" c="dimmed">
              {region} · level {fmt(p.level)} · updated {ago(conn.fetchedAt)}
            </Text>
            {p.live && (
              <Badge color="teal" variant="light" mt={6}>
                In game{p.live.champion ? ` as ${p.live.champion}` : ''} · {p.live.queue}
              </Badge>
            )}
          </div>
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Button
            variant="default"
            size="sm"
            loading={busy}
            onClick={() => void refresh()}
            leftSection={<IconRefresh size={16} />}
          >
            Refresh
          </Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <Button variant="default" size="sm" px={8} aria-label="More">
                <IconDots size={16} />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item color="red" leftSection={<IconUnlink size={14} />} onClick={() => void disconnect()}>
                Disconnect Riot ID
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {error && (
        <Alert color="red" variant="light" mt={-32}>
          {error}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(v) => setTab(v ?? 'overview')}
        variant="pills"
        radius="xl"
        keepMounted={false}
        mt={-16}
      >
        <Tabs.List mb={32}>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="matches">Matches</Tabs.Tab>
          <Tabs.Tab value="champions">Champions</Tabs.Tab>
          <Tabs.Tab value="challenges">Challenges</Tabs.Tab>
          <Tabs.Tab value="live">Live game{p.live ? ' •' : ''}</Tabs.Tab>
          <Tabs.Tab value="progress">Progress</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview">
          <Stack gap={48}>
            <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }} spacing="md">
              {rankTile('Solo/Duo', solo)}
              {rankTile('Flex', flex)}
              <StatTile label="Mastery score" value={fmt(p.mastery.score)} note={`${fmt(p.mastery.points)} points`} />
              <StatTile label="Champions played" value={fmt(p.mastery.champions)} />
              <StatTile
                label={`Last ${played.length} games`}
                value={played.length ? `${pct(wins, played.length - wins)}%` : '—'}
                note={played.length ? `${wins}W ${played.length - wins}L` : undefined}
              />
              <StatTile
                label="Challenges"
                value={p.challenges?.level ? title(p.challenges.level) : '—'}
                note={p.challenges ? `${fmt(p.challenges.points)} points` : undefined}
              />
            </SimpleGrid>

            <Section
              title="Recent matches"
              note={
                played.length
                  ? `Last ${played.length} games: ${avgKda?.toFixed(2)} KDA, ${csMin?.toFixed(1)} CS per minute. Open a match for the full scoreboard.`
                  : undefined
              }
            >
              {p.matches.length ? (
                <Grid gap={40}>
                  <Grid.Col span={{ base: 12, lg: 8 }}>
                    <Stack gap={10}>
                      {p.matches.slice(0, 10).map((m) => (
                        <MatchRow key={m.id} m={m} />
                      ))}
                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => setTab('matches')}
                        style={{ alignSelf: 'flex-start' }}
                      >
                        All {p.archive ? fmt(p.archive.count) : ''} matches
                      </Button>
                    </Stack>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, lg: 4 }}>
                    <Stack gap={4}>
                      <Heading>Most played recently</Heading>
                      {favourites.map(([name, c]) => (
                        <Line
                          key={name}
                          label={
                            <Group gap={6} wrap="nowrap" component="span">
                              <Champ image={c.image} size={20} />
                              {name}
                            </Group>
                          }
                          value={`${c.games} games · ${pct(c.wins, c.games - c.wins)}%`}
                        />
                      ))}
                    </Stack>
                  </Grid.Col>
                </Grid>
              ) : (
                <Text c="dimmed">No recent matches.</Text>
              )}
            </Section>

            <Section title="Champion mastery" note="Your highest-mastery champions.">
              {p.mastery.top.length ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={10}>
                  {p.mastery.top.slice(0, 9).map((c) => (
                    <Group key={c.championId} justify="space-between" gap="sm" wrap="nowrap">
                      <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                        <Champ image={c.image} />
                        <Text size="sm" fw={600} truncate>
                          {c.name}
                        </Text>
                      </Group>
                      <Text size="sm" className="num" style={{ flexShrink: 0 }}>
                        {fmt(c.points)}{' '}
                        <Text span size="xs" c="dimmed">
                          · level {c.level}
                        </Text>
                      </Text>
                    </Group>
                  ))}
                </SimpleGrid>
              ) : (
                <Text c="dimmed">No champion mastery yet.</Text>
              )}
            </Section>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="matches">
          <MatchesTab player={p} onArchive={(archive) => onChange({ ...conn, data: { ...p, archive } })} />
        </Tabs.Panel>
        <Tabs.Panel value="champions">
          <ChampionsTab player={p} />
        </Tabs.Panel>
        <Tabs.Panel value="challenges">
          <ChallengesTab player={p} />
        </Tabs.Panel>
        <Tabs.Panel value="live">
          <LiveTab />
        </Tabs.Panel>
        <Tabs.Panel value="progress">
          <ProgressTab refreshedAt={conn.fetchedAt} />
        </Tabs.Panel>
      </Tabs>

      <Text size="xs" c="dimmed">
        Savepoint isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or
        anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated
        properties are trademarks or registered trademarks of Riot Games, Inc.
      </Text>
    </Stack>
  );
}
