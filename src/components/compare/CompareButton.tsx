import {
  ActionIcon,
  Alert,
  Avatar,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconArrowLeft, IconArrowsLeftRight, IconSearch } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  COMPARE,
  fetchCompareFriends,
  fetchComparison,
  searchPlayers,
  type CompareFriend,
  type Comparison,
  type LookupResult,
} from '../../lib/compare';
import { ago, STATS_GAMES } from '../../lib/gameStats';
import type { GameStatsId } from '../../lib/store';
import { CompareView } from './CompareView';

/** Who to compare with: a friend on Savepoint, or someone found by name. */
function Picker({ game, onPick }: { game: GameStatsId; onPick: (withWho: string) => void }) {
  const spec = COMPARE[game];
  const [friends, setFriends] = useState<CompareFriend[] | null>(null);
  const [lookup, setLookup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [extra, setExtra] = useState('');
  const [results, setResults] = useState<LookupResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    fetchCompareFriends(game)
      .then((r) => {
        setFriends(r.friends);
        setLookup(r.lookup);
      })
      .catch((e: Error) => setError(e.message));
  }, [game]);

  const search = async () => {
    if (q.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchPlayers(game, q.trim(), extra.trim()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text fw={600}>Friends with this game</Text>
        {friends === null && !error && <Loader size="sm" />}
        {friends?.length === 0 && (
          <Text size="sm" c="dimmed">
            None of your friends has connected it yet, or they keep their stats private.{' '}
            <Text component={Link} to="/friends" inherit c="gold">
              Your friends
            </Text>
          </Text>
        )}
        {friends?.map((f) => (
          <UnstyledButton key={f.id} onClick={() => onPick(`user:${f.id}`)} className="compare-pick">
            <Group gap="sm" wrap="nowrap">
              <Avatar src={f.avatar} size={36} radius="xl" color="gold">
                {f.username.slice(0, 2).toUpperCase()}
              </Avatar>
              <div style={{ minWidth: 0 }}>
                <Text fw={600} truncate>
                  {f.username}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {[f.name, f.fetchedAt ? `read ${ago(f.fetchedAt)}` : null].filter(Boolean).join(' · ')}
                </Text>
              </div>
            </Group>
          </UnstyledButton>
        ))}
      </Stack>
      {lookup && spec.search && (
        <Stack gap="xs">
          <Text fw={600}>Anyone else</Text>
          <Text size="sm" c="dimmed">
            Any {lookup} with a public profile.
          </Text>
          <Group gap="xs" align="flex-end" wrap="wrap">
            <TextInput
              placeholder={spec.search.placeholder}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              style={{ flex: '2 1 180px' }}
            />
            {spec.search.extra && (
              <TextInput
                placeholder={spec.search.extra.placeholder}
                value={extra}
                onChange={(e) => setExtra(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && void search()}
                style={{ flex: '1 1 140px' }}
              />
            )}
            <Button
              variant="default"
              onClick={() => void search()}
              loading={searching}
              disabled={q.trim().length < 2}
              leftSection={<IconSearch size={16} />}
            >
              Search
            </Button>
          </Group>
          {results?.length === 0 && (
            <Text size="sm" c="dimmed">
              Nobody by that name.
            </Text>
          )}
          {results?.map((r) => (
            <UnstyledButton key={r.id} onClick={() => onPick(`lookup:${r.id}`)} className="compare-pick">
              <Group gap="sm" wrap="nowrap">
                <Avatar src={r.avatar} size={36} radius="xl" color="blue">
                  {r.name.slice(0, 2).toUpperCase()}
                </Avatar>
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} truncate>
                    {r.name}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {r.note}
                  </Text>
                </div>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      )}
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
    </Stack>
  );
}

/**
 * "Compare" next to Refresh on a game's tab: pick a friend (or, where the
 * game allows it, anyone by name), then both sides' numbers side by side.
 * `sections` adds the game's own sections under the headline numbers.
 */
export function CompareButton({
  game,
  sections,
}: {
  game: GameStatsId;
  sections?: (c: Comparison<never, never>) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [withWho, setWithWho] = useState<string | null>(null);
  const [c, setC] = useState<Comparison<never, never> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const small = useMediaQuery('(max-width: 48em)', false, { getInitialValueInEffect: false });
  const name = STATS_GAMES.find((g) => g.id === game)?.short ?? game;

  const pick = (w: string) => {
    setC(null);
    setError(null);
    setWithWho(w);
  };

  useEffect(() => {
    if (!withWho) return;
    let alive = true;
    fetchComparison<never, never>(game, withWho)
      .then((r) => alive && setC(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [game, withWho]);

  const back = () => {
    setWithWho(null);
    setC(null);
    setError(null);
  };

  return (
    <>
      <Tooltip label="Compare with a friend or another player">
        <Button
          variant="default"
          size="sm"
          onClick={() => setOpen(true)}
          leftSection={<IconArrowsLeftRight size={16} />}
        >
          Compare
        </Button>
      </Tooltip>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        size="min(1180px, 94vw)"
        fullScreen={small}
        radius={small ? 0 : 'lg'}
        title={
          <Group gap="xs" wrap="nowrap">
            {withWho && (
              <ActionIcon variant="subtle" color="gray" onClick={back} aria-label="Pick someone else">
                <IconArrowLeft size={18} />
              </ActionIcon>
            )}
            <Text fw={700}>{withWho ? `${name}: head to head` : `Compare ${name} stats`}</Text>
          </Group>
        }
      >
        {!withWho ? (
          <Picker game={game} onPick={pick} />
        ) : error ? (
          <Stack gap="md">
            <Alert color="red" variant="light">
              {error}
            </Alert>
            <Button variant="default" onClick={back} w="fit-content">
              Pick someone else
            </Button>
          </Stack>
        ) : !c ? (
          <Group gap="sm" py="xl" justify="center">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              {withWho.startsWith('lookup:') ? 'Reading their public pages…' : 'Loading…'}
            </Text>
          </Group>
        ) : (
          <CompareView c={c} extra={sections?.(c)} />
        )}
      </Modal>
    </>
  );
}
