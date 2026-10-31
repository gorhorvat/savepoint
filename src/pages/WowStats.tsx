import {
  Alert,
  Anchor,
  Avatar,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Menu,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconDots, IconExternalLink, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { StatTile } from '../components/charts';
import { Section } from '../components/GameSection';
import { Heading, Line, Meter } from '../components/StatParts';
import { TrendChart, type TrendPoint } from '../components/TrendChart';
import {
  addWowCharacter,
  ago,
  fetchGameConnections,
  fetchGameHistory,
  fetchWowRealms,
  fetchWowSetup,
  refreshWow,
  removeWowCharacter,
  type GameConnection,
  type Snapshot,
  type WowCharacter,
  type WowData,
  type WowRun,
  type WowSnapshot,
} from '../lib/gameStats';
import { day, num } from '../lib/steamGameFormat';

// The class colours WoW uses everywhere (nameplates, armory, Raider.IO).
const CLASS_COLORS: Record<string, string> = {
  'Death Knight': '#C41E3A',
  'Demon Hunter': '#A330C9',
  Druid: '#FF7C0A',
  Evoker: '#33937F',
  Hunter: '#AAD372',
  Mage: '#3FC7EB',
  Monk: '#00FF98',
  Paladin: '#F48CBA',
  Priest: '#FFFFFF',
  Rogue: '#FFF468',
  Shaman: '#0070DD',
  Warlock: '#8788EE',
  Warrior: '#C69B6D',
};
// Light classes (Priest, Rogue) would vanish on a light page, so they fall back to the text colour there.
const classColor = (c: string | null) =>
  c && CLASS_COLORS[c] && !['Priest', 'Rogue'].includes(c)
    ? CLASS_COLORS[c]
    : c === 'Rogue'
      ? 'light-dark(#b8a800, #FFF468)'
      : undefined;

const QUALITY_COLORS: Record<string, string> = {
  poor: '#9d9d9d',
  uncommon: 'light-dark(#14a800, #1eff00)',
  rare: '#0070dd',
  epic: '#a335ee',
  legendary: '#ff8000',
  artifact: '#e6cc80',
  heirloom: '#00ccff',
};

const BRACKETS: Record<string, string> = { '2v2': '2v2 Arena', '3v3': '3v3 Arena', rbg: 'Rated Battlegrounds' };
const bracketName = (b: string) =>
  BRACKETS[b] ??
  (b.startsWith('shuffle')
    ? `Solo Shuffle${b.split('-').length > 2 ? ` (${b.split('-').slice(2).join(' ')})` : ''}`
    : b.startsWith('blitz')
      ? 'Battleground Blitz'
      : b);

/** World of Warcraft in My Stats: characters by realm and name, from Blizzard and Raider.IO. */
export function WowStats() {
  const [conn, setConn] = useState<GameConnection<WowData> | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGameConnections()
      .then((all) => setConn((all.find((c) => c.game === 'wow') as GameConnection<WowData> | undefined) ?? null))
      .catch((e: Error) => {
        setError(e.message);
        setConn(null);
      });
  }, []);

  if (conn === undefined) return <Loader />;
  if (!conn?.data.characters.length) {
    return (
      <Card withBorder padding="lg">
        <Stack gap="md">
          <div>
            <Title order={3}>Add a World of Warcraft character</Title>
            <Text size="sm" c="dimmed" mt={4}>
              Pick the region and realm and type the character&apos;s name. Savepoint reads it from Blizzard and
              Raider.IO; there&apos;s nothing to sign in to. You can add up to 8 characters.
            </Text>
          </div>
          <AddCharacter onAdded={setConn} />
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Card>
    );
  }
  return <Characters conn={conn} onChange={setConn} />;
}

