import { ActionIcon, Anchor, Button, Chip, Group, Loader, Stack, Switch, Text, Title, Tooltip } from '@mantine/core';
import { IconBroadcast, IconMessageCircle, IconX } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GameCard } from '../components/GameCard';
import { formatPlaytime } from '../lib/format';
import { useLibrary, useOwnedPlatforms, useUnlinkedPhysicalTitles } from '../lib/library';
import { PLATFORM_BY_ID } from '../data/platforms';
import { newestFirst, recommend, tasteProfile } from '../lib/recommend';
import { useStore } from '../lib/store';
import { useFavorites } from '../lib/favorites';
import { useSuggestionPool } from '../lib/suggestions';
import { watchedForTaste } from '../lib/streaming';

const PAGE = 24;

export function DiscoverPage() {
  const lib = useLibrary();
  const dismissed = useStore((s) => s.dismissed);
  const dismiss = useStore((s) => s.dismiss);
  const restore = useStore((s) => s.restoreDismissed);
  const [onlyMine, setOnlyMine] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);

  const streamTaste = useStore((s) => s.streamTaste);
  const watched = useMemo(() => watchedForTaste(streamTaste), [streamTaste]);
  const profile = useMemo(() => tasteProfile(lib, watched), [lib, watched]);
  const owned = useOwnedPlatforms(lib);
  const pool = useSuggestionPool(lib);
  const [shown, setShown] = useState(PAGE);
  const favorites = useFavorites();
  const alsoOwned = useUnlinkedPhysicalTitles();
  const recs = useMemo(
    () =>
      newestFirst(
        recommend(lib, { owned, exclude: new Set(dismissed), pool: pool.games, favorites, alsoOwned, watched }),
      ),
    [lib, owned, dismissed, pool.games, favorites, alsoOwned, watched],
  );

  // With no platforms known yet there's nothing to narrow down to.
  const narrow = onlyMine && owned.length > 0;
  const matching = recs
    .filter((r) => !narrow || r.onYourPlatforms.length > 0)
    .filter((r) => !focus || r.game.subgenres.includes(focus) || r.game.genres.includes(focus));
  const visible = matching.slice(0, shown);

  const favoriteGenres = useStore((s) => s.profile.favoriteGenres);
  // Your favourite genres first, then the sub-genres you play most.
  const focusOptions = [...new Set([...favoriteGenres, ...profile.subgenres.slice(0, 8).map((x) => x.name)])];

  return (
    <Stack gap={36}>
      <Group justify="space-between" align="flex-end" gap="md">
        <div>
          <Title order={1}>Play next</Title>
          <Text c="dimmed" mt={6} size="lg" maw={620}>
            Picked from the genres you spend the most hours in, newest first within each 10% match band. Hours count
            with diminishing returns, so one huge game doesn't decide everything.
            {watched.length > 0 && ' The games your favourite streamers play count too.'}{' '}
            <Anchor component={Link} to="/stats" inherit>
              See your genres
            </Anchor>
          </Text>
        </div>
        <Button component={Link} to="/assistant" variant="light" leftSection={<IconMessageCircle size={18} />}>
          Ask the assistant
        </Button>
      </Group>

      <Stack gap="lg">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Chip.Group
            value={focus ?? ''}
            onChange={(v) => {
              setFocus((v as string) || null);
              setShown(PAGE);
            }}
          >
            <Group gap={6} wrap="wrap">
              <Chip value="" size="xs" radius="sm" variant="outline">
                All
              </Chip>
              {focusOptions.map((f) => (
                <Chip key={f} value={f} size="xs" radius="sm" variant="outline">
                  {f}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
          <Switch
            label={
              owned.length
                ? `Only on my platforms (${owned.map((p) => PLATFORM_BY_ID[p].name).join(', ')})`
                : 'Only on my platforms'
            }
            disabled={!owned.length}
            checked={narrow}
            onChange={(e) => {
              setOnlyMine(e.currentTarget.checked);
              setShown(PAGE);
            }}
            size="sm"
          />
        </Group>

        <div className="card-grid card-grid--discover">
          {visible.map((r) => (
            <GameCard
              key={r.game.id}
              game={r.game}
              actions={
                <Tooltip label="Not interested">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="lg"
                    onClick={() => dismiss(r.game.id)}
                    aria-label={`Not interested in ${r.game.title}`}
                  >
                    <IconX size={17} />
                  </ActionIcon>
                </Tooltip>
              }
              note={
                <Stack gap={6}>
                  <Text size="xs" fw={600} className="num" c="dimmed" mb={-2}>
                    {r.fit}% match
                  </Text>
                  <div className="strip-track" style={{ height: 4 }} aria-hidden>
                    <div
                      style={{
                        width: `${r.fit}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: 'var(--mantine-primary-color-filled)',
                      }}
                    />
                  </div>
                  {r.because && (
                    <Text size="sm" lh={1.4}>
                      You put {formatPlaytime(r.because.totalMinutes)} into{' '}
                      <Text span fw={600} component={Link} to={`/game/${r.because.game.id}`} c="inherit">
                        {r.because.game.title}
                      </Text>
                      {r.sharedTraits.length > 0 &&
                        `. Both are ${r.sharedTraits.slice(0, 2).join(' and ').toLowerCase()}.`}
                    </Text>
                  )}
                  {r.streamedBy && r.streamedBy.length > 0 && (
                    <Group gap={6} wrap="nowrap" align="flex-start">
                      <IconBroadcast size={14} style={{ flexShrink: 0, marginTop: 3, opacity: 0.7 }} />
                      <Text size="sm" lh={1.4}>
                        {r.streamedBy.slice(0, 2).join(' and ')}
                        {r.streamedBy.length > 2 ? ' and others' : ''} {r.streamedBy.length === 1 ? 'plays' : 'play'}{' '}
                        it.
                      </Text>
                    </Group>
                  )}
                  {r.onYourPlatforms.length === 0 && (
                    <Text size="xs" c="orange">
                      Not on any platform you play on.
                    </Text>
                  )}
                </Stack>
              }
            />
          ))}
        </div>
        {pool.loading && (
          <Group gap="xs" justify="center">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Finding more games like yours on Steam
            </Text>
          </Group>
        )}
        {matching.length > visible.length && (
          <Button variant="light" onClick={() => setShown((n) => n + PAGE)} w="fit-content" mx="auto">
            Show more ({matching.length - visible.length} left)
          </Button>
        )}
        {!visible.length && !pool.loading && (
          <Text c="dimmed" ta="center" py="xl">
            Nothing left to suggest with these filters.
          </Text>
        )}
        {dismissed.length > 0 && (
          <Button variant="subtle" color="gray" size="xs" onClick={restore} w="fit-content">
            Show {dismissed.length} hidden {dismissed.length === 1 ? 'game' : 'games'} again
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
