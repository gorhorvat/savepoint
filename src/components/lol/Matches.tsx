import { Badge, Button, Group, Loader, Paper, Select, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import {
  backfillLol,
  fetchLolChampions,
  fetchLolMatch,
  fetchLolMatches,
  fetchLolTimeline,
  type LolMatch,
  type LolMatchDetail,
  type LolMatchPlayer,
  type LolPlayer,
  type LolTimeline,
} from '../../lib/gameStats';
import { TrendChart } from '../TrendChart';
import { Champ, Heading, Icon, Line, Meter } from './common';
import { day, fmt, kda, ROLES, short, winColor } from './format';

const MULTI = ['', '', 'Double kill', 'Triple kill', 'Quadra kill', 'Penta kill'];
const ARENA = new Set([1700, 1710]);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** One match in a list; opens to the full match. */
export function MatchRow({ m }: { m: LolMatch }) {
  const [open, setOpen] = useState(false);
  const color = winColor(m.win, m.remake);
  const result = m.remake ? 'Remake' : m.placement ? `#${m.placement}` : m.win ? 'Win' : 'Loss';
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 10 }}>
      <UnstyledButton onClick={() => setOpen((o) => !o)} w="100%" aria-expanded={open}>
        <Group justify="space-between" gap="sm" wrap="nowrap">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <Champ image={m.image} />
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} truncate>
                {m.champion}
                <Text span size="xs" c="dimmed" fw={400}>
                  {m.role && ROLES[m.role] ? ` · ${ROLES[m.role]}` : ''}
                </Text>
                {!!m.multikill && m.multikill >= 3 && (
                  <Badge component="span" size="xs" variant="light" ml={6} radius="xs">
                    {MULTI[m.multikill]}
                  </Badge>
                )}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                <Text span size="xs" c={color} fw={600}>
                  {result}
                </Text>{' '}
                · {m.queue} · {day(m.end)}
              </Text>
            </div>
          </Group>
          <Group gap="md" wrap="nowrap" style={{ flexShrink: 0 }}>
            {m.items && (
              <Group gap={2} wrap="nowrap" visibleFrom="md">
                {m.items.map((img, i) => (
                  <Icon key={i} thing={img ? { id: i, name: '', image: img } : null} size={20} />
                ))}
              </Group>
            )}
            <div style={{ textAlign: 'right' }}>
              <Text size="sm" className="num">
                {m.kills} / {m.deaths} / {m.assists}
              </Text>
              <Text size="xs" c="dimmed" className="num">
                {kda(m.kills, m.deaths, m.assists)} KDA · {m.cs} CS · {m.minutes} min
              </Text>
            </div>
            {open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} style={{ opacity: 0.5 }} />}
          </Group>
        </Group>
      </UnstyledButton>
      {open && <MatchDetail id={m.id} />}
    </div>
  );
}

const OBJECTIVES: [string, string][] = [
  ['tower', 'Towers'],
  ['inhibitor', 'Inhibitors'],
  ['dragon', 'Dragons'],
  ['baron', 'Barons'],
  ['riftHerald', 'Heralds'],
  ['horde', 'Voidgrubs'],
  ['atakhan', 'Atakhan'],
];

function PlayerLine({ p, maxDmg, minutes }: { p: LolMatchPlayer; maxDmg: number; minutes: number }) {
  return (
    <div
      className="lol-player"
      style={{ background: p.me ? 'var(--mantine-primary-color-light)' : undefined, borderRadius: 6 }}
    >
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <div style={{ position: 'relative' }}>
          <Champ image={p.image} size={32} label={p.champion} />
          {p.lvl != null && (
            <Text
              size="10px"
              fw={700}
              className="num"
              style={{
                position: 'absolute',
                right: -4,
                bottom: -4,
                background: 'var(--sp-surface)',
                borderRadius: 8,
                padding: '0 3px',
              }}
            >
              {p.lvl}
            </Text>
          )}
        </div>
        <Stack gap={2}>
          <Group gap={2} wrap="nowrap">
            <Icon thing={p.spells[0]} size={15} />
            <Icon thing={p.spells[1]} size={15} />
          </Group>
          <Group gap={2} wrap="nowrap">
            <Icon thing={p.runes?.list[0]} size={15} round />
            <Icon thing={p.runes?.secondary} size={15} round />
          </Group>
        </Stack>
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={p.me ? 700 : 500} truncate>
            {p.name ?? p.champion}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {p.placement ? `#${p.placement} · ` : ''}
            {p.role && ROLES[p.role] ? ROLES[p.role] : p.champion}
          </Text>
        </div>
      </Group>
      <div>
        <Text size="sm" className="num">
          {p.k}/{p.d}/{p.a}
        </Text>
        <Text size="xs" c="dimmed" className="num">
          {kda(p.k, p.d, p.a)}
          {p.kp != null ? ` · ${Math.round(p.kp * 100)}%` : ''}
        </Text>
      </div>
      <div>
        <Text size="sm" className="num">
          {fmt(p.dmg)}
        </Text>
        <Meter value={p.dmg} max={maxDmg} />
      </div>
      <div>
        <Text size="sm" className="num">
          {short(p.gold)}
        </Text>
        <Text size="xs" c="dimmed" className="num">
          {p.cs} CS · {(p.cs / Math.max(1, minutes)).toFixed(1)}
        </Text>
      </div>
      <Text size="sm" className="num">
        {p.vision}
      </Text>
      <Group gap={2} wrap="nowrap">
        {p.items.map((it, i) => (
          <Icon key={i} thing={it} size={22} />
        ))}
      </Group>
    </div>
  );
}