function AddCharacter({ onAdded, onCancel }: { onAdded: (c: GameConnection<WowData>) => void; onCancel?: () => void }) {
  const [setup, setSetup] = useState<{ blizzard: boolean; regions: { value: string; label: string }[] } | null>(null);
  const [region, setRegion] = useState('eu');
  const [realms, setRealms] = useState<{ name: string; slug: string }[]>([]);
  const [realm, setRealm] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWowSetup()
      .then(setSetup)
      .catch(() => setSetup({ blizzard: false, regions: [{ value: 'eu', label: 'Europe' }] }));
  }, []);

  useEffect(() => {
    if (!setup?.blizzard) return;
    fetchWowRealms(region)
      .then(setRealms)
      .catch(() => setRealms([]));
  }, [region, setup?.blizzard]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(await addWowCharacter(region, realm, name));
      setName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!setup) return <Loader size="sm" />;
  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select
            label="Region"
            data={setup.regions}
            value={region}
            onChange={(v) => {
              if (!v) return;
              setRegion(v);
              setRealm('');
            }}
            w={200}
          />
          {realms.length ? (
            <Select
              label="Realm"
              placeholder="Pick a realm"
              data={realms.map((r) => ({ value: r.slug, label: r.name }))}
              value={realm || null}
              onChange={(v) => setRealm(v ?? '')}
              searchable
              w={240}
            />
          ) : (
            <TextInput
              label="Realm"
              placeholder="e.g. Twisting Nether"
              value={realm}
              onChange={(e) => setRealm(e.currentTarget.value)}
              w={240}
            />
          )}
          <TextInput
            label="Character"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            w={200}
          />
          <Button type="submit" loading={busy} disabled={!realm.trim() || !name.trim()}>
            Add character
          </Button>
          {onCancel && (
            <Button variant="subtle" color="gray" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </Group>
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
      </Stack>
    </form>
  );
}

