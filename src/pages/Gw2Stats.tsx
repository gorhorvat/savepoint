import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  List,
  Loader,
  Menu,
  PasswordInput,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconDots, IconExternalLink, IconRefresh, IconUnlink } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { StatTile } from '../components/charts';
import { Section } from '../components/GameSection';
import { AchievementsTab } from '../components/gw2/Achievements';
import { CharactersTab } from '../components/gw2/Characters';
import { date, fmt, goldText } from '../components/gw2/format';
import { Img } from '../components/gw2/parts';
import { ProgressTab } from '../components/gw2/Progress';
import { PvpTab } from '../components/gw2/Pvp';
import { WealthTab } from '../components/gw2/Wealth';
import { WeekTab } from '../components/gw2/Week';
import { Heading, Line, Meter } from '../components/StatParts';
import {
  ago,
  connectGw2,
  disconnectGw2,
  fetchGameConnections,
  refreshGw2,
  type GameConnection,
  type Gw2Account,
} from '../lib/gameStats';

const KEYS_URL = 'https://account.arena.net/applications';
/** What the tab uses; account is required, the rest fill in their sections. */
const PERMISSIONS = [
  'account',
  'characters',
  'builds',
  'progression',
  'unlocks',
  'wallet',
  'pvp',
  'inventories',
  'tradingpost',
];

/** Guild Wars 2 in My Stats: connect with an API key, then the account's data by category. */
export function Gw2Stats() {
  const [conn, setConn] = useState<GameConnection<Gw2Account> | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGameConnections()
      .then((all) => setConn((all.find((c) => c.game === 'gw2') as GameConnection<Gw2Account> | undefined) ?? null))
      .catch((e: Error) => {
        setError(e.message);
        setConn(null);
      });
  }, []);

  if (conn === undefined) return <Loader />;
  if (!conn) return <ConnectAccount onConnected={setConn} loadError={error} />;
  return <AccountStats conn={conn} onChange={setConn} />;
}

