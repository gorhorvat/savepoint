import {
  ActionIcon,
  Anchor,
  Button,
  Grid,
  Loader,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconPencil, IconTrash, IconTrophy } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Backdrop, Cover } from '../components/Cover';
import { PhysicalCopyIcon } from '../components/PhysicalPlatformIcon';
import { GameCard } from '../components/GameCard';
import { FranchiseBadge, GenreChips } from '../components/GenreChips';
import { PlatformLabel, PlatformList } from '../components/PlatformBadge';
import { PriceTable } from '../components/PriceTable';
import { TimeStrip } from '../components/TimeStrip';
import { WishlistButton } from '../components/WishlistButton';
import { ProgressPanel } from '../components/ProgressPanel';
import { GameFacts, Screenshots } from '../components/GameInfo';
import { LiveStreams } from '../components/LiveStreams';
import { useGameInfo } from '../lib/gameInfo';
import { PLATFORMS } from '../data/platforms';
import { formatHoursNumber, formatLastPlayed, formatPlaytime, upcomingLabel } from '../lib/format';
import { isApp } from '../lib/apps';
import { lookupOne } from '../lib/genreLookup';
import { useLibrary, useUnlinkedPhysicalTitles } from '../lib/library';
import { ownedKey, ownedKeys } from '../lib/match';
import { resolveGame, useStore } from '../lib/store';
import { favoriteFranchise, favoriteGenresOf, useFavorites } from '../lib/favorites';
import { useSuggestionPool } from '../lib/suggestions';
import { streamerIndex } from '../lib/recommend';
import { watchedForTaste } from '../lib/streaming';
import type { AchievementProgress, EntrySource, Game, PlatformId } from '../types';

const SOURCE_LABEL: Record<EntrySource, string> = {
  steam: 'Imported from Steam',
  psn: 'Imported from PlayStation Network',
  xbox: 'Imported from Xbox',
  manual: 'Added by you',
  demo: 'Sample data',
};

function LogTime({ game, existing }: { game: Game; existing: PlatformId[] }) {
  const add = useStore((s) => s.addManualEntry);
  const [platform, setPlatform] = useState<string | null>(null);
  const [hours, setHours] = useState<number | string>('');

  const save = () => {
    if (!platform || !Number(hours)) return;
    add({
      gameId: game.id,
      platform: platform as PlatformId,
      minutes: Math.round(Number(hours) * 60),
      lastPlayed: new Date().toISOString(),
    });
    notifications.show({ message: `Saved ${hours} h on ${PLATFORMS.find((p) => p.id === platform)!.name}` });
    setHours('');
    setPlatform(null);
  };

  return (
    <Group align="flex-end" gap="sm" wrap="wrap">
      <Select
        label="Platform"
        placeholder="Pick one"
        data={PLATFORMS.map((p) => ({
          value: p.id,
          label: existing.includes(p.id) ? `${p.name} (replace)` : p.name,
        }))}
        value={platform}
        onChange={setPlatform}
        style={{ flex: '1 1 160px' }}
      />
      <NumberInput
        label="Hours played"
        placeholder="e.g. 12"
        min={0}
        max={20000}
        decimalScale={1}
        value={hours}
        onChange={setHours}
        style={{ flex: '1 1 120px' }}
      />
      <Button onClick={save} disabled={!platform || !Number(hours)} variant="light">
        Save play time
      </Button>
    </Group>
  );
}

