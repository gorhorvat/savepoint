import {
  Anchor,
  Badge,
  Button,
  Center,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlugConnected, IconSearch, IconStarFilled, IconTrophy } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Backdrop, Cover } from '../components/Cover';
import { PhysicalCopyIcon } from '../components/PhysicalPlatformIcon';
import { FranchiseBadge, GenreChips } from '../components/GenreChips';
import { PlatformIcon, PlatformLogo } from '../components/PlatformBadge';
import { TimeStrip } from '../components/TimeStrip';
import { PLATFORMS } from '../data/platforms';
import { formatHoursNumber, formatLastPlayed, formatPlaytime } from '../lib/format';
import { physicalPlatformId, platformTotals, useLibrary, type LibraryGame } from '../lib/library';
import { normalizeTitle } from '../lib/match';
import { useStore } from '../lib/store';
import type { AchievementProgress, PhysicalPlatform, PlatformId, PlayStatus } from '../types';
import { BACKLOG_MINUTES, effectiveStatus, STATUS_BY_VALUE, STATUSES } from '../lib/progress';
import { tasteMatcher, tasteProfile } from '../lib/recommend';

type Sort = 'hours' | 'recent' | 'title' | 'rating' | 'match' | 'shortest';
type StatusFilter = 'all' | PlayStatus;

/** The game you played last, over its own art: the home screen's opening tile. */
function HomeHero({ item }: { item: LibraryGame }) {
  return (
    <section className="hero" aria-label="Last played">
      <Backdrop game={item.game} />
      <div className="hero-content">
        <div style={{ minWidth: 0 }}>
          <Text c="dimmed" fw={600}>
            {item.lastPlayed ? `Last played ${formatLastPlayed(item.lastPlayed)}` : 'Your most played game'}
          </Text>
          <h1 className="hero-title">{item.game.title}</h1>
          <Group gap="lg" mt="md" align="flex-end" wrap="wrap">
            <Text className="display num" fz={40} lh={1}>
              {formatHoursNumber(item.totalMinutes)}
              <Text span fz="md" c="dimmed" fw={600} ml={6} style={{ fontStyle: 'normal' }}>
                hours
              </Text>
            </Text>
            <Group gap={14} mb={4}>
              {item.plays.map((p) => (
                <Group key={p.platform} gap={6} wrap="nowrap">
                  <PlatformLogo platform={p.platform} size={15} />
                  <Text size="sm" className="num">
                    {formatPlaytime(p.minutes)}
                  </Text>
                </Group>
              ))}
            </Group>
          </Group>
          <Button component={Link} to={`/game/${item.game.id}`} size="md" mt="xl" radius="xl">
            Open game
          </Button>
        </div>
        <Link to={`/game/${item.game.id}`} className="hero-cover" tabIndex={-1} aria-hidden>
          <Cover game={item.game} width="100%" radius={0} />
        </Link>
      </div>
    </section>
  );
}