function ConnectAccount({
  onConnected,
  loadError,
}: {
  onConnected: (c: GameConnection<Gw2Account>) => void;
  loadError: string | null;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(loadError);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onConnected(await connectGw2(key));
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
            <Title order={3}>Connect your Guild Wars 2 account</Title>
            <Text size="sm" c="dimmed" mt={4}>
              Savepoint reads your account through ArenaNet&apos;s official API with an API key of your own. The key can
              only read, and it&apos;s stored encrypted.
            </Text>
          </div>
          <List type="ordered" size="sm" spacing={4}>
            <List.Item>
              Open{' '}
              <Anchor href={KEYS_URL} target="_blank" rel="noreferrer" size="sm">
                Applications in your ArenaNet account
              </Anchor>{' '}
              and choose New Key.
            </List.Item>
            <List.Item>
              Tick{' '}
              {PERMISSIONS.map((p, i) => (
                <span key={p}>
                  <b>{p}</b>
                  {i < PERMISSIONS.length - 2 ? ', ' : i === PERMISSIONS.length - 2 ? ' and ' : ''}
                </span>
              ))}
              .
            </List.Item>
            <List.Item>Copy the key and paste it here.</List.Item>
          </List>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <PasswordInput
              label="API key"
              placeholder="XXXXXXXX-XXXX-…"
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
              required
              autoComplete="off"
              style={{ flex: '1 1 300px' }}
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

function AccountStats({
  conn,
  onChange,
}: {
  conn: GameConnection<Gw2Account>;
  onChange: (c: GameConnection<Gw2Account> | null) => void;
}) {
  const a = conn.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      onChange(await refreshGw2());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try {
      await disconnectGw2();
      onChange(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const missing = PERMISSIONS.filter((p) => !a.permissions.includes(p));
  const [tab, setTab] = useState<string>('overview');

  return (
    <Stack gap={48}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <div style={{ minWidth: 0 }}>
          <Text className="display" fz={28} lh={1.1} truncate>
            {a.name}
          </Text>
          <Text size="sm" c="dimmed">
            {a.world ? `${a.world} · ` : ''}since {date(a.created)} · updated {ago(conn.fetchedAt)}
          </Text>
        </div>
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
              <Menu.Item
                component="a"
                href={KEYS_URL}
                target="_blank"
                rel="noreferrer"
                leftSection={<IconExternalLink size={14} />}
              >
                Manage API keys
              </Menu.Item>
              <Menu.Item color="red" leftSection={<IconUnlink size={14} />} onClick={() => void disconnect()}>
                Disconnect account
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
      {missing.length > 0 && (
        <Alert color="yellow" variant="light" mt={-32}>
          This API key doesn&apos;t have the {missing.join(', ')} permission{missing.length === 1 ? '' : 's'}, so those
          sections stay empty. To fill them in, make a new key that includes {missing.length === 1 ? 'it' : 'them'} and
          connect again.
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
          <Tabs.Tab value="characters">Characters</Tabs.Tab>
          <Tabs.Tab value="week">This week</Tabs.Tab>
          <Tabs.Tab value="achievements">Achievements</Tabs.Tab>
          <Tabs.Tab value="wealth">Wealth</Tabs.Tab>
          <Tabs.Tab value="pvp">PvP and WvW</Tabs.Tab>
          <Tabs.Tab value="collections">Collections</Tabs.Tab>
          <Tabs.Tab value="progress">Progress</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview">
          <Stack gap={48}>
            <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }} spacing="md">
              <StatTile label="Hours played" value={fmt(a.hours)} note={`since ${date(a.created)}`} />
              <StatTile label="Characters" value={a.characters ? a.characters.length : '—'} />
              <StatTile
                label="Achievement points"
                value={fmt(a.ap?.total)}
                note={a.achievementsDone != null ? `${fmt(a.achievementsDone)} achievements done` : undefined}
              />
              <StatTile
                label="Account value"
                value={a.value ? goldText(a.value.sell) : '—'}
                note={a.value ? 'listed on the trading post' : undefined}
              />
              <StatTile label="Fractal level" value={fmt(a.fractalLevel)} />
              <StatTile label="WvW rank" value={fmt(a.wvwRank)} note={a.wvwTitle ?? undefined} />
            </SimpleGrid>

            <Section title="Account">
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing={28} verticalSpacing={24}>
                <Stack gap={4}>
                  <Heading>Expansions</Heading>
                  <Group gap={6}>
                    {a.expansions.length ? (
                      a.expansions.map((x) => (
                        <Badge key={x} variant="light" radius="sm">
                          {x}
                        </Badge>
                      ))
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Group>
                </Stack>
                <Stack gap={4}>
                  <Heading>Guilds</Heading>
                  {a.guilds.length ? (
                    a.guilds.map((g) => <Line key={g.name} label={g.name} value={`[${g.tag}]`} />)
                  ) : (
                    <Text size="sm" c="dimmed">
                      None
                    </Text>
                  )}
                </Stack>
                <Stack gap={4}>
                  <Heading>Mounts</Heading>
                  {a.mounts ? (
                    <Tooltip label={a.mounts.owned.join(', ') || 'None'} multiline w={260} withArrow>
                      <div>
                        <Line label="Unlocked" value={`${a.mounts.owned.length} / ${a.mounts.total ?? '—'}`} />
                      </div>
                    </Tooltip>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Needs the unlocks permission.
                    </Text>
                  )}
                  <Line label="Commander tag" value={a.commander ? 'Yes' : 'No'} />
                  {a.luck != null && <Line label="Luck consumed" value={fmt(a.luck)} />}
                </Stack>
                <Stack gap={4}>
                  <Heading>Masteries</Heading>
                  {a.mastery ? (
                    a.mastery.map((m) => (
                      <Line key={m.region} label={m.region} value={`${m.spent} / ${m.earned} spent`} />
                    ))
                  ) : (
                    <Text size="sm" c="dimmed">
                      Needs the progression permission.
                    </Text>
                  )}
                </Stack>
              </SimpleGrid>
            </Section>

            {!!a.legendaries?.length && (
              <Section title="Legendary armory" note={`${a.legendaries.length} legendaries.`}>
                <Group gap={6}>
                  {a.legendaries.map((l) => (
                    <Img
                      key={l.id}
                      src={l.icon}
                      name={l.count > 1 ? `${l.name} ×${l.count}` : l.name}
                      rarity="Legendary"
                      size={36}
                    />
                  ))}
                </Group>
              </Section>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="characters">
          <CharactersTab characters={a.characters} />
        </Tabs.Panel>
        <Tabs.Panel value="week">
          <WeekTab a={a} />
        </Tabs.Panel>
        <Tabs.Panel value="achievements">
          <AchievementsTab a={a} />
        </Tabs.Panel>
        <Tabs.Panel value="wealth">
          <WealthTab a={a} />
        </Tabs.Panel>
        <Tabs.Panel value="pvp">
          <PvpTab a={a} />
        </Tabs.Panel>
        <Tabs.Panel value="collections">
          <Stack gap={48}>
            <Section title="Collections">
              {a.collections.length ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={12}>
                  {a.collections.map((c) => (
                    <div key={c.label}>
                      <Line
                        label={c.label}
                        value={
                          <>
                            {fmt(c.owned)}
                            {c.total ? (
                              <Text span size="xs" c="dimmed">
                                {' '}
                                / {fmt(c.total)} · {Math.round((c.owned / c.total) * 100)}%
                              </Text>
                            ) : null}
                          </>
                        }
                      />
                      {c.total ? <Meter value={c.owned} max={c.total} /> : null}
                    </div>
                  ))}
                </SimpleGrid>
              ) : (
                <Text c="dimmed">Needs the unlocks permission on the API key.</Text>
              )}
            </Section>
            {!!a.masteryTracks?.length && (
              <Section title="Mastery tracks" note="Levels trained in each mastery line.">
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={12}>
                  {a.masteryTracks.map((m) => (
                    <div key={m.name}>
                      <Line label={m.name} value={`${m.level} / ${m.max ?? '—'}`} />
                      <Text size="xs" c="dimmed">
                        {m.region}
                      </Text>
                      {m.max ? <Meter value={m.level} max={m.max} /> : null}
                    </div>
                  ))}
                </SimpleGrid>
              </Section>
            )}
            {!!a.progression?.length && (
              <Section title="Account progression">
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={4}>
                  {a.progression.map((p) => (
                    <Line key={p.name} label={p.name} value={fmt(p.value)} />
                  ))}
                </SimpleGrid>
              </Section>
            )}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="progress">
          <ProgressTab refreshedAt={conn.fetchedAt} />
        </Tabs.Panel>
      </Tabs>

      <Text size="xs" c="dimmed">
        From the official Guild Wars 2 API. © ArenaNet, LLC. Guild Wars 2 is a trademark of NCSOFT Corporation.
      </Text>
    </Stack>
  );
}
