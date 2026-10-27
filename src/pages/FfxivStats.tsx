import {
  Alert,
  Anchor,
  Avatar,
  Button,
  Card,
  Group,
  Image,
  Loader,
  Menu,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconDots, IconExternalLink, IconRefresh, IconUnlink } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { StatTile } from '../components/charts';
import {
  connectFfxiv,
  disconnectFfxiv,
  fetchGameConnections,
  lodestoneUrl,
  refreshFfxiv,
  searchFfxivCharacters,
  type FfxivCharacter,
  type FfxivCollection,
  type FfxivJob,
  type FfxivSearchResult,
  type GameConnection,
} from '../lib/gameStats';

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <Title order={2}>{title}</Title>
      {note && (
        <Text size="sm" c="dimmed" mt={4}>
          {note}
        </Text>
      )}
      <div style={{ marginTop: 16 }}>{children}</div>
    </section>
  );
}

const ROLES: { role: FfxivJob['role']; label: string }[] = [
  { role: 'Tank', label: 'Tanks' },
  { role: 'Healer', label: 'Healers' },
  { role: 'Melee', label: 'Melee DPS' },
  { role: 'Ranged', label: 'Physical ranged DPS' },
  { role: 'Caster', label: 'Magical ranged DPS' },
  { role: 'Limited', label: 'Limited jobs' },
  { role: 'Crafter', label: 'Disciples of the Hand' },
  { role: 'Gatherer', label: 'Disciples of the Land' },
];

const ROLE_COLOR: Record<FfxivJob['role'], string> = {
  Tank: 'var(--mantine-color-blue-6)',
  Healer: 'var(--mantine-color-green-6)',
  Melee: 'var(--mantine-color-red-6)',
  Ranged: 'var(--mantine-color-red-6)',
  Caster: 'var(--mantine-color-red-6)',
  Limited: 'var(--mantine-color-grape-6)',
  Crafter: 'var(--mantine-color-yellow-6)',
  Gatherer: 'var(--mantine-color-yellow-6)',
};

/** The level cap: Blue Mage stops lower than the rest. */
const maxLevel = (job: FfxivJob) => (job.role === 'Limited' ? 80 : 100);

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

/** FINAL FANTASY XIV in My Stats: connect a character, then its Lodestone data by category. */
export function FfxivStats() {
  const [conn, setConn] = useState<GameConnection | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGameConnections()
      .then((all) => setConn(all.find((c) => c.game === 'ffxiv') ?? null))
      .catch((e: Error) => {
        setError(e.message);
        setConn(null);
      });
  }, []);

  if (conn === undefined) return <Loader />;
  if (!conn) return <ConnectCharacter onConnected={setConn} loadError={error} />;
  return <CharacterStats conn={conn} onChange={setConn} />;
}