/** Total play time and where it went, as one line under the hero. */
function Totals({ lib }: { lib: LibraryGame[] }) {
  const totals = platformTotals(lib);
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const active = PLATFORMS.filter((p) => totals[p.id] > 0);
  const apps = lib.filter((g) => g.isApp).length;
  const games = lib.length - apps;
  return (
    <Stack gap={10}>
      <Group justify="space-between" align="baseline" gap="xs">
        <Text fw={600}>
          <Text span className="display num" fz={28} mr={8}>
            {formatHoursNumber(total)}
          </Text>
          hours across {games} {games === 1 ? 'game' : 'games'}
          {apps > 0 && ` and ${apps} ${apps === 1 ? 'app' : 'apps'}`}
        </Text>
        <Anchor component={Link} to="/stats" size="sm" fw={600}>
          See all your stats
        </Anchor>
      </Group>
      <TimeStrip parts={PLATFORMS.map((p) => ({ platform: p.id, minutes: totals[p.id] }))} height={10} hero />
      <Group gap="lg">
        {active.map((p) => (
          <Group key={p.id} gap={6} wrap="nowrap">
            <PlatformLogo platform={p.id} size={14} />
            <Text size="sm" c="dimmed" className="num">
              {formatPlaytime(totals[p.id])}
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  );
}

/** A horizontally scrolling row of covers, like a console home screen. */
function Shelf({ title, items, meta }: { title: string; items: LibraryGame[]; meta: (item: LibraryGame) => string }) {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <Title order={2} mb="sm">
        {title}
      </Title>
      <div className="shelf">
        {items.map((item) => (
          <Link key={item.game.id} to={`/game/${item.game.id}`} className="shelf-tile">
            <Cover game={item.game} width="100%" radius={12} />
            <Text fw={700} mt={8} truncate>
              {item.game.title}
            </Text>
            <Text size="sm" c="dimmed" truncate>
              {meta(item)}
            </Text>
          </Link>
        ))}
      </div>
    </section>
  );
}

function GameRow({
  item,
  max,
  achievements,
  toBeat,
}: {
  item: LibraryGame;
  max: number;
  achievements?: Partial<Record<PlatformId, AchievementProgress>>;
  /** Typical main-story hours, shown for games you haven't finished. */
  toBeat?: number;
}) {
  const status = item.progress?.status;
  const ach = Object.values(achievements ?? {}).filter((a) => a?.total) as AchievementProgress[];
  const earned = ach.reduce((n, a) => n + a.earned, 0);
  const total = ach.reduce((n, a) => n + a.total, 0);
  return (
    <Link to={`/game/${item.game.id}`} className="game-row">
      <div className="gr-cover">
        <Cover game={item.game} width="100%" radius={6} />
      </div>
      <div className="gr-title" style={{ minWidth: 0 }}>
        <Group gap={8} wrap="nowrap">
          <Text fw={600} truncate>
            {item.game.title}
          </Text>
          <FranchiseBadge game={item.game} size="xs" />
          {item.isApp && (
            <Badge size="xs" variant="outline" color="gray" radius="xs" tt="none" style={{ flexShrink: 0 }}>
              App
            </Badge>
          )}
          {status && (
            <Badge
              size="xs"
              variant="light"
              color={STATUS_BY_VALUE[status].color}
              radius="xs"
              tt="none"
              style={{ flexShrink: 0 }}
            >
              {STATUS_BY_VALUE[status].label}
            </Badge>
          )}
          {item.physical.length > 0 && (
            <Tooltip
              withArrow
              multiline
              label={item.physical
                .map((c) => [`Physical copy: ${c.platform}`, c.edition, c.condition].filter(Boolean).join(', '))
                .join(' · ')}
            >
              <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }} aria-label="You own a physical copy">
                {[
                  ...new Set(
                    item.physical.map((c) =>
                      c.platform === 'Switch' || c.platform === 'Switch 2' ? 'Switch' : c.platform,
                    ),
                  ),
                ].map((p) => (
                  <PhysicalCopyIcon
                    key={p}
                    platform={p as PhysicalPlatform}
                    color="var(--mantine-primary-color-filled)"
                  />
                ))}
              </span>
            </Tooltip>
          )}
        </Group>
        <Group gap={8} mt={4} wrap="nowrap" visibleFrom="sm">
          {!item.isApp && <GenreChips game={item.game} limit={3} size="xs" />}
        </Group>
        <Group gap={10} mt={4} wrap="nowrap">
          <Text size="xs" c="dimmed" truncate>
            {item.totalMinutes === 0 && !item.lastPlayed
              ? 'Not played yet'
              : item.lastPlayed
                ? `Last played ${formatLastPlayed(item.lastPlayed)}`
                : 'Play time added by hand'}
          </Text>
          {toBeat && (
            <Tooltip label="Typical time to beat the main story, from HowLongToBeat" withArrow>
              <Text size="xs" c="dimmed" className="num" style={{ flexShrink: 0 }}>
                ~{toBeat} h to beat
              </Text>
            </Tooltip>
          )}
          {item.progress?.rating && (
            <Group gap={2} wrap="nowrap" aria-label={`Rated ${item.progress.rating} of 5`} style={{ flexShrink: 0 }}>
              <IconStarFilled size={11} color="var(--mantine-color-yellow-6)" />
              <Text size="xs" c="dimmed" className="num">
                {item.progress.rating}
              </Text>
            </Group>
          )}
          {total > 0 && (
            <Tooltip label={`${earned} of ${total} achievements and trophies`} withArrow>
              <Group gap={3} wrap="nowrap" style={{ flexShrink: 0 }}>
                <IconTrophy size={12} color="var(--mantine-color-dimmed)" />
                <Text size="xs" c="dimmed" className="num">
                  {Math.round((earned / total) * 100)}%
                </Text>
              </Group>
            </Tooltip>
          )}
        </Group>
      </div>
      <div className="gr-strip">
        <TimeStrip parts={item.plays} scaleTo={max} height={8} withTooltips={false} />
        <Group gap={12} mt={6}>
          {item.plays.map((p) => (
            <Group key={p.platform} gap={5} wrap="nowrap">
              <PlatformLogo platform={p.platform} size={13} />
              <Text size="xs" c="dimmed" className="num">
                {formatPlaytime(p.minutes)}
              </Text>
            </Group>
          ))}
        </Group>
      </div>
      <div className="gr-total" style={{ textAlign: 'right' }}>
        {item.totalMinutes > 0 ? (
          <Text className="display num" fw={600} fz={{ base: 'md', sm: 'lg' }} lh={1}>
            {item.totalMinutes < 60 ? item.totalMinutes : formatHoursNumber(item.totalMinutes)}
            <Text span size="xs" c="dimmed" ff="text" fw={500} ml={3}>
              {item.totalMinutes < 60 ? 'min' : 'h'}
            </Text>
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </div>
    </Link>
  );
}

export function LibraryPage() {
  const showApps = useStore((s) => s.showApps);
  const setShowApps = useStore((s) => s.setShowApps);
  const all = useLibrary({ includeApps: true });
  const lib = useMemo(() => (showApps ? all : all.filter((l) => !l.isApp)), [all, showApps]);
  const appCount = all.filter((l) => l.isApp).length;
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 150);
  const [platform, setPlatform] = useState<'all' | PlatformId>('all');
  const [genre, setGenre] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('hours');
  const [status, setStatus] = useState<StatusFilter>('all');
  const achievements = useStore((s) => s.achievements);
  const lengths = useStore((s) => s.lengths);
  const statusOf = useMemo(() => new Map(lib.map((l) => [l.game.id, effectiveStatus(l, l.progress).status])), [lib]);
  const matchOf = useMemo(() => {
    const fit = tasteMatcher(tasteProfile(lib));
    return new Map(lib.map((l) => [l.game.id, fit(l.game)]));
  }, [lib]);

  const genreOptions = useMemo(() => {
    const g = new Set<string>();
    const s = new Set<string>();
    lib.forEach((l) => {
      l.game.genres.forEach((x) => g.add(x));
      l.game.subgenres.forEach((x) => s.add(x));
    });
    return [
      {
        group: 'Genres',
        items: [...g].sort().map((x) => ({ value: `g:${x}`, label: x })),
      },
      {
        group: 'Sub-genres',
        items: [...s].sort().map((x) => ({ value: `s:${x}`, label: x })),
      },
    ];
  }, [lib]);

  const visible = useMemo(() => {
    const q = normalizeTitle(debounced);
    let out = lib.filter((l) => {
      if (
        platform !== 'all' &&
        !l.plays.some((p) => p.platform === platform) &&
        !l.physical.some((c) => physicalPlatformId(c) === platform)
      ) {
        return false;
      }
      if (status !== 'all' && statusOf.get(l.game.id) !== status) return false;
      if (genre) {
        const [kind, name] = [genre.slice(0, 1), genre.slice(2)];
        if (kind === 'g' && !l.game.genres.includes(name)) return false;
        if (kind === 's' && !l.game.subgenres.includes(name)) return false;
      }
      return !q || normalizeTitle(l.game.title).includes(q);
    });
    if (sort === 'recent') out = [...out].sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));
    if (sort === 'title') out = [...out].sort((a, b) => a.game.title.localeCompare(b.game.title));
    if (sort === 'rating') out = [...out].sort((a, b) => (b.progress?.rating ?? 0) - (a.progress?.rating ?? 0));
    if (sort === 'match') out = [...out].sort((a, b) => (matchOf.get(b.game.id) ?? 0) - (matchOf.get(a.game.id) ?? 0));
    if (sort === 'shortest') {
      // Unknown lengths go last.
      const len = (id: string) => lengths[id]?.main ?? Infinity;
      out = [...out].sort((a, b) => len(a.game.id) - len(b.game.id));
    }
    return out;
  }, [lib, debounced, platform, genre, sort, status, statusOf, matchOf, lengths]);

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<PlayStatus, number>> = {};
    for (const s of statusOf.values()) if (s) counts[s] = (counts[s] ?? 0) + 1;
    return counts;
  }, [statusOf]);

  const max = lib[0]?.totalMinutes ?? 1;

  // Home screen: the last game you played, then shelves of what you're playing
  // and what to pick up next from the backlog.
  const games = lib.filter((l) => !l.isApp);
  const byRecent = games.filter((l) => l.lastPlayed).sort((a, b) => b.lastPlayed!.localeCompare(a.lastPlayed!));
  const hero = byRecent[0] ?? games[0];
  const playing = games.filter((l) => statusOf.get(l.game.id) === 'playing' && l.game.id !== hero?.game.id);
  const recent = byRecent.slice(1, 13);
  const backlog = games
    .filter((l) => statusOf.get(l.game.id) === 'backlog')
    .sort((a, b) => (matchOf.get(b.game.id) ?? 0) - (matchOf.get(a.game.id) ?? 0))
    .slice(0, 12);

  if (!all.length) {
    return (
      <Paper p="xl" maw={560}>
        <Title order={2}>Your library is empty</Title>
        <Text c="dimmed" mt="sm">
          Connect Steam or PlayStation to import play time automatically, or add Epic and Switch games by hand.
        </Text>
        <Button component={Link} to="/settings" mt="lg" leftSection={<IconPlugConnected size={18} />}>
          Connect platforms
        </Button>
      </Paper>
    );
  }

  const showingSample = lib.some((l) => l.plays.some((p) => p.source === 'demo'));

  return (
    <Stack gap={48}>
      {showingSample && (
        <Paper p="md" radius="md" style={{ borderStyle: 'dashed', background: 'transparent' }}>
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text size="sm">This is a sample library. Import your games from Steam or PlayStation to replace it.</Text>
            <Button component={Link} to="/settings" size="xs" leftSection={<IconPlugConnected size={16} />}>
              Import my games
            </Button>
          </Group>
        </Paper>
      )}
      {hero && <HomeHero item={hero} />}
      <Totals lib={lib} />
      <Shelf
        title={playing.length ? 'Playing' : 'Recently played'}
        items={playing.length ? playing : recent}
        meta={(l) =>
          l.lastPlayed
            ? `${formatPlaytime(l.totalMinutes)}, ${formatLastPlayed(l.lastPlayed)}`
            : formatPlaytime(l.totalMinutes)
        }
      />
      <Shelf
        title="Up next from your backlog"
        items={backlog}
        meta={(l) =>
          lengths[l.game.id]?.main
            ? `~${lengths[l.game.id]!.main} h to beat`
            : l.totalMinutes
              ? `${formatPlaytime(l.totalMinutes)} played`
              : 'Not started'
        }
      />

      <Stack gap="md">
        <Title order={2}>All games</Title>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            placeholder="Search your games"
            aria-label="Search your games"
            leftSection={<IconSearch size={16} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: '1 1 220px' }}
          />
          <Select
            aria-label="Filter by genre"
            placeholder="Any genre"
            data={genreOptions}
            value={genre}
            onChange={setGenre}
            clearable
            searchable
            style={{ flex: '1 1 160px' }}
          />
          <Select
            aria-label="Filter by status"
            data={[
              { value: 'all', label: 'Any status' },
              ...STATUSES.map((s) => ({ value: s.value, label: `${s.label} (${statusCounts[s.value] ?? 0})` })),
            ]}
            value={status}
            onChange={(v) => {
              const next = (v as StatusFilter) ?? 'all';
              setStatus(next);
              // The backlog is most useful ordered by what you'd probably enjoy.
              if (next === 'backlog') setSort('match');
            }}
            allowDeselect={false}
            style={{ flex: '0 1 160px' }}
          />
          <Select
            aria-label="Sort"
            data={[
              { value: 'hours', label: 'Most played' },
              { value: 'recent', label: 'Recently played' },
              { value: 'title', label: 'A to Z' },
              { value: 'rating', label: 'Your rating' },
              { value: 'match', label: 'Best match for you' },
              { value: 'shortest', label: 'Shortest to beat' },
            ]}
            value={sort}
            onChange={(v) => setSort((v as Sort) ?? 'hours')}
            allowDeselect={false}
            style={{ flex: '0 1 170px' }}
          />
        </Group>
        <Group justify="space-between" gap="sm" wrap="wrap">
          <SegmentedControl
            value={platform}
            onChange={(v) => setPlatform(v as typeof platform)}
            data={[
              { value: 'all', label: 'All' },
              ...PLATFORMS.map((p) => ({
                value: p.id,
                label: (
                  <Center h={20} aria-label={p.name} title={p.name}>
                    <PlatformIcon platform={p.id} size={17} />
                  </Center>
                ),
              })),
            ]}
            size="sm"
            radius="md"
            w={{ base: '100%', sm: 'auto' }}
          />
          {appCount > 0 && (
            <Switch
              label={`Include apps (${appCount})`}
              description="YouTube, Twitch and other non-game apps"
              checked={showApps}
              onChange={(e) => setShowApps(e.currentTarget.checked)}
              size="sm"
            />
          )}
        </Group>

        {status === 'backlog' && (
          <Text size="sm" c="dimmed">
            Games you own but have played for under {BACKLOG_MINUTES / 60} hours, plus any you marked Backlog. Sorted by
            how well they fit what you play most; set a status on a game's page to move it out.
          </Text>
        )}
        <div role="list" aria-label="Played games">
          {visible.map((item) => (
            <div role="listitem" key={item.game.id}>
              <GameRow
                item={item}
                max={max}
                achievements={achievements[item.game.id]}
                toBeat={
                  statusOf.get(item.game.id) === 'backlog' || statusOf.get(item.game.id) === 'playing'
                    ? lengths[item.game.id]?.main
                    : undefined
                }
              />
            </div>
          ))}
          {!visible.length && (
            <Text c="dimmed" py="xl" ta="center">
              No games match these filters.
            </Text>
          )}
        </div>
      </Stack>
    </Stack>
  );
}
