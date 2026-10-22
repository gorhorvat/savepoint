import {
  ActionIcon,
  Anchor,
  Button,
  Chip,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconMessageCircle, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GameCard } from '../components/GameCard';
import { fetchDiscoverPool } from '../lib/api';
import { formatPlaytime } from '../lib/format';
import { ownedPlatforms, useLibrary } from '../lib/library';
import { recommend, tasteProfile } from '../lib/recommend';
import { useStore } from '../lib/store';

const PAGE = 24;
const POOL_TTL = 24 * 3600 * 1000;

/** Keeps the Steam suggestion pool in step with your taste; refreshed daily. */
function useSuggestionPool(subgenres: string[], genres: string[]) {
  const suggested = useStore((s) => s.suggested);
  const [failed, setFailed] = useState('');
  // Bump the leading version when the server's pool changes shape (v2: Switch games).
  const key = ['v2', ...subgenres, '|', ...genres].join(',');
  const stale =
    !!subgenres.length && (suggested.key !== key || Date.now() - new Date(suggested.fetchedAt).getTime() > POOL_TTL);

  useEffect(() => {
    if (!stale || failed === key) return;
    let cancelled = false;
    fetchDiscoverPool(subgenres, genres)
      .then((found) => !cancelled && useStore.getState().setSuggested(key, found))
      .catch(() => !cancelled && setFailed(key));
    return () => {
      cancelled = true;
    };
    // The key stands in for both lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stale, failed]);

  return {
    games: useMemo(() => Object.values(suggested.games), [suggested.games]),
    loading: stale && failed !== key,
  };
}

export function DiscoverPage() {
  const lib = useLibrary();
  const dismissed = useStore((s) => s.dismissed);
  const dismiss = useStore((s) => s.dismiss);
  const restore = useStore((s) => s.restoreDismissed);
  const [onlyMine, setOnlyMine] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);

  const profile = useMemo(() => tasteProfile(lib), [lib]);
  const owned = useMemo(() => ownedPlatforms(lib), [lib]);
  const pool = useSuggestionPool(
    profile.subgenres.slice(0, 6).map((x) => x.name),
    profile.genres.slice(0, 4).map((x) => x.name),
  );
  const [shown, setShown] = useState(PAGE);
  const recs = useMemo(
    () => recommend(lib, { owned, exclude: new Set(dismissed), extra: pool.games }),
    [lib, owned, dismissed, pool.games],
  );

  const matching = recs
    .filter((r) => !onlyMine || r.onYourPlatforms.length > 0)
    .filter((r) => !focus || r.game.subgenres.includes(focus) || r.game.genres.includes(focus));
  const visible = matching.slice(0, shown);

  const focusOptions = profile.subgenres.slice(0, 8).map((x) => x.name);

  return (
    <Stack gap={36}>
      <Group justify="space-between" align="flex-end" gap="md">
        <div>
          <Title order={1}>Play next</Title>
          <Text c="dimmed" mt={6} size="lg" maw={620}>
            Picked from the genres you spend the most hours in. Hours count with diminishing returns, so one huge game
            doesn't decide everything.{' '}
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
            label="Only on my platforms"
            checked={onlyMine}
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
                  <div className="strip-track" style={{ height: 4 }} aria-label={`${r.fit}% match`} role="img">
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