function ConnectCharacter({
  onConnected,
  loadError,
}: {
  onConnected: (c: GameConnection) => void;
  loadError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState<'search' | 'link'>('search');
  const [name, setName] = useState('');
  const [world, setWorld] = useState('');
  const [link, setLink] = useState('');
  const [results, setResults] = useState<FfxivSearchResult[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(loadError);

  async function connect(character: string) {
    setBusy(character);
    setError(null);
    try {
      onConnected(await connectFfxiv(character));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy('search');
    setError(null);
    try {
      setResults(await searchFfxivCharacters(name.trim(), world));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card withBorder padding="lg" maw={640}>
      <Stack gap="md">
        <div>
          <Title order={3}>Connect your character</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Savepoint reads your character&apos;s public Lodestone pages: jobs, achievements, mounts and minions.
            Nothing to log in to; achievements need to be public in your Lodestone settings.
          </Text>
        </div>
        {!open ? (
          <Button onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start' }}>
            Connect a character
          </Button>
        ) : (
          <>
            <SegmentedControl
              value={how}
              onChange={(v) => {
                setHow(v as 'search' | 'link');
                setError(null);
              }}
              data={[
                { value: 'search', label: 'Find by name' },
                { value: 'link', label: 'Lodestone link' },
              ]}
              style={{ alignSelf: 'flex-start' }}
            />
            {how === 'search' ? (
              <form onSubmit={search}>
                <Stack gap="sm">
                  <Group align="flex-end" gap="sm" wrap="wrap">
                    <TextInput
                      label="Character name"
                      placeholder="Firstname Lastname"
                      value={name}
                      onChange={(e) => setName(e.currentTarget.value)}
                      required
                      minLength={2}
                      style={{ flex: '2 1 200px' }}
                    />
                    <TextInput
                      label="World"
                      placeholder="Optional, e.g. Omega"
                      value={world}
                      onChange={(e) => setWorld(e.currentTarget.value)}
                      style={{ flex: '1 1 140px' }}
                    />
                    <Button type="submit" loading={busy === 'search'}>
                      Search
                    </Button>
                  </Group>
                  {results && !results.length && (
                    <Text size="sm" c="dimmed">
                      No characters found. Check the spelling, or paste your Lodestone link instead.
                    </Text>
                  )}
                  {results?.map((r) => (
                    <Group key={r.id} justify="space-between" wrap="nowrap" gap="sm">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <Avatar src={r.avatar} radius="xl" size={40} />
                        <div style={{ minWidth: 0 }}>
                          <Text fw={600} truncate>
                            {r.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {r.world}
                            {r.dataCenter ? ` [${r.dataCenter}]` : ''}
                          </Text>
                        </div>
                      </Group>
                      <Button
                        size="xs"
                        variant="light"
                        loading={busy === r.id}
                        disabled={!!busy && busy !== r.id}
                        onClick={() => void connect(r.id)}
                        style={{ flexShrink: 0 }}
                      >
                        Connect
                      </Button>
                    </Group>
                  ))}
                </Stack>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect(link);
                }}
              >
                <Group align="flex-end" gap="sm" wrap="wrap">
                  <TextInput
                    label="Lodestone link or character ID"
                    placeholder="https://eu.finalfantasyxiv.com/lodestone/character/12345678/"
                    value={link}
                    onChange={(e) => setLink(e.currentTarget.value)}
                    required
                    style={{ flex: '1 1 280px' }}
                  />
                  <Button type="submit" loading={busy === link}>
                    Connect
                  </Button>
                </Group>
              </form>
            )}
          </>
        )}
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" fw={600}>
        {label}
      </Text>
      <Text size="sm">{children || '—'}</Text>
    </div>
  );
}

function JobRow({ job }: { job: FfxivJob }) {
  const cap = maxLevel(job);
  const unlocked = job.level > 0;
  return (
    <div>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          {job.icon ? (
            <img
              src={job.icon}
              alt=""
              width={24}
              height={24}
              loading="lazy"
              style={{ flexShrink: 0, opacity: unlocked ? 1 : 0.4 }}
            />
          ) : (
            <span
              aria-hidden
              style={{
                width: 24,
                height: 24,
                flexShrink: 0,
                borderRadius: '50%',
                background: ROLE_COLOR[job.role],
                opacity: unlocked ? 0.8 : 0.3,
              }}
            />
          )}
          <Text size="sm" c={unlocked ? undefined : 'dimmed'} truncate>
            {job.name}
          </Text>
        </Group>
        <Text size="sm" className="num" fw={job.level >= cap ? 700 : 500} c={unlocked ? undefined : 'dimmed'}>
          {unlocked ? job.level : '—'}
        </Text>
      </Group>
      <Progress
        value={unlocked ? (job.level / cap) * 100 : 0}
        size={4}
        mt={4}
        color={ROLE_COLOR[job.role]}
        aria-label={`${job.name} level ${job.level} of ${cap}`}
      />
    </div>
  );
}

function CollectionGrid({ what, c }: { what: string; c: FfxivCollection }) {
  const [all, setAll] = useState(false);
  if (!c.public) return <Text c="dimmed">Couldn&apos;t read the {what.toLowerCase()} page.</Text>;
  if (!c.list.length) return <Text c="dimmed">No {what.toLowerCase()} yet.</Text>;
  const shown = all ? c.list : c.list.slice(0, 48);
  return (
    <Stack gap="sm">
      <Group gap={6}>
        {shown.map((m) => (
          <Tooltip key={m.name} label={m.name} withArrow>
            {m.icon ? (
              <Image src={m.icon} alt={m.name} w={40} h={40} radius="sm" loading="lazy" />
            ) : (
              <Avatar size={40} radius="sm">
                {m.name.slice(0, 2)}
              </Avatar>
            )}
          </Tooltip>
        ))}
      </Group>
      {c.list.length > shown.length && (
        <Anchor
          component="button"
          type="button"
          size="sm"
          onClick={() => setAll(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          Show all {c.list.length}
        </Anchor>
      )}
    </Stack>
  );
}

function CharacterStats({ conn, onChange }: { conn: GameConnection; onChange: (c: GameConnection | null) => void }) {
  const ch: FfxivCharacter = conn.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      onChange(await refreshFfxiv());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try {
      await disconnectFfxiv();
      onChange(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const combat = ch.jobs.filter((j) => !['Crafter', 'Gatherer', 'Limited'].includes(j.role));
  const capped = combat.filter((j) => j.level >= maxLevel(j)).length;
  const handLand = ch.jobs.filter((j) => j.role === 'Crafter' || j.role === 'Gatherer');
  const handLandCapped = handLand.filter((j) => j.level >= maxLevel(j)).length;
  const a = ch.achievements;
  const bozja = ch.fieldOperations.bozja;
  const eureka = ch.fieldOperations.eureka;

  return (
    <Stack gap={48}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
          <Avatar src={ch.avatar} size={72} radius="xl" />
          <div style={{ minWidth: 0 }}>
            {ch.title && (
              <Text size="sm" c="dimmed" truncate>
                {ch.title}
              </Text>
            )}
            <Text className="display" fz={28} lh={1.1} truncate>
              {ch.name}
            </Text>
            <Text size="sm" c="dimmed">
              {ch.world}
              {ch.dataCenter ? ` [${ch.dataCenter}]` : ''} · updated {ago(conn.fetchedAt)}
            </Text>
          </div>
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Tooltip label="Read the Lodestone again">
            <Button
              variant="default"
              size="sm"
              loading={busy}
              onClick={() => void refresh()}
              leftSection={<IconRefresh size={16} />}
            >
              Refresh
            </Button>
          </Tooltip>
          <Menu position="bottom-end">
            <Menu.Target>
              <Button variant="default" size="sm" px={8} aria-label="More">
                <IconDots size={16} />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                component="a"
                href={lodestoneUrl(ch.id)}
                target="_blank"
                rel="noreferrer"
                leftSection={<IconExternalLink size={14} />}
              >
                View on the Lodestone
              </Menu.Item>
              <Menu.Item color="red" leftSection={<IconUnlink size={14} />} onClick={() => void disconnect()}>
                Disconnect character
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

      <SimpleGrid cols={{ base: 2, md: 3, lg: 5 }} spacing="md">
        <StatTile label="Combat jobs at cap" value={`${capped}/${combat.length}`} note="at level 100" />
        <StatTile label="Crafters & gatherers" value={`${handLandCapped}/${handLand.length}`} note="at level 100" />
        <StatTile
          label="Achievements"
          value={a.public ? fmt(a.total) : '—'}
          note={a.public ? `${fmt(a.points)} points` : 'Private on the Lodestone'}
        />
        <StatTile label="Mounts" value={ch.mounts.public ? fmt(ch.mounts.count) : '—'} />
        <StatTile label="Minions" value={ch.minions.public ? fmt(ch.minions.count) : '—'} />
      </SimpleGrid>

      <Section title="Character">
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="lg" verticalSpacing="md">
          <Fact label="Race / clan">{[ch.race, ch.clan].filter(Boolean).join(', ')}</Fact>
          <Fact label="Gender">{ch.gender === '♀' ? 'Female' : ch.gender === '♂' ? 'Male' : ch.gender}</Fact>
          <Fact label="Nameday">{ch.nameday}</Fact>
          <Fact label="Guardian">{ch.guardian}</Fact>
          <Fact label="City-state">{ch.cityState}</Fact>
          <Fact label="Grand Company">
            {ch.grandCompany ? `${ch.grandCompany.name} (${ch.grandCompany.rank})` : null}
          </Fact>
          <Fact label="Free Company">{ch.freeCompany?.name}</Fact>
          <Fact label="Current job level">{ch.activeJob.level}</Fact>
        </SimpleGrid>
      </Section>

      <Section title="Jobs">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing={32} verticalSpacing={32}>
          {ROLES.map(({ role, label }) => {
            const jobs = ch.jobs.filter((j) => j.role === role);
            if (!jobs.length) return null;
            return (
              <Stack key={role} gap="sm">
                <Text fw={700} size="sm">
                  {label}
                </Text>
                {jobs.map((j) => (
                  <JobRow key={j.key} job={j} />
                ))}
              </Stack>
            );
          })}
          {(bozja || eureka) && (
            <Stack gap="sm">
              <Text fw={700} size="sm">
                Field operations
              </Text>
              {eureka && (
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="sm">{eureka.name}</Text>
                  <Text size="sm" className="num">
                    {fmt(eureka.level)}
                  </Text>
                </Group>
              )}
              {bozja && (
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="sm">{bozja.name}</Text>
                  <Text size="sm" className="num">
                    {fmt(bozja.level)}
                  </Text>
                </Group>
              )}
            </Stack>
          )}
        </SimpleGrid>
      </Section>

      <Section
        title="Achievements"
        note={a.public ? `${fmt(a.total)} achievements, ${fmt(a.points)} points.` : undefined}
      >
        {!a.public ? (
          <Text c="dimmed">
            This character&apos;s achievements are private. Make them public in the Lodestone&apos;s character settings,
            then refresh.
          </Text>
        ) : a.recent.length ? (
          <Stack gap={8} maw={640}>
            <Text size="sm" fw={700}>
              Most recent
            </Text>
            {a.recent.map((r, i) => (
              <Group key={`${r.id}-${i}`} justify="space-between" gap="sm" wrap="nowrap">
                <Text size="sm" truncate>
                  {r.name}
                </Text>
                <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
                  {r.time
                    ? new Date(r.time).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : ''}
                </Text>
              </Group>
            ))}
          </Stack>
        ) : (
          <Text c="dimmed">No achievements yet.</Text>
        )}
      </Section>

      <Section title="Mounts" note={ch.mounts.public ? `${fmt(ch.mounts.count)} collected.` : undefined}>
        <CollectionGrid what="Mounts" c={ch.mounts} />
      </Section>

      <Section title="Minions" note={ch.minions.public ? `${fmt(ch.minions.count)} collected.` : undefined}>
        <CollectionGrid what="Minions" c={ch.minions} />
      </Section>

      <Text size="xs" c="dimmed">
        From the character&apos;s public{' '}
        <Anchor href={lodestoneUrl(ch.id)} target="_blank" rel="noreferrer" size="xs">
          Lodestone
        </Anchor>{' '}
        pages. FINAL FANTASY XIV © SQUARE ENIX.
      </Text>
    </Stack>
  );
}