function EditGenres({ game, onDone }: { game: Game; onDone: () => void }) {
  const setGenres = useStore((s) => s.setGenres);
  const [genres, setG] = useState(game.genres);
  const [subgenres, setS] = useState(game.subgenres);
  const customGames = useStore((st) => st.customGames);
  const suggested = useStore((st) => st.suggested.games);
  // Every genre and sub-genre already used by your games or the suggestions.
  const all = useMemo(() => {
    const g = new Set<string>();
    const s = new Set<string>();
    [...Object.values(customGames), ...Object.values(suggested)].forEach((c) => {
      c.genres.forEach((x) => g.add(x));
      c.subgenres.forEach((x) => s.add(x));
    });
    return { g: [...g].sort(), s: [...s].sort() };
  }, [customGames, suggested]);
  return (
    <Stack gap="sm">
      <TagsInput label="Genres" data={all.g} value={genres} onChange={setG} placeholder="Add a genre" />
      <TagsInput label="Sub-genres" data={all.s} value={subgenres} onChange={setS} placeholder="Add a sub-genre" />
      <Group gap="sm">
        <Button
          size="sm"
          onClick={() => {
            setGenres(game.id, genres, subgenres);
            onDone();
          }}
        >
          Save genres
        </Button>
        <Button size="sm" variant="subtle" color="gray" onClick={onDone}>
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}

/** Shown for imported games with no genres: looks them up, or explains why there are none. */
function MissingGenres({ game, onEdit }: { game: Game; onEdit: () => void }) {
  // The id of a game whose lookup failed or was postponed by a busy service.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const notFound = game.genreSource === 'none';
  const failed = failedFor === game.id;
  const needsLookup = !!game.custom && !game.genreSource && !failed;

  useEffect(() => {
    if (!needsLookup) return;
    let alive = true;
    lookupOne(game)
      .then(() => {
        // Still unchecked means the services asked us to slow down.
        const after = useStore.getState().customGames[game.id];
        if (alive && !after?.genreSource) setFailedFor(game.id);
      })
      .catch(() => {
        if (alive) setFailedFor(game.id);
      });
    return () => {
      alive = false;
    };
  }, [game, needsLookup]);

  if (needsLookup) {
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Looking up genres on Steam and Wikidata
        </Text>
      </Group>
    );
  }
  return (
    <div>
      <Text size="sm" c="dimmed" maw={520}>
        {notFound
          ? "Steam and Wikidata don't list genres for this game. Add them so it counts towards your recommendations."
          : failed
            ? "Couldn't reach the genre lookup right now. Savepoint will try again later, or you can add them yourself."
            : 'This game has no genres yet, so it isn’t used for recommendations.'}
      </Text>
      <Button size="xs" variant="light" mt="xs" leftSection={<IconPencil size={14} />} onClick={onEdit}>
        Add genres
      </Button>
    </div>
  );
}

function AchievementLine({ progress, platform }: { progress?: AchievementProgress; platform: PlatformId }) {
  if (!progress?.total) return null;
  const pct = Math.round((progress.earned / progress.total) * 100);
  const noun = platform === 'playstation' ? 'trophies' : 'achievements';
  return (
    <Group gap={6} mt={4} wrap="nowrap">
      <IconTrophy size={14} color="var(--mantine-color-dimmed)" />
      <Text size="xs" c="dimmed" className="num">
        {progress.earned} of {progress.total} {noun} ({pct}%){progress.platinum && ', platinum'}
        {progress.totalGamerscore ? `, ${progress.gamerscore ?? 0} of ${progress.totalGamerscore} G` : ''}
      </Text>
    </Group>
  );
}

