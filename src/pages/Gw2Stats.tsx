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
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconDots, IconExternalLink, IconRefresh, IconUnlink } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { StatTile } from '../components/charts';
import {
  connectGw2,
  disconnectGw2,
  fetchGameConnections,
  refreshGw2,
  type GameConnection,
  type Gw2Account,
  type Gw2Character,
  ago,
} from '../lib/gameStats';
import { Section } from '../components/GameSection';

const KEYS_URL = 'https://account.arena.net/applications';
/** What the tab uses; account is required, the rest fill in their sections. */
const PERMISSIONS = ['account', 'characters', 'progression', 'unlocks', 'wallet', 'pvp', 'inventories'];

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** Coins as gold, silver and copper (10000 copper = 1 gold). */
function Coins({ copper }: { copper: number }) {
  const g = Math.floor(copper / 10000);
  const s = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  return (
    <span className="num">
      {g > 0 && <span style={{ color: '#e6b422' }}>{g.toLocaleString()}g </span>}
      {(g > 0 || s > 0) && <span style={{ color: '#a8a9ad' }}>{s}s </span>}
      <span style={{ color: '#b87333' }}>{c}c</span>
    </span>
  );
}

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

/** One compact line: a label (with an optional icon) and a value on the right. */
function Line({ icon, label, value, dim }: { icon?: ReactNode; label: ReactNode; value: ReactNode; dim?: boolean }) {
  return (
    <Group justify="space-between" gap={6} wrap="nowrap" h={22}>
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        {icon}
        <Text size="sm" c={dim ? 'dimmed' : undefined} truncate>
          {label}
        </Text>
      </Group>
      <Text size="sm" className="num" c={dim ? 'dimmed' : undefined} style={{ flexShrink: 0 }}>
        {value}
      </Text>
    </Group>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <Text fw={700} size="xs" c="dimmed" tt="uppercase" mb={2}>
      {children}
    </Text>
  );
}

function CharacterRow({ c }: { c: Gw2Character }) {
  const crafting = c.crafting
    .filter((x) => x.active)
    .map((x) => `${x.discipline} ${x.rating}`)
    .join(', ');
  return (
    <Group justify="space-between" gap="sm" wrap="nowrap">
      <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
        {c.icon ? (
          <img src={c.icon} alt="" width={24} height={24} loading="lazy" style={{ flexShrink: 0 }} />
        ) : (
          <span style={{ width: 24, flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} truncate>
            {c.name}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {[c.race, c.profession].filter(Boolean).join(' ')}
            {crafting ? ` · ${crafting}` : ''}
          </Text>
        </div>
      </Group>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <Text size="sm" className="num">
          Level {c.level ?? '—'}
        </Text>
        <Text size="xs" c="dimmed" className="num">
          {fmt(c.hours)} h · {fmt(c.deaths)} deaths
        </Text>
      </div>
    </Group>
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
  const characters = [...(a.characters ?? [])].sort((x, y) => y.hours - x.hours);
  const masteryEarned = a.mastery?.reduce((n, m) => n + m.earned, 0) ?? null;

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

      <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }} spacing="md">
        <StatTile label="Hours played" value={fmt(a.hours)} note={`since ${date(a.created)}`} />
        <StatTile label="Characters" value={a.characters ? a.characters.length : '—'} />
        <StatTile label="Achievements" value={fmt(a.achievementsDone)} note="completed" />
        <StatTile label="Mastery points" value={fmt(masteryEarned)} note="earned" />
        <StatTile label="Fractal level" value={fmt(a.fractalLevel)} />
        <StatTile label="WvW rank" value={fmt(a.wvwRank)} />
      </SimpleGrid>

      <Section title="Characters">
        {a.characters === null ? (
          <Text c="dimmed">Needs the characters permission on the API key.</Text>
        ) : characters.length ? (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={40} verticalSpacing={12}>
            {characters.map((c) => (
              <CharacterRow key={c.name} c={c} />
            ))}
          </SimpleGrid>
        ) : (
          <Text c="dimmed">No characters yet.</Text>
        )}
      </Section>

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
            <Heading>PvP</Heading>
            {a.pvp ? (
              <>
                <Line label="Rank" value={a.pvp.rank} />
                <Line label="Wins" value={fmt(a.pvp.wins)} />
                <Line label="Losses" value={fmt(a.pvp.losses)} />
              </>
            ) : (
              <Text size="sm" c="dimmed">
                Needs the pvp permission.
              </Text>
            )}
          </Stack>
        </SimpleGrid>
      </Section>

      <Section title="Collections">
        {a.collections.length ? (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={4}>
            {a.collections.map((c) => (
              <Line
                key={c.label}
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
            ))}
          </SimpleGrid>
        ) : (
          <Text c="dimmed">Needs the unlocks permission on the API key.</Text>
        )}
      </Section>

      <Grid2>
        <Section title="Wallet">
          {a.wallet ? (
            <Stack gap={4}>
              {a.wallet.map((w) => (
                <Line
                  key={w.id}
                  icon={w.icon ? <img src={w.icon} alt="" width={18} height={18} loading="lazy" /> : undefined}
                  label={w.name}
                  value={w.id === 1 ? <Coins copper={w.value} /> : fmt(w.value)}
                />
              ))}
            </Stack>
          ) : (
            <Text c="dimmed">Needs the wallet permission on the API key.</Text>
          )}
        </Section>
        <Section title="Masteries">
          {a.mastery ? (
            <Stack gap={4}>
              {a.mastery.map((m) => (
                <Line key={m.region} label={m.region} value={`${m.spent} / ${m.earned} spent`} />
              ))}
            </Stack>
          ) : (
            <Text c="dimmed">Needs the progression permission on the API key.</Text>
          )}
        </Section>
      </Grid2>

      <Text size="xs" c="dimmed">
        From the official Guild Wars 2 API. © ArenaNet, LLC. Guild Wars 2 is a trademark of NCSOFT Corporation.
      </Text>
    </Stack>
  );
}

function Grid2({ children }: { children: ReactNode }) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} verticalSpacing={48} maw={1000}>
      {children}
    </SimpleGrid>
  );
}