function TeamBlock({
  match,
  team,
  players,
}: {
  match: LolMatchDetail;
  team?: LolMatchDetail['teams'][number];
  players: LolMatchPlayer[];
}) {
  const minutes = match.seconds / 60;
  const maxDmg = Math.max(1, ...match.players.map((p) => p.dmg));
  const k = players.reduce((n, p) => n + p.k, 0);
  const gold = players.reduce((n, p) => n + p.gold, 0);
  return (
    <div>
      {team && (
        <Group justify="space-between" gap="sm" mb={6} wrap="wrap">
          <Text size="sm" fw={700} c={winColor(team.win)}>
            {team.win ? 'Victory' : 'Defeat'}{' '}
            <Text span size="xs" c="dimmed" fw={400}>
              · {team.id === 100 ? 'Blue' : 'Red'} side · {k} kills · {short(gold)} gold
            </Text>
          </Text>
          <Group gap="sm" wrap="wrap">
            {OBJECTIVES.filter(([key]) => team.obj[key] != null && (key !== 'atakhan' || team.obj[key] > 0)).map(
              ([key, label]) => (
                <Text key={key} size="xs" c="dimmed">
                  {label} <b className="num">{team.obj[key]}</b>
                </Text>
              ),
            )}
            {!!team.bans.length && (
              <Group gap={2} wrap="nowrap">
                <Text size="xs" c="dimmed" mr={2}>
                  Bans
                </Text>
                {team.bans.map((b, i) => (
                  <Icon key={i} thing={b} size={18} />
                ))}
              </Group>
            )}
          </Group>
        </Group>
      )}
      <div className="lol-player lol-player--head">
        <Text size="xs" c="dimmed">
          Player
        </Text>
        <Text size="xs" c="dimmed">
          KDA · KP
        </Text>
        <Text size="xs" c="dimmed">
          Damage
        </Text>
        <Text size="xs" c="dimmed">
          Gold · CS
        </Text>
        <Text size="xs" c="dimmed">
          Vision
        </Text>
        <Text size="xs" c="dimmed">
          Items
        </Text>
      </div>
      {players.map((p, i) => (
        <PlayerLine key={i} p={p} maxDmg={maxDmg} minutes={minutes} />
      ))}
    </div>
  );
}