export function GamePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const customGames = useStore((s) => s.customGames);
  const overrides = useStore((s) => s.genreOverrides);
  const details = useStore((s) => s.details);
  const game = useMemo(() => resolveGame(id, customGames, overrides, details), [id, customGames, overrides, details]);
  const lib = useLibrary({ includeApps: true });
  const item = lib.find((l) => l.game.id === id);
  const app = game ? isApp(game) : false;
  const removeEntry = useStore((s) => s.removeEntry);
  const achievements = useStore((s) => s.achievements[id]);
  const info = useGameInfo(game && !isApp(game) ? game : undefined);
  const [editing, setEditing] = useState(false);

  // Same library as Play next, so both share one suggestion pool.
  const pool = useSuggestionPool(useLibrary());
  const favorites = useFavorites();
  const streamTaste = useStore((s) => s.streamTaste);
  const streamers = useMemo(() => streamerIndex(watchedForTaste(streamTaste)), [streamTaste]);
  const alsoOwned = useUnlinkedPhysicalTitles();
  const similar = useMemo(() => {
    if (!game) return [];
    // Suggestions have their own ids, so games you own are skipped by title, on
    // any platform and in any version ("Gold Edition", "Cloud Version"…).
    const played = new Set([game.title, ...lib.map((l) => l.game.title), ...alsoOwned].flatMap(ownedKeys));
    const playedApps = new Set([game, ...lib.map((l) => l.game)].map((g) => g.steamAppId).filter(Boolean));
    const series = favoriteFranchise(game, favorites);
    return (
      pool.games
        .filter((c) => !played.has(ownedKey(c.title)) && !(c.steamAppId && playedApps.has(c.steamAppId)))
        .map((c) => {
          const shared =
            c.subgenres.filter((x) => game.subgenres.includes(x)).length * 2 +
            c.genres.filter((x) => game.genres.includes(x)).length +
            c.tags.filter((x) => game.tags.includes(x)).length * 0.5;
          // Your favourites weigh in: the same favourite franchise most of all.
          const franchise = favoriteFranchise(c, favorites);
          const fav =
            (franchise ? (franchise === series ? 4 : 1.5) : 0) +
            favoriteGenresOf(c, favorites).filter((g) => [...game.genres, ...game.subgenres].includes(g)).length * 1.5;
          // Your favourite streamers play it.
          const streamedBy = streamers.get(ownedKey(c.title));
          return { c, shared, same: !!series && franchise === series, s: shared + fav + (streamedBy ? 1.5 : 0), streamedBy };
        })
        // Same favourite series always qualifies, even when the store lists no genres.
        .filter((x) => x.same || x.shared >= 3 || (x.shared >= 1 && x.s >= 4))
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
    );
  }, [game, lib, pool.games, favorites, alsoOwned, streamers]);

  if (!game) {
    return (
      <Stack>
        <Title order={2}>Game not found</Title>
        <Text c="dimmed">It may have been removed when a platform was disconnected.</Text>
        <Button component={Link} to="/library" variant="light" w="fit-content">
          Back to library
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap={36}>
      {/* The game's own art, blurred behind its header, edge to edge. */}
      <section className="page-hero">
        <Backdrop game={game} />
        <div className="page-hero-content">
          <Anchor component="button" onClick={() => navigate(-1)} c="dimmed" size="sm" w="fit-content" mb="xl">
            <Group gap={6}>
              <IconArrowLeft size={16} /> Back
            </Group>
          </Anchor>

          <Grid gap={{ base: 'lg', md: 40 }}>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Cover game={game} width="100%" radius={14} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Stack gap="md">
                <div>
                  <Title order={1}>{game.title}</Title>
                  <FranchiseBadge game={game} size="md" />
                  {(game.developer || game.year) && (
                    <Text c="dimmed" mt={6}>
                      {[game.developer, game.year].filter(Boolean).join(', ')}
                    </Text>
                  )}
                  {upcomingLabel(game) && (
                    <Text fw={700} mt={6} c="var(--mantine-primary-color-filled)">
                      {upcomingLabel(game)}
                    </Text>
                  )}
                </div>
                {(game.blurb || info?.igdb?.summary) && (
                  <Text size="lg" maw={560} lh={1.5} lineClamp={game.blurb ? undefined : 5}>
                    {game.blurb || info?.igdb?.summary}
                  </Text>
                )}
                {info && <GameFacts info={info} playedMinutes={item?.totalMinutes} />}
                {app ? (
                  <Text size="sm" c="dimmed" maw={520}>
                    This is an app, not a game. Its hours are hidden from your library totals unless you include apps,
                    and it's never used for recommendations.
                  </Text>
                ) : editing ? (
                  <EditGenres game={game} onDone={() => setEditing(false)} />
                ) : game.genres.length + game.subgenres.length === 0 ? (
                  <MissingGenres game={game} onEdit={() => setEditing(true)} />
                ) : (
                  <Stack gap={6}>
                    <Group gap="xs" align="center">
                      <GenreChips game={game} />
                      <Tooltip label="Edit genres">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          onClick={() => setEditing(true)}
                          aria-label="Edit genres"
                        >
                          <IconPencil size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Filled chips are genres, outlined ones are sub-genres.
                      {game.genreSource === 'steam' && ' Looked up from Steam community tags.'}
                      {game.genreSource === 'igdb' && ' Looked up on IGDB.'}
                      {game.genreSource === 'wikidata' && ' Looked up on Wikidata.'}
                      {game.genreSource === 'nintendo' && ' From the Nintendo eShop.'}
                    </Text>
                  </Stack>
                )}
                <div>
                  <Text size="sm" c="dimmed" mb={6}>
                    Available on
                  </Text>
                  <PlatformList platforms={game.availableOn} switchVersions={game.switchVersions} size={20} />
                </div>
                {item && item.physical.length > 0 && (
                  <Group gap={8} wrap="nowrap">
                    <PhysicalCopyIcon
                      platform={item.physical[0].platform}
                      size={18}
                      color="var(--mantine-primary-color-filled)"
                    />
                    <Text size="sm">
                      You own a physical copy:{' '}
                      {item.physical
                        .map((c) => [c.platform, c.edition, c.condition].filter(Boolean).join(', '))
                        .join('; ')}
                      .{' '}
                      <Anchor component={Link} to="/physical" size="sm">
                        See your collection
                      </Anchor>
                    </Text>
                  </Group>
                )}
                {!app && item && <ProgressPanel item={item} />}
                {!app && (
                  <Group>
                    <WishlistButton game={game} />
                  </Group>
                )}
              </Stack>
            </Grid.Col>
          </Grid>
        </div>
      </section>

      {info?.igdb && info.igdb.screenshots.length > 0 && (
        <Screenshots shots={info.igdb.screenshots} title={game.title} />
      )}

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, md: app ? 12 : 7 }}>
          <Paper p={{ base: 'md', sm: 'xl' }} h="100%">
            <Group justify="space-between" align="baseline">
              <Title order={2}>Play time</Title>
              {item && (
                <Text className="display num" fw={700} fz={32} lh={1}>
                  {item.totalMinutes < 60 ? item.totalMinutes : formatHoursNumber(item.totalMinutes)}
                  <Text span ff="text" fz="sm" c="dimmed" fw={500} ml={4}>
                    {item.totalMinutes < 60 ? 'min' : 'hours'} total
                  </Text>
                </Text>
              )}
            </Group>
            {item ? (
              <Stack gap="lg" mt="lg">
                <TimeStrip parts={item.plays} height={14} />
                <Stack gap={0}>
                  {item.plays.map((p, i) => (
                    <Group
                      key={p.platform}
                      justify="space-between"
                      wrap="nowrap"
                      py={10}
                      style={{ borderTop: i ? '1px solid var(--sp-line)' : undefined }}
                    >
                      <div>
                        <PlatformLabel platform={p.platform} />
                        <Text size="xs" c="dimmed" mt={2}>
                          {SOURCE_LABEL[p.source]}
                          {p.lastPlayed && `, last played ${formatLastPlayed(p.lastPlayed)}`}
                        </Text>
                        <AchievementLine progress={achievements?.[p.platform]} platform={p.platform} />
                      </div>
                      <Group gap="xs" wrap="nowrap">
                        <Text fw={600} className="num">
                          {formatPlaytime(p.minutes)}
                        </Text>
                        {(p.source === 'manual' || p.source === 'demo') && (
                          <Tooltip label="Remove this platform's play time">
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              aria-label={`Remove ${p.platform} play time`}
                              onClick={() => removeEntry(game.id, p.platform)}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    </Group>
                  ))}
                </Stack>
              </Stack>
            ) : (
              <Text c="dimmed" mt="sm">
                You haven't played this yet. Log time below if you've played it somewhere Savepoint can't import from.
              </Text>
            )}
            <Text fw={600} mt="xl" mb="xs" size="sm">
              Log play time by hand
            </Text>
            <LogTime game={game} existing={item?.plays.map((p) => p.platform) ?? []} />
          </Paper>
        </Grid.Col>
        {!app && (
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Paper p={{ base: 'md', sm: 'xl' }} h="100%">
              <Title order={2} mb="md">
                Where to buy
              </Title>
              <PriceTable game={game} />
            </Paper>
          </Grid.Col>
        )}
      </Grid>

      {!app && <LiveStreams title={game.title} />}

      {!app && similar.length > 0 && (
        <Stack gap="md">
          <Title order={2}>More like this</Title>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="lg" verticalSpacing="xl">
            {similar.map(({ c, streamedBy }) => (
              <GameCard
                key={c.id}
                game={c}
                note={
                  streamedBy?.length ? (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {streamedBy.slice(0, 2).join(' and ')} {streamedBy.length === 1 ? 'plays' : 'play'} it
                    </Text>
                  ) : undefined
                }
              />
            ))}
          </SimpleGrid>
        </Stack>
      )}
    </Stack>
  );
}
