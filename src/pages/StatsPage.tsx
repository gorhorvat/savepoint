import { Anchor, Grid, Group, SegmentedControl, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarList, Columns, Donut, StatTile, type Slice } from '../components/charts';
import { PlatformIcon } from '../components/PlatformBadge';
import { PhysicalPlatformIcon } from '../components/PhysicalPlatformIcon';
import { PLATFORMS } from '../data/platforms';
import { formatHoursNumber, formatPlaytime, formatPrice } from '../lib/format';
import { useLibrary } from '../lib/library';
import { computeStats } from '../lib/stats';
import { useStore } from '../lib/store';

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

export function StatsPage() {
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

  if (!stats.gamesPlayed && !stats.collection.copies) {
    return (
      <Stack>
        <Title order={1}>My Stats</Title>
        <Text c="dimmed">Import or add some games and your stats will show up here.</Text>
      </Stack>
    );
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
  const t = y.tracked;
  const unplayed = stats.collection.unplayed;
  const a = stats.achievements;
  const sinceLabel = history.since
    ? new Date(history.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return (
    <Stack gap={56}>
      <div>
        <Title order={1}>My Stats</Title>
        <Text c="dimmed" mt={6} size="lg">
          Where your play time goes, across every platform.
        </Text>
      </div>

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
        {t ? (
          <StatTile
            label={`Hours in ${y.year}`}
            value={formatHoursNumber(t.minutes)}
            note={`Recorded since ${sinceLabel}`}
          />
        ) : (
          <StatTile
            label={`Played in ${y.year}`}
            value={y.played.length}
            note={`${y.played.length === 1 ? 'game' : 'games'} you touched this year`}
          />
        )}
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
        note={
          t
            ? `Hours played each month, recorded from the change between syncs since ${sinceLabel}. Earlier hours can't be dated, so they aren't counted here.`
            : `Games by the month you last played them. Steam and PlayStation only report lifetime totals, so hours can't be dated before Savepoint started recording on ${sinceLabel || 'your first import'}${
                y.recorded ? ` (${hours(y.recorded.minutes)} recorded since)` : ''
              }. Real hours per month show here from ${y.year + 1}, the first full year Savepoint records.`
        }
      >
        <Grid gap="xl">
          <Grid.Col span={{ base: 12, md: 7 }}>
            {t ? (
              <Columns columns={t.byMonth.map((m, i) => ({ label: MONTHS[i], value: m, display: hours(m) }))} />
            ) : (
              <Columns
                columns={y.byMonth.map((n, i) => ({
                  label: MONTHS[i],
                  value: n,
                  display: `${n} ${n === 1 ? 'game' : 'games'}`,
                }))}
              />
            )}
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Text size="sm" fw={600} mb="xs">
              {t ? `Most played in ${y.year}` : `Games you played in ${y.year}, by all-time hours`}
            </Text>
            {t ? (
              <BarList
                bars={t.top.map(({ item, minutes }) => ({
                  label: item.game.title,
                  value: minutes,
                  display: hours(minutes),
                  href: `/game/${item.game.id}`,
                }))}
              />
            ) : y.played.length ? (
              <BarList
                bars={y.played.slice(0, 5).map((l) => ({
                  label: l.game.title,
                  value: l.totalMinutes,
                  display: hours(l.totalMinutes),
                  href: `/game/${l.game.id}`,
                }))}
              />
            ) : (
              <Text size="sm" c="dimmed">
                Nothing played this year yet.
              </Text>
            )}
            <Text size="sm" c="dimmed" mt="md">
              {y.played.length} {y.played.length === 1 ? 'game' : 'games'} played this year
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