/** The player's own numbers in the match, beyond the scoreboard. */
function YourGame({ me, minutes }: { me: LolMatchPlayer; minutes: number }) {
  const multis = me.multi
    .map((n, i) => (n ? `${n} ${MULTI[i + 2].toLowerCase()}${n > 1 ? 's' : ''}` : null))
    .filter(Boolean)
    .join(', ');
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={4}>
      <Stack gap={0}>
        <Heading>Combat</Heading>
        <Line label="Multikills" value={multis || 'None'} />
        <Line label="Largest killing spree" value={me.spree} />
        <Line label="Solo kills" value={me.solo} />
        <Line label="First blood" value={me.fb ? 'Yes' : 'No'} />
        <Line label="Crowd control" value={`${fmt(me.cc)} s`} />
      </Stack>
      <Stack gap={0}>
        <Heading>Damage</Heading>
        <Line label="To champions" value={`${fmt(me.dmg)} · ${fmt(me.dmg / Math.max(1, minutes))}/min`} />
        {me.dmgShare != null && <Line label="Share of team damage" value={`${Math.round(me.dmgShare * 100)}%`} />}
        <Line label="Taken · mitigated" value={`${short(me.taken)} · ${short(me.mitigated)}`} />
        <Line label="To buildings" value={fmt(me.towers)} />
        <Line label="To objectives" value={fmt(me.objectives)} />
        <Line label="Healing · shielding allies" value={`${short(me.heal)} · ${short(me.shield)}`} />
      </Stack>
      <Stack gap={0}>
        <Heading>Vision and runes</Heading>
        <Line label="Vision score" value={`${me.vision} · ${(me.vision / Math.max(1, minutes)).toFixed(2)}/min`} />
        <Line label="Wards placed · killed" value={`${me.wards} · ${me.wardsKilled}`} />
        <Line label="Control wards bought" value={me.pinks} />
        {me.runes && (
          <Group gap={4} mt={6} wrap="wrap">
            <Icon thing={me.runes.primary} size={20} round />
            {me.runes.list.slice(0, 4).map((r, i) => (
              <Icon key={i} thing={r} size={i ? 20 : 26} round />
            ))}
            <Icon thing={me.runes.secondary} size={20} round />
            {me.runes.list.slice(4).map((r, i) => (
              <Icon key={i} thing={r} size={20} round />
            ))}
          </Group>
        )}
        {me.runes?.shards.length ? (
          <Text size="xs" c="dimmed" mt={4}>
            {me.runes.shards.join(' · ')}
          </Text>
        ) : null}
      </Stack>
    </SimpleGrid>
  );
}

