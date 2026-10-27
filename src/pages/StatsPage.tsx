import {
  Anchor,
  Grid,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarList, Columns, Donut, StatTile, type Slice } from '../components/charts';
import { PlatformIcon } from '../components/PlatformBadge';
import { PhysicalPlatformIcon } from '../components/PhysicalPlatformIcon';
import { PLATFORMS } from '../data/platforms';
import { formatHoursNumber, formatPlaytime, formatPrice } from '../lib/format';
import { useLibrary } from '../lib/library';
import { STATS_GAMES } from '../lib/gameStats';
import { computeStats } from '../lib/stats';
import { useStore, type GameStatsId } from '../lib/store';
import { FfxivStats } from './FfxivStats';
import { Gw2Stats } from './Gw2Stats';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GENRE_COLORS = ['var(--sp-c1)', 'var(--sp-c2)', 'var(--sp-c3)', 'var(--sp-c4)', 'var(--sp-c5)'];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ height: '100%' }}>
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

const hours = (m: number) => formatPlaytime(m);

function OverviewStats() {
  const all = useLibrary({ includeApps: true });
  const physical = useStore((s) => s.physical);
  const wishlist = useStore((s) => s.wishlist);
  const history = useStore((s) => s.history);
  const progress = useStore((s) => s.progress);
  const achievements = useStore((s) => s.achievements);
  const stats = useMemo(
    () => computeStats(all, physical, { log: history.log, since: history.since, progress, achievements }),
    [all, physical, history, progress, achievements],
  );
  const [genreBy, setGenreBy] = useState<'hours' | 'games'>('hours');
  const [yearGamesShown, setYearGamesShown] = useState(8);

  if (!stats.gamesPlayed && !stats.collection.copies) {
    return <Text c="dimmed">Import or add some games and your stats will show up here.</Text>;
  }

  // Top five genres plus "Other": a donut stays readable up to six slices.
  const ranked = [...stats.genres].sort((a, b) => (genreBy === 'hours' ? b.minutes - a.minutes : b.games - a.games));
  const value = (s: { minutes: number; games: number }) => (genreBy === 'hours' ? s.minutes : s.games);
  const show = (v: number) => (genreBy === 'hours' ? hours(v) : `${v} ${v === 1 ? 'game' : 'games'}`);
  const genreSlices: Slice[] = ranked.slice(0, 5).map((g, i) => ({
    label: g.label,
    value: value(g),
    display: show(value(g)),
    color: GENRE_COLORS[i],
  }));
  const rest = ranked.slice(5);
  if (rest.length) {
    const v = rest.reduce((n, g) => n + value(g), 0);
    genreSlices.push({ label: `Other (${rest.length})`, value: v, display: show(v), color: 'var(--sp-c-other)' });
  }

  const y = stats.year;
  const unplayed = stats.collection.unplayed;
  const a = stats.achievements;

  return (
    <Stack gap={56}>
      <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }} spacing="md">
        <StatTile
          label="Hours played"
          value={formatHoursNumber(stats.totalMinutes)}
          note={`Across ${stats.gamesPlayed} games`}
        />
        <StatTile
          label="Average per game"
          value={hours(stats.averageMinutes)}
          note={`Typical game: ${hours(stats.medianMinutes)}`}
        />
        <StatTile
          label={`Played in ${y.year}`}
          value={y.played.length}
          note={`${y.played.length === 1 ? 'game' : 'games'}, ${hours(y.minutes)} all time`}
        />
        <StatTile label="Top 5 games" value={`${Math.round(stats.topFiveShare * 100)}%`} note="of all your play time" />
        <StatTile
          label="Physical copies"
          value={stats.collection.copies}
          note={
            stats.collection.spent
              ? `${formatPrice(stats.collection.spent)} spent`
              : `${unplayed.length} not played yet`
          }
        />
        <StatTile
          label="Apps"
          value={formatHoursNumber(stats.appMinutes)}
          note={stats.appCount ? `hours in ${stats.appCount} apps, not counted above` : 'No apps imported'}
        />
      </SimpleGrid>

      <Grid gap={48}>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Section
            title="Genres you play"
            note={
              genreBy === 'hours'
                ? "Each game's hours are split evenly across its genres."
                : 'How many games you played in each genre.'
            }
          >
            <Stack gap="md">
              <SegmentedControl
                size="xs"
                value={genreBy}
                onChange={(v) => setGenreBy(v as 'hours' | 'games')}
                data={[
                  { value: 'hours', label: 'By hours' },
                  { value: 'games', label: 'By games' },
                ]}
                style={{ alignSelf: 'flex-start' }}
              />
              <Donut
                slices={genreSlices}
                center={
                  <>
                    <Text className="display num" fw={700} fz={22} lh={1}>
                      {genreBy === 'hours' ? formatHoursNumber(stats.totalMinutes) : stats.gamesPlayed}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {genreBy === 'hours' ? 'hours' : 'games'}
                    </Text>
                  </>
                }
              />
            </Stack>
          </Section>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Section title="Time by platform">
            <BarList
              bars={PLATFORMS.filter((p) => stats.platforms[p.id] > 0)
                .sort((a, b) => stats.platforms[b.id] - stats.platforms[a.id])
                .map((p) => ({
                  label: p.name,
                  value: stats.platforms[p.id],
                  display: `${hours(stats.platforms[p.id])}, ${Math.round((stats.platforms[p.id] / (stats.totalMinutes || 1)) * 100)}%`,
                  icon: <PlatformIcon platform={p.id} size={14} />,
                  color: p.colorVar,
                }))}
            />
          </Section>
        </Grid.Col>
      </Grid>

      <Section
        title={`${y.year} so far`}
        note={`Games you played in ${y.year}, with their all-time hours. The graph counts them by the month you last played each.`}
      >
        <Grid gap="xl">
          <Grid.Col span={{ base: 12, md: 7 }}>
            {y.played.length ? (
              <Columns
                columns={y.byMonth.map((n, i) => ({
                  label: MONTHS[i],
                  value: n,
                  display: `${n} ${n === 1 ? 'game' : 'games'}`,
                }))}
              />
            ) : (
              <Text size="sm" c="dimmed">
                Nothing played in {y.year} yet.
              </Text>
            )}
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Text size="sm" fw={600} mb="xs">
              Games played in {y.year}
            </Text>
            {y.played.length ? (
              <BarList
                bars={y.played.slice(0, yearGamesShown).map((item) => ({
                  label: item.game.title,
                  value: item.totalMinutes,
                  display: hours(item.totalMinutes),
                  href: `/game/${item.game.id}`,
                }))}
              />
            ) : (
              <Text size="sm" c="dimmed">
                Nothing played this year yet.
              </Text>
            )}
            {y.played.length > yearGamesShown && (
              <Anchor
                component="button"
                type="button"
                size="sm"
                mt="xs"
                onClick={() => setYearGamesShown(y.played.length)}
              >
                Show all {y.played.length}
              </Anchor>
            )}
            <Text size="sm" c="dimmed" mt="md">
              {y.played.length} {y.played.length === 1 ? 'game' : 'games'} played this year, {hours(y.minutes)} in them
              all time
              {stats.finishedThisYear > 0 && `, ${stats.finishedThisYear} finished`}.
            </Text>
          </Grid.Col>
        </Grid>
      </Section>

      <Grid gap={48}>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Section title="Most played, all time">
            <BarList
              bars={stats.top.map((l) => ({
                label: l.game.title,
                value: l.totalMinutes,
                display: hours(l.totalMinutes),
                href: `/game/${l.game.id}`,
              }))}
            />
          </Section>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Stack gap="lg" h="100%">
            <Section title="How deep you go" note="Your games by total hours played.">
              <Columns
                height={120}
                columns={stats.depth.map((d) => ({
                  label: d.label,
                  value: d.games,
                  display: `${d.games} ${d.games === 1 ? 'game' : 'games'}`,
                }))}
              />
            </Section>
            <Section title="Favourite sub-genres" note="By hours, split across each game's sub-genres.">
              <BarList
                bars={stats.subgenres.slice(0, 6).map((s) => ({
                  label: s.label,
                  value: s.minutes,
                  display: hours(s.minutes),
                }))}
              />
            </Section>
          </Stack>
        </Grid.Col>
      </Grid>

      <Grid gap={48}>
        <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
          <Section title="Top developers">
            {stats.developers.length ? (
              <BarList
                bars={stats.developers.slice(0, 5).map((d) => ({
                  label: d.label,
                  value: d.minutes,
                  display: hours(d.minutes),
                }))}
              />
            ) : (
              <Text size="sm" c="dimmed">
                Developer names fill in as game details are looked up.
              </Text>
            )}
          </Section>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
          <Section title="Your gaming eras" note="Hours by the decade a game came out.">
            {stats.decades.length ? (
              <Columns
                height={120}
                columns={stats.decades.map((d) => ({ label: d.label, value: d.minutes, display: hours(d.minutes) }))}
              />
            ) : (
              <Text size="sm" c="dimmed">
                Release years fill in as game details are looked up.
              </Text>
            )}
          </Section>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
          <Section title="Achievements">
            {a.games ? (
              <Stack gap="sm">
                <div>
                  <Text className="display num" fw={700} fz={28} lh={1.15}>
                    {Math.round((a.earned / a.total) * 100)}%
                  </Text>
                  <Text size="xs" c="dimmed">
                    of achievements and trophies earned
                  </Text>
                </div>
                <Text size="sm">
                  <b className="num">{a.earned.toLocaleString()}</b> earned across <b className="num">{a.games}</b>{' '}
                  {a.games === 1 ? 'game' : 'games'}
                </Text>
                <Text size="sm">
                  <b className="num">{a.perfect}</b> {a.perfect === 1 ? 'game' : 'games'} at 100%
                  {a.platinums > 0 && (
                    <>
                      , <b className="num">{a.platinums}</b> {a.platinums === 1 ? 'platinum' : 'platinums'}
                    </>
                  )}
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                Achievements and trophies load in the background after a Steam or PlayStation sync.
              </Text>
            )}
          </Section>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
          <Section title="Collection">
            <Stack gap="sm">
              {stats.collection.byPlatform.length ? (
                <Group gap="md">
                  {stats.collection.byPlatform.map((p) => (
                    <Group key={p.platform} gap={6} wrap="nowrap">
                      <PhysicalPlatformIcon platform={p.platform} size={16} />
                      <Text size="sm">
                        {p.platform}: <b className="num">{p.copies}</b>
                      </Text>
                    </Group>
                  ))}
                </Group>
              ) : (
                <Text size="sm" c="dimmed">
                  No physical games yet.
                </Text>
              )}
              <Text size="sm">
                <b className="num">{unplayed.length}</b> physical {unplayed.length === 1 ? 'game' : 'games'} not played
                yet
                {unplayed.length > 0 &&
                  `: ${unplayed
                    .slice(0, 3)
                    .map((l) => l.game.title)
                    .join(', ')}${unplayed.length > 3 ? ', …' : ''}`}
              </Text>
              <Text size="sm">
                <b className="num">{wishlist.length}</b> {wishlist.length === 1 ? 'game' : 'games'} on your{' '}
                <Anchor component={Link} to="/wishlist" size="sm">
                  wishlist
                </Anchor>
              </Text>
            </Stack>
          </Section>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