function Characters({
  conn,
  onChange,
}: {
  conn: GameConnection<WowData>;
  onChange: (c: GameConnection<WowData> | null) => void;
}) {
  const list = conn.data.characters;
  const [selected, setSelected] = useState(list[0].key);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = list.find((x) => x.key === selected) ?? list[0];

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await refreshWow());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      const next = await removeWowCharacter(c.key);
      onChange(next);
      if (next) setSelected(next.data.characters[0].key);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Stack gap={48}>
      {(list.length > 1 || adding) && (
        <Stack gap="md">
          <Group gap="xs" wrap="wrap">
            {list.map((x) => (
              <UnstyledButton
                key={x.key}
                onClick={() => setSelected(x.key)}
                aria-pressed={x.key === c.key}
                style={{
                  padding: '6px 12px 6px 6px',
                  borderRadius: 999,
                  border: '1px solid var(--sp-line)',
                  background: x.key === c.key ? 'var(--sp-raised)' : undefined,
                  outline: x.key === c.key ? '1px solid var(--mantine-primary-color-filled)' : undefined,
                }}
              >
                <Group gap={8} wrap="nowrap">
                  <Avatar src={x.images.avatar} size={28} radius="xl">
                    {x.name.slice(0, 1)}
                  </Avatar>
                  <div>
                    <Text size="sm" fw={600} lh={1.2} c={classColor(x.className)}>
                      {x.name}
                    </Text>
                    <Text size="xs" c="dimmed" lh={1.2}>
                      {x.realm.name}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            ))}
          </Group>
          {adding && (
            <AddCharacter
              onAdded={(next) => {
                onChange(next);
                setSelected(next.data.characters.at(-1)!.key);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
        </Stack>
      )}

      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
          <Avatar src={c.images.avatar} size={64} radius="md">
            {c.name.slice(0, 2)}
          </Avatar>
          <div style={{ minWidth: 0 }}>
            <Text className="display" fz={28} lh={1.1} truncate c={classColor(c.className)}>
              {c.name}
            </Text>
            <Text size="sm" c="dimmed">
              {[c.level ? `Level ${c.level}` : null, c.race, c.spec, c.className].filter(Boolean).join(' ')}
              {' · '}
              {c.realm.name} ({c.region.toUpperCase()}){c.guild ? ` · <${c.guild}>` : ''}
            </Text>
            <Text size="xs" c="dimmed">
              updated {ago(conn.fetchedAt)}
              {c.lastLogin ? ` · last played ${ago(c.lastLogin)}` : ''}
            </Text>
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
              {list.length < 8 && (
                <Menu.Item leftSection={<IconPlus size={14} />} onClick={() => setAdding(true)}>
                  Add a character
                </Menu.Item>
              )}
              <Menu.Item
                component="a"
                href={c.links.armory}
                target="_blank"
                rel="noreferrer"
                leftSection={<IconExternalLink size={14} />}
              >
                Armory
              </Menu.Item>
              {c.links.raiderio && (
                <Menu.Item
                  component="a"
                  href={c.links.raiderio}
                  target="_blank"
                  rel="noreferrer"
                  leftSection={<IconExternalLink size={14} />}
                >
                  Raider.IO
                </Menu.Item>
              )}
              <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => void remove()}>
                Remove {c.name}
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

      <CharacterView c={c} refreshedAt={conn.fetchedAt} />
    </Stack>
  );
}

function raidSummary(c: WowCharacter) {
  const rio = c.raidProgress[0];
  if (rio?.summary) return { value: rio.summary, note: rio.name };
  const inst = c.raids?.instances.at(-1);
  if (!inst) return null;
  const best = [...inst.modes].reverse().find((m) => m.killed > 0) ?? inst.modes[0];
  return best ? { value: `${best.killed}/${best.total} ${best.difficulty.charAt(0)}`, note: inst.name } : null;
}

function CharacterView({ c, refreshedAt }: { c: WowCharacter; refreshedAt: string }) {
  const raid = raidSummary(c);
  const m = c.mythic;
  return (
    <Stack gap={48}>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xl">
        <StatTile label="Item level" value={c.itemLevel != null ? num(c.itemLevel, 1) : '–'} note="equipped" />
        <StatTile
          label="Mythic+"
          value={m.score != null ? <span style={{ color: m.color ?? undefined }}>{num(m.score)}</span> : '–'}
          note={m.ranks?.realm ? `#${num(m.ranks.realm)} on ${c.realm.name}` : 'rating this season'}
        />
        <StatTile label="Raid" value={raid?.value ?? '–'} note={raid?.note} />
        <StatTile label="Achievements" value={num(c.achievementPoints)} note="points" />
      </SimpleGrid>

      {!c.sources.blizzard && (
        <Text size="sm" c="dimmed">
          Showing Raider.IO&apos;s data only. Gear details, stats, PvP, professions and collections come from
          Blizzard&apos;s API, which needs the server&apos;s Blizzard keys
          {c.sources.raiderio ? '' : ', and Raider.IO doesn’t know this character yet'}.
        </Text>
      )}

      {(m.best.length > 0 || m.ranks) && (
        <Section
          title="Mythic+"
          note={m.season ? `Season ${m.season.replace(/^season-/, '').toUpperCase()}, from Raider.IO.` : undefined}
        >
          <Stack gap="lg">
            {(m.ranks || m.roles) && (
              <Group gap="xl" wrap="wrap">
                {m.ranks && (
                  <Text size="sm">
                    Rank <b className="num">#{num(m.ranks.world)}</b> world ·{' '}
                    <b className="num">#{num(m.ranks.region)}</b> region · <b className="num">#{num(m.ranks.realm)}</b>{' '}
                    realm
                    {m.ranks.classWorld ? (
                      <>
                        {' '}
                        · <b className="num">#{num(m.ranks.classWorld)}</b> {c.className ?? 'class'} in the world
                      </>
                    ) : null}
                  </Text>
                )}
                {m.roles && (
                  <Text size="sm" c="dimmed">
                    {(['tank', 'healer', 'dps'] as const)
                      .filter((r) => m.roles![r] > 0)
                      .map((r) => `${r === 'dps' ? 'DPS' : r.charAt(0).toUpperCase() + r.slice(1)} ${num(m.roles![r])}`)
                      .join(' · ')}
                  </Text>
                )}
              </Group>
            )}
            {m.best.length > 0 && (
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
                <div>
                  <Heading>Best runs</Heading>
                  <RunList runs={m.best} />
                </div>
                {m.recent.length > 0 && (
                  <div>
                    <Heading>Recent runs</Heading>
                    <RunList runs={m.recent} showDay />
                  </div>
                )}
              </SimpleGrid>
            )}
          </Stack>
        </Section>
      )}

      <Raids c={c} />

      {c.gear.length > 0 && (
        <Section title="Gear" note={c.sources.blizzard ? 'With enchants and gems.' : undefined}>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs" verticalSpacing="xs">
            {c.gear.map((g) => (
              <Group key={`${g.slot}-${g.itemId}`} gap="sm" wrap="nowrap" align="flex-start">
                <Avatar src={g.icon} alt="" size={36} radius="sm" style={{ flexShrink: 0 }}>
                  {' '}
                </Avatar>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Text size="sm" fw={600} truncate c={QUALITY_COLORS[g.quality]}>
                      {g.name}
                    </Text>
                    <Text size="sm" className="num" style={{ flexShrink: 0 }}>
                      {g.itemLevel ?? ''}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed" truncate>
                    {[g.slot.charAt(0).toUpperCase() + g.slot.slice(1), g.enchant, ...g.gems]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </div>
              </Group>
            ))}
          </SimpleGrid>
        </Section>
      )}

      {(c.stats || c.pvp?.brackets.length || c.professions.length > 0) && (
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing={48}>
          {c.stats && (
            <Section title="Stats">
              <Stack gap={6}>
                {c.stats.primary && <Line label={c.stats.primary[0]} value={num(c.stats.primary[1])} />}
                <Line label="Stamina" value={num(c.stats.stamina)} />
                <Line label="Health" value={num(c.stats.health)} />
                <Line label="Critical strike" value={c.stats.crit != null ? `${c.stats.crit}%` : '–'} />
                <Line label="Haste" value={c.stats.haste != null ? `${c.stats.haste}%` : '–'} />
                <Line label="Mastery" value={c.stats.mastery != null ? `${c.stats.mastery}%` : '–'} />
                <Line label="Versatility" value={c.stats.versatility != null ? `${c.stats.versatility}%` : '–'} />
                {!!c.stats.leech && <Line label="Leech" value={`${c.stats.leech}%`} />}
                {!!c.stats.avoidance && <Line label="Avoidance" value={`${c.stats.avoidance}%`} />}
                {!!c.stats.speed && <Line label="Speed" value={`${c.stats.speed}%`} />}
              </Stack>
            </Section>
          )}
          {c.pvp && (
            <Section title="PvP" note={c.pvp.honor ? `Honor level ${c.pvp.honor}.` : undefined}>
              {c.pvp.brackets.length ? (
                <Stack gap={6}>
                  {c.pvp.brackets.map((b) => (
                    <div key={b.bracket}>
                      <Line label={bracketName(b.bracket)} value={num(b.rating)} />
                      <Text size="xs" c="dimmed">
                        {num(b.won)} won of {num(b.played)} this season
                      </Text>
                    </div>
                  ))}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  No rated games this season.
                </Text>
              )}
            </Section>
          )}
          {c.professions.length > 0 && (
            <Section title="Professions">
              <Stack gap="sm">
                {c.professions.map((p) => (
                  <div key={p.name}>
                    <Line label={p.name} value={p.max ? `${num(p.skill)} / ${num(p.max)}` : num(p.skill)} />
                    {p.max ? <Meter value={p.skill ?? 0} max={p.max} /> : null}
                    {p.tier && (
                      <Text size="xs" c="dimmed">
                        {p.tier}
                      </Text>
                    )}
                  </div>
                ))}
              </Stack>
            </Section>
          )}
        </SimpleGrid>
      )}

      {c.collections && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xl">
          <StatTile label="Mounts" value={num(c.collections.mounts)} />
          <StatTile label="Pets" value={num(c.collections.pets)} />
          <StatTile label="Toys" value={num(c.collections.toys)} />
          <StatTile label="Titles" value={num(c.collections.titles)} />
        </SimpleGrid>
      )}

      <WowProgress c={c} refreshedAt={refreshedAt} />
    </Stack>
  );
}

function RunList({ runs, showDay = false }: { runs: WowRun[]; showDay?: boolean }) {
  return (
    <Stack gap={8} mt={6}>
      {runs.slice(0, 10).map((r, i) => {
        const timed = r.upgrades > 0;
        return (
          <Group key={`${r.dungeon}-${r.at}-${i}`} justify="space-between" gap="sm" wrap="nowrap">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} truncate>
                {r.url ? (
                  <Anchor href={r.url} target="_blank" rel="noreferrer" c="inherit" inherit>
                    {r.dungeon}
                  </Anchor>
                ) : (
                  r.dungeon
                )}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {r.minutes != null
                  ? `${Math.floor(r.minutes)}:${String(Math.round((r.minutes % 1) * 60)).padStart(2, '0')}`
                  : ''}
                {r.parMinutes ? ` of ${Math.round(r.parMinutes)} min` : ''}
                {showDay && r.at ? ` · ${day(r.at)}` : ''}
              </Text>
            </div>
            <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
              <Badge
                variant={timed ? 'light' : 'outline'}
                color={timed ? undefined : 'gray'}
                radius="sm"
                tt="none"
                className="num"
              >
                +{r.level}
                {'★'.repeat(Math.min(3, r.upgrades))}
              </Badge>
              {r.score != null && (
                <Text size="xs" c="dimmed" className="num" w={44} ta="right">
                  {num(r.score, 1)}
                </Text>
              )}
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
}

function Raids({ c }: { c: WowCharacter }) {
  if (c.raids?.instances.length) {
    return (
      <Section
        title="Raids"
        note={c.raids.expansion ? `${c.raids.expansion}, bosses killed per difficulty.` : undefined}
      >
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
          {[...c.raids.instances].reverse().map((inst) => (
            <div key={inst.name}>
              <Heading>{inst.name}</Heading>
              <Stack gap={8} mt={6}>
                {inst.modes.map((md) => (
                  <div key={md.difficulty}>
                    <Line label={md.difficulty} value={`${md.killed} / ${md.total}`} />
                    <Meter value={md.killed} max={md.total} />
                  </div>
                ))}
              </Stack>
            </div>
          ))}
        </SimpleGrid>
      </Section>
    );
  }
  if (!c.raidProgress.length) return null;
  return (
    <Section title="Raids" note="Bosses killed per difficulty, from Raider.IO.">
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
        {c.raidProgress.slice(0, 4).map((r) => (
          <div key={r.slug}>
            <Heading>{r.name}</Heading>
            <Stack gap={8} mt={6}>
              {(
                [
                  ['Normal', r.normal],
                  ['Heroic', r.heroic],
                  ['Mythic', r.mythic],
                ] as const
              ).map(([label, v]) => (
                <div key={label}>
                  <Line label={label} value={`${v} / ${r.total}`} />
                  <Meter value={v} max={r.total} />
                </div>
              ))}
            </Stack>
          </div>
        ))}
      </SimpleGrid>
    </Section>
  );
}

function WowProgress({ c, refreshedAt }: { c: WowCharacter; refreshedAt: string }) {
  const [days, setDays] = useState<Snapshot<WowSnapshot>[] | null>(null);
  useEffect(() => {
    fetchGameHistory<WowSnapshot>('wow')
      .then(setDays)
      .catch(() => setDays([]));
  }, [refreshedAt]);
  if (!days) return <Loader size="sm" />;
  const series = (key: 'itemLevel' | 'mythic' | 'achievements'): TrendPoint[] =>
    days.flatMap((d) => {
      const value = d.data.characters?.[c.key]?.[key];
      return value != null ? [{ day: d.day, value }] : [];
    });
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={48}>
      <Section title="Item level over time">
        <TrendChart points={series('itemLevel')} format={(v) => v.toFixed(1)} />
      </Section>
      <Section title="Mythic+ rating over time">
        <TrendChart points={series('mythic')} format={(v) => Math.round(v).toLocaleString()} />
      </Section>
    </SimpleGrid>
  );
}