/** The whole match: both teams, your numbers, and the timeline on request. */
export function MatchDetail({ id }: { id: string }) {
  const [match, setMatch] = useState<LolMatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<LolTimeline | 'loading' | null>(null);

  useEffect(() => {
    fetchLolMatch(id)
      .then(setMatch)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const loadTimeline = () => {
    setTimeline('loading');
    fetchLolTimeline(id)
      .then(setTimeline)
      .catch((e: Error) => {
        setError(e.message);
        setTimeline(null);
      });
  };

  if (error && !match)
    return (
      <Text size="sm" c="red" py="sm">
        {error}
      </Text>
    );
  if (!match) return <Loader size="sm" my="sm" />;

  const me = match.players.find((p) => p.me);
  const minutes = match.seconds / 60;
  const arena = ARENA.has(match.queueId);

  return (
    <Paper p="md" mt="xs" mb="md" withBorder>
      <Stack gap="lg">
        <Text size="xs" c="dimmed">
          {match.queue} · {new Date(match.end).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
          {mmss(match.seconds)}
          {match.version ? ` · patch ${match.version}` : ''}
        </Text>
        <div style={{ overflowX: 'auto' }}>
          <Stack gap="lg" miw={760}>
            {arena ? (
              <TeamBlock
                match={match}
                players={[...match.players].sort((a, b) => (a.placement ?? 9) - (b.placement ?? 9))}
              />
            ) : (
              match.teams.map((t) => (
                <TeamBlock key={t.id} match={match} team={t} players={match.players.filter((p) => p.team === t.id)} />
              ))
            )}
          </Stack>
        </div>
        {me && <YourGame me={me} minutes={minutes} />}
        {timeline === null && !arena && (
          <Button variant="light" size="xs" w="fit-content" onClick={loadTimeline}>
            Show timeline: gold, build and skill order
          </Button>
        )}
        {timeline === 'loading' && <Loader size="sm" />}
        {timeline && timeline !== 'loading' && <Timeline match={match} t={timeline} />}
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

const MONSTERS: Record<string, string> = {
  FIRE_DRAGON: 'Infernal Drake',
  WATER_DRAGON: 'Ocean Drake',
  EARTH_DRAGON: 'Mountain Drake',
  AIR_DRAGON: 'Cloud Drake',
  HEXTECH_DRAGON: 'Hextech Drake',
  CHEMTECH_DRAGON: 'Chemtech Drake',
  ELDER_DRAGON: 'Elder Dragon',
  BARON_NASHOR: 'Baron Nashor',
  RIFTHERALD: 'Rift Herald',
  HORDE: 'Voidgrub',
  ATAKHAN: 'Atakhan',
};
const BUILDINGS: Record<string, string> = {
  OUTER_TURRET: 'outer tower',
  INNER_TURRET: 'inner tower',
  BASE_TURRET: 'inhibitor tower',
  NEXUS_TURRET: 'Nexus tower',
  INHIBITOR_BUILDING: 'inhibitor',
};
const LANES: Record<string, string> = { TOP_LANE: 'top', MID_LANE: 'mid', BOT_LANE: 'bot' };

function Timeline({ match, t }: { match: LolMatchDetail; t: LolTimeline }) {
  const meIdx = match.players.findIndex((p) => p.me);
  const me = match.players[meIdx];
  const myTeam = me?.team ?? 100;
  const opp = me ? match.players.findIndex((p) => p.team !== myTeam && p.role && p.role === me.role) : -1;
  const name = (i: number) => (i < 0 ? 'Minions' : i === meIdx ? 'You' : (match.players[i]?.champion ?? '?'));

  const lead = useMemo(
    () =>
      t.gold.map((row, minute) => ({
        day: minute,
        value: row.reduce((n, g, i) => n + (match.players[i]?.team === myTeam ? g : -g), 0),
      })),
    [t, match, myTeam],
  );

  const at = (min: number) => Math.min(min, t.gold.length - 1);
  const snap = [10, 15, 20].filter((m) => m < t.gold.length);

  const builds = useMemo(() => {
    const byMin = new Map<number, number[]>();
    for (const e of t.events) {
      if (e.type === 'item' && e.by === meIdx) {
        const m = Math.floor(e.at / 60);
        byMin.set(m, [...(byMin.get(m) ?? []), e.item]);
      }
    }
    return [...byMin];
  }, [t, meIdx]);
  const skills = t.events
    .filter((e) => e.type === 'skill' && e.by === meIdx)
    .map((e) => (e.type === 'skill' ? e.skill : 0));

  const feed = t.events.filter(
    (e) =>
      (e.type === 'kill' && (e.by === meIdx || e.victim === meIdx || e.assists.includes(meIdx))) ||
      e.type === 'monster' ||
      e.type === 'building',
  );
  const side = (team: number) => (team === myTeam ? 'Your team' : 'Enemy team');

  return (
    <Stack gap="lg">
      <div>
        <Heading>Gold lead</Heading>
        <Text size="xs" c="dimmed" mb={8}>
          Your team&apos;s gold minus the enemy team&apos;s, each minute.
        </Text>
        <TrendChart points={lead} format={(v) => `${v > 0 ? '+' : ''}${short(v)}`} empty="Too short for a graph." />
      </div>
      {me && snap.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: snap.length }} spacing={28}>
          {snap.map((m) => (
            <Stack key={m} gap={0}>
              <Heading>At {m} minutes</Heading>
              <Line label="Your gold · CS" value={`${short(t.gold[at(m)][meIdx])} · ${t.cs[at(m)][meIdx]}`} />
              {opp >= 0 && (
                <Line
                  label={`${match.players[opp].champion}`}
                  value={`${short(t.gold[at(m)][opp])} · ${t.cs[at(m)][opp]}`}
                />
              )}
              <Line label="Level" value={t.level[at(m)][meIdx]} />
            </Stack>
          ))}
        </SimpleGrid>
      )}
      {builds.length > 0 && (
        <div>
          <Heading>Build order</Heading>
          <Group gap="md" mt={6} wrap="wrap" align="flex-start">
            {builds.map(([min, items]) => (
              <Stack key={min} gap={2} align="center">
                <Group gap={2} wrap="nowrap">
                  {items.map((id, i) => (
                    <Icon key={i} thing={{ id, ...(t.items[id] ?? { name: String(id), image: null }) }} size={24} />
                  ))}
                </Group>
                <Text size="10px" c="dimmed">
                  {min} min
                </Text>
              </Stack>
            ))}
          </Group>
        </div>
      )}
      {skills.length > 0 && (
        <div>
          <Heading>Skill order</Heading>
          <Group gap={3} mt={6} wrap="wrap">
            {skills.map((s, i) => (
              <Text
                key={i}
                size="xs"
                fw={700}
                ta="center"
                w={22}
                py={2}
                style={{
                  borderRadius: 4,
                  background: s === 4 ? 'var(--mantine-primary-color-filled)' : 'var(--sp-raised)',
                  color: s === 4 ? 'var(--mantine-primary-color-contrast)' : undefined,
                }}
              >
                {['', 'Q', 'W', 'E', 'R'][s]}
              </Text>
            ))}
          </Group>
        </div>
      )}
      {feed.length > 0 && (
        <div>
          <Heading>Your kills and deaths, and objectives</Heading>
          <Stack gap={2} mt={6} mah={280} style={{ overflowY: 'auto' }}>
            {feed.map((e, i) => (
              <Group key={i} gap="sm" wrap="nowrap">
                <Text size="xs" c="dimmed" className="num" w={40} style={{ flexShrink: 0 }}>
                  {mmss(e.at)}
                </Text>
                <Text size="sm">
                  {e.type === 'kill' &&
                    (e.victim === meIdx ? (
                      <Text span c="red.5" inherit>
                        {name(e.by)} killed you
                      </Text>
                    ) : e.by === meIdx ? (
                      <>You killed {name(e.victim)}</>
                    ) : (
                      <Text span c="dimmed" inherit>
                        You helped {name(e.by)} kill {name(e.victim)}
                      </Text>
                    ))}
                  {e.type === 'monster' && `${side(e.team)} took ${MONSTERS[e.monster] ?? e.monster}`}
                  {e.type === 'building' &&
                    `${side(e.team === 100 ? 200 : 100)} destroyed the ${LANES[e.lane] ? `${LANES[e.lane]} ` : ''}${BUILDINGS[e.building] ?? 'building'}`}
                </Text>
              </Group>
            ))}
          </Stack>
        </div>
      )}
    </Stack>
  );
}

/** Every archived match, with filters, paging and loading older matches from Riot. */
export function MatchesTab({
  player,
  onArchive,
}: {
  player: LolPlayer;
  onArchive: (a: NonNullable<LolPlayer['archive']>) => void;
}) {
  const [queue, setQueue] = useState<string | null>(null);
  const [champion, setChampion] = useState<string | null>(null);
  const [page, setPage] = useState<{ key: string; list: LolMatch[]; more: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<{
    queues: { value: string; label: string }[];
    champions: { value: string; label: string }[];
  }>({
    queues: [],
    champions: [],
  });

  useEffect(() => {
    fetchLolChampions()
      .then((s) =>
        setOptions({
          queues: s.queues.map((q) => ({ value: String(q.queueId), label: `${q.name} (${q.games})` })),
          champions: s.champions
            .map((c) => ({ value: String(c.championId), label: `${c.name} (${c.games})` }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        }),
      )
      .catch(() => {});
  }, [player.archive?.count]);

  const key = `${queue}|${champion}|${player.archive?.count}`;
  const list = page?.key === key ? page.list : null;
  const more = page?.key === key && page.more;

  useEffect(() => {
    let alive = true;
    fetchLolMatches({ queue: queue ? Number(queue) : null, champion: champion ? Number(champion) : null })
      .then((r) => alive && setPage({ key, list: r.matches, more: r.more }))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [queue, champion, key]);

  const loadMore = async () => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const r = await fetchLolMatches({
        before: list[list.length - 1].end,
        queue: queue ? Number(queue) : null,
        champion: champion ? Number(champion) : null,
      });
      setPage({ key, list: [...list, ...r.matches], more: r.more });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fill = async () => {
    setFilling(true);
    setError(null);
    try {
      onArchive(await backfillLol());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFilling(false);
    }
  };

  const a = player.archive;
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" gap="sm" wrap="wrap">
        <Group gap="sm" wrap="wrap">
          <Select
            placeholder="All queues"
            data={options.queues}
            value={queue}
            onChange={setQueue}
            clearable
            w={220}
            aria-label="Queue"
          />
          <Select
            placeholder="All champions"
            data={options.champions}
            value={champion}
            onChange={setChampion}
            clearable
            searchable
            w={220}
            aria-label="Champion"
          />
        </Group>
        {a && (
          <Group gap="sm" wrap="nowrap">
            <Text size="sm" c="dimmed">
              {fmt(a.count)} matches saved{a.complete ? ', all Riot has' : ''}
            </Text>
            {!a.complete && (
              <Button size="xs" variant="default" loading={filling} onClick={() => void fill()}>
                Load older matches
              </Button>
            )}
          </Group>
        )}
      </Group>
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      {!list ? (
        <Loader size="sm" />
      ) : !list.length ? (
        <Text c="dimmed">No matches{queue || champion ? ' match these filters' : ' yet'}.</Text>
      ) : (
        <Stack gap={10}>
          {list.map((m) => (
            <MatchRow key={m.id} m={m} />
          ))}
          {more && (
            <Button
              variant="subtle"
              size="xs"
              loading={busy}
              onClick={() => void loadMore()}
              style={{ alignSelf: 'flex-start' }}
            >
              Show more
            </Button>
          )}
        </Stack>
      )}
      {a && !a.complete && (
        <Text size="xs" c="dimmed">
          Each refresh also saves up to 40 older matches, so your full history fills in over time (up to 1,000 matches).
        </Text>
      )}
    </Stack>
  );
}