/** A game's own tab: its stats, and a way to remove the tab. */
function GameTab({ id, onRemove }: { id: GameStatsId; onRemove: () => void }) {
  return (
    <Stack gap={48}>
      {id === 'ffxiv' && <FfxivStats />}
      {id === 'gw2' && <Gw2Stats />}
      <Anchor
        component="button"
        type="button"
        size="sm"
        c="dimmed"
        onClick={onRemove}
        style={{ alignSelf: 'flex-start' }}
      >
        Remove this tab
      </Anchor>
    </Stack>
  );
}

export function StatsPage() {
  const gameStats = useStore((s) => s.gameStats) ?? { enabled: false, games: [] };
  const setGameStats = useStore((s) => s.setGameStats);
  const [tab, setTab] = useState<string>('overview');
  const games = STATS_GAMES.filter((g) => gameStats.games.includes(g.id));
  const addable = STATS_GAMES.filter((g) => !gameStats.games.includes(g.id));
  const current = gameStats.enabled && games.some((g) => g.id === tab) ? tab : 'overview';

  const header = (
    <Group justify="space-between" align="flex-end" gap="md">
      <div>
        <Title order={1}>My Stats</Title>
        <Text c="dimmed" mt={6} size="lg">
          Where your play time goes, across every platform.
        </Text>
      </div>
      <Switch
        label="Game-specific stats"
        checked={gameStats.enabled}
        onChange={(e) => setGameStats({ enabled: e.currentTarget.checked })}
      />
    </Group>
  );

  if (!gameStats.enabled) {
    return (
      <Stack gap={40}>
        {header}
        <OverviewStats />
      </Stack>
    );
  }

  return (
    <Stack gap={40}>
      {header}
      <Tabs value={current} onChange={(v) => setTab(v ?? 'overview')} keepMounted={false}>
        <Group justify="space-between" align="flex-end" gap="sm" wrap="wrap" mb={40}>
          <Tabs.List style={{ flex: '1 1 auto' }}>
            <Tabs.Tab value="overview">Overview</Tabs.Tab>
            {games.map((g) => (
              <Tabs.Tab key={g.id} value={g.id}>
                {g.short}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {addable.length > 0 && (
            <Select
              size="sm"
              placeholder="Add a game"
              aria-label="Add a game"
              data={addable.map((g) => ({ value: g.id, label: g.name }))}
              value={null}
              onChange={(v) => {
                if (!v) return;
                setGameStats({ games: [...gameStats.games, v as GameStatsId] });
                setTab(v);
              }}
              w={240}
              comboboxProps={{ position: 'bottom-end', width: 'target' }}
            />
          )}
        </Group>
        <Tabs.Panel value="overview">
          <OverviewStats />
        </Tabs.Panel>
        {games.map((g) => (
          <Tabs.Panel key={g.id} value={g.id}>
            <GameTab
              id={g.id}
              onRemove={() => {
                setGameStats({ games: gameStats.games.filter((x) => x !== g.id) });
                setTab('overview');
              }}
            />
          </Tabs.Panel>
        ))}
      </Tabs>
    </Stack>
  );
}
