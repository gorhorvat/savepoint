import { Anchor, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconAdjustments, IconArrowRight, IconGift } from '@tabler/icons-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { StreamCard } from '../components/LiveStreams';
import { FriendAvatar } from '../components/ProfileAvatar';
import { LeaderboardRow } from '../components/LeaderboardRow';
import { fetchAccount, fetchBigDeals, fetchFreeGames, type BigDeal, type FreeGiveaway } from '../lib/api';
import { useFavorites } from '../lib/favorites';
import { formatLastPlayed, formatPlaytime, formatPrice, upcomingLabel } from '../lib/format';
import {
  describePresence,
  fetchFriends,
  fetchLeaderboard,
  fetchGiftSummary,
  isOnline,
  type FriendsList,
} from '../lib/friends';
import { HOME_WIDGETS, normalizeHomepage, type HomeWidgetId } from '../lib/homepage';
import { useLibrary, useOwnedPlatforms, useUnlinkedPhysicalTitles, type LibraryGame } from '../lib/library';
import { newestFirst, recommend } from '../lib/recommend';
import { useGameResolver, useStore } from '../lib/store';
import { fetchFollowedLive, watchedForTaste, type LiveStream } from '../lib/streaming';
import { useSuggestionPool } from '../lib/suggestions';
import { useXp } from '../lib/xp';
import type { Game } from '../types';

/** "5 min ago", "3 h ago", "2 days ago". */
function ago(iso?: string, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

/** Loads once when the section mounts; null while loading, 'error' when it failed. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): T | null | 'error' {
  const [value, setValue] = useState<{ key: string; v: T | 'error' } | null>(null);
  const key = JSON.stringify(deps);
  useEffect(() => {
    let alive = true;
    load()
      .then((v) => alive && setValue({ key, v }))
      .catch(() => alive && setValue({ key, v: 'error' }));
    return () => {
      alive = false;
    };
    // The deps array stands in for the loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return value?.key === key ? value.v : null;
}

function Section({
  title,
  more,
  children,
}: {
  title: string;
  more?: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <Stack gap="sm" component="section" aria-label={title}>
      <Group justify="space-between" align="baseline">
        <Title order={2}>{title}</Title>
        {more && (
          <Anchor component={Link} to={more.to} size="sm">
            <Group gap={4} component="span" style={{ display: 'inline-flex' }}>
              {more.label}
              <IconArrowRight size={14} />
            </Group>
          </Anchor>
        )}
      </Group>
      {children}
    </Stack>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <Text size="sm" c="dimmed">
    {children}
  </Text>
);

function GameShelf({ items }: { items: { game: Game; meta: string }[] }) {
  return (
    <div className="shelf">
      {items.map(({ game, meta }) => (
        <Link key={game.id} to={`/game/${game.id}`} className="shelf-tile">
          <Cover game={game} width="100%" radius={12} />
          <Text fw={700} mt={8} truncate>
            {game.title}
          </Text>
          <Text size="sm" c="dimmed" truncate>
            {meta}
          </Text>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- sections

function ContinuePlaying({ lib }: { lib: LibraryGame[] }) {
  const recent = [...lib]
    .filter((g) => g.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''))
    .slice(0, 8);
  return (
    <Section title="Continue playing" more={{ to: '/library', label: 'Library' }}>
      {recent.length ? (
        <GameShelf
          items={recent.map((g) => ({
            game: g.game,
            meta: `${formatPlaytime(g.totalMinutes)}, ${formatLastPlayed(g.lastPlayed)}`,
          }))}
        />
      ) : (
        <Quiet>Nothing played yet. Connect a platform in Settings to bring in your games.</Quiet>
      )}
    </Section>
  );
}

function TopGames({ lib }: { lib: LibraryGame[] }) {
  const top = [...lib].sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 8);
  return (
    <Section title="Your top games" more={{ to: '/stats', label: 'My Stats' }}>
      {top.length ? (
        <GameShelf items={top.map((g) => ({ game: g.game, meta: formatPlaytime(g.totalMinutes) }))} />
      ) : (
        <Quiet>No play time yet.</Quiet>
      )}
    </Section>
  );
}

function PlayNext({ lib }: { lib: LibraryGame[] }) {
  const pool = useSuggestionPool(lib);
  const dismissed = useStore((s) => s.dismissed);
  const streamTaste = useStore((s) => s.streamTaste);
  const favorites = useFavorites();
  const alsoOwned = useUnlinkedPhysicalTitles();
  const owned = useOwnedPlatforms(lib);
  const recs = useMemo(
    () =>
      newestFirst(
        recommend(lib, {
          owned,
          exclude: new Set(dismissed),
          pool: pool.games,
          favorites,
          alsoOwned,
          watched: watchedForTaste(streamTaste),
        }).filter((r) => !owned.length || r.onYourPlatforms.length > 0),
      ).slice(0, 8),
    [lib, owned, dismissed, pool.games, favorites, alsoOwned, streamTaste],
  );
  return (
    <Section title="Play next" more={{ to: '/discover', label: 'More picks' }}>
      {recs.length ? (
        <GameShelf
          items={recs.map((r) => ({
            game: r.game,
            meta: r.streamedBy?.length ? `${r.fit}% match, ${r.streamedBy[0]} plays it` : `${r.fit}% match`,
          }))}
        />
      ) : (
        <Quiet>{pool.loading ? 'Finding games for you…' : 'Play a few games and suggestions show up here.'}</Quiet>
      )}
    </Section>
  );
}

function LiveNow() {
  const kick = useStore((s) => s.kickChannels);
  const live = useLoad(() => fetchFollowedLive(kick).then((r) => r.live), [kick]);
  return (
    <Section title="Your streamers, live" more={{ to: '/settings#streaming', label: 'Streamers' }}>
      {live === null ? (
        <Quiet>Checking who&apos;s live…</Quiet>
      ) : live === 'error' ? (
        <Quiet>Couldn&apos;t check right now.</Quiet>
      ) : live.length ? (
        <div className="stream-grid">
          {live.slice(0, 8).map((s: LiveStream) => (
            <StreamCard key={`${s.platform}-${s.channel}`} s={s} showGame />
          ))}
        </div>
      ) : (
        <Quiet>
          Nobody you follow is live. Sign in with Twitch or add Kick channels in{' '}
          <Anchor component={Link} to="/settings#streaming" inherit>
            Settings
          </Anchor>{' '}
          if you haven&apos;t.
        </Quiet>
      )}
    </Section>
  );
}

function FriendActivity() {
  const data = useLoad(() => Promise.all([fetchFriends(), fetchGiftSummary().catch(() => ({ unopened: 0 }))]));
  if (data === null) {
    return (
      <Section title="Friend activity" more={{ to: '/friends', label: 'Friends' }}>
        <Quiet>Loading…</Quiet>
      </Section>
    );
  }
  if (data === 'error') {
    return (
      <Section title="Friend activity" more={{ to: '/friends', label: 'Friends' }}>
        <Quiet>Couldn&apos;t load your friends right now.</Quiet>
      </Section>
    );
  }
  const [list, gifts] = data as [FriendsList, { unopened: number }];
  const online = list.friends.filter((f) => isOnline(f.presence));
  return (
    <Section title="Friend activity" more={{ to: '/friends', label: 'Friends' }}>
      {(list.incoming.length > 0 || gifts.unopened > 0) && (
        <Group gap="xs">
          {gifts.unopened > 0 && (
            <Button component={Link} to="/friends" size="xs" leftSection={<IconGift size={14} />}>
              {gifts.unopened} {gifts.unopened === 1 ? 'gift' : 'gifts'} to open
            </Button>
          )}
          {list.incoming.length > 0 && (
            <Button component={Link} to="/friends" size="xs" variant="light">
              {list.incoming.length} friend {list.incoming.length === 1 ? 'request' : 'requests'}
            </Button>
          )}
        </Group>
      )}
      {online.length ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
          {online.slice(0, 9).map((f) => (
            <Link key={f.id} to={`/friends/${f.id}`} className="friend-row">
              <FriendAvatar friend={f} size={40} online />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text fw={700} truncate>
                  {f.username}
                </Text>
                <Text size="sm" truncate>
                  {describePresence(f.presence)}
                </Text>
              </div>
            </Link>
          ))}
        </SimpleGrid>
      ) : (
        <Quiet>
          {list.friends.length
            ? 'None of your friends are online right now.'
            : 'No friends yet. Add some on the Friends page.'}
        </Quiet>
      )}
    </Section>
  );
}

function FreeGames() {
  const homepage = useStore((s) => s.homepage);
  const wanted = useMemo(() => normalizeHomepage(homepage).freeGames, [homepage]);
  const games = useLoad(() => fetchFreeGames(wanted), [wanted]);
  return (
    <Section title="Free games">
      {games === null ? (
        <Quiet>Loading…</Quiet>
      ) : games === 'error' ? (
        <Quiet>Couldn&apos;t load free games right now.</Quiet>
      ) : games.length ? (
        <div className="shelf">
          {games.slice(0, 10).map((g: FreeGiveaway) => (
            <Anchor
              key={g.id}
              href={g.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shelf-tile"
              underline="never"
            >
              <div className="cover" style={{ aspectRatio: '460 / 215', borderRadius: 12 }}>
                {g.image && <img src={g.image} alt="" loading="lazy" />}
              </div>
              <Text fw={700} mt={8} truncate>
                {g.title}
              </Text>
              <Text size="sm" c="dimmed" truncate>
                {[g.worth && `${g.worth} value`, g.platforms].filter(Boolean).join(' · ')}
              </Text>
              {g.endsAt && (
                <Text size="xs" c="dimmed">
                  Ends {new Date(g.endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </Text>
              )}
            </Anchor>
          ))}
        </div>
      ) : (
        <Quiet>No free games right now.</Quiet>
      )}
      <Text size="xs" c="dimmed">
        From{' '}
        <Anchor href="https://www.gamerpower.com" target="_blank" rel="noopener noreferrer" inherit>
          GamerPower
        </Anchor>
        . Get a push for new ones in{' '}
        <Anchor component={Link} to="/settings#alerts" inherit>
          Settings
        </Anchor>
        .
      </Text>
    </Section>
  );
}

function BigDeals() {
  const deals = useLoad(fetchBigDeals);
  return (
    <Section title="Big deals">
      {deals === null ? (
        <Quiet>Loading…</Quiet>
      ) : deals === 'error' ? (
        <Quiet>Couldn&apos;t load deals right now.</Quiet>
      ) : deals.length ? (
        <Paper p={{ base: 'xs', sm: 'md' }}>
          <Stack gap={0}>
            {deals.slice(0, 8).map((d: BigDeal, i) => (
              <Group
                key={d.id}
                justify="space-between"
                wrap="nowrap"
                py={8}
                style={{ borderTop: i ? '1px solid var(--sp-line)' : undefined }}
              >
                <div style={{ minWidth: 0 }}>
                  <Anchor
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    c="inherit"
                    fw={600}
                    size="sm"
                    truncate
                  >
                    {d.title}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    {d.shop}
                    {d.historicalLow ? ', lowest price ever' : ''}
                  </Text>
                </div>
                <Group gap={8} wrap="nowrap">
                  <Badge size="sm" color="green" variant="light" radius="xs" className="num">
                    −{d.cut}%
                  </Badge>
                  {d.price !== undefined && (
                    <Text fw={700} className="num">
                      {formatPrice(d.price)}
                    </Text>
                  )}
                </Group>
              </Group>
            ))}
          </Stack>
        </Paper>
      ) : (
        <Quiet>No big deals right now.</Quiet>
      )}
    </Section>
  );
}

interface NewsItem {
  title: string;
  url: string;
  publishedAt?: string;
  image?: string;
  source: string;
}

function News() {
  const homepage = useStore((s) => s.homepage);
  const sources = useMemo(() => normalizeHomepage(homepage).newsSources, [homepage]);
  const items = useLoad(
    () =>
      fetch(`/api/news?sources=${encodeURIComponent(sources.join(','))}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
        .then((j: { items: NewsItem[] }) => ({ items: j.items, at: Date.now() })),
    [sources],
  );
  return (
    <Section title="Gaming news">
      {items === null ? (
        <Quiet>Loading…</Quiet>
      ) : items === 'error' || !items.items.length ? (
        <Quiet>No news right now.</Quiet>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          {items.items.slice(0, 10).map((n) => (
            <Anchor
              key={n.url}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              c="inherit"
              underline="never"
              className="news-row"
            >
              {n.image ? <img src={n.image} alt="" loading="lazy" /> : <span className="news-thumb" aria-hidden />}
              <div style={{ minWidth: 0 }}>
                <Text fw={600} size="sm" lineClamp={2}>
                  {n.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {n.source}
                  {n.publishedAt ? ` · ${ago(n.publishedAt, items.at)}` : ''}
                </Text>
              </div>
            </Anchor>
          ))}
        </SimpleGrid>
      )}
    </Section>
  );
}

function ComingSoon() {
  const wishlist = useStore((s) => s.wishlist);
  const resolve = useGameResolver();
  const [now] = useState(() => Date.now());
  const soon = wishlist
    .map((w) => resolve(w.gameId))
    .filter((g): g is Game => !!g && (!!g.comingSoon || (!!g.releaseDate && new Date(g.releaseDate).getTime() > now)))
    .sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'))
    .slice(0, 8);
  return (
    <Section title="Coming soon" more={{ to: '/wishlist', label: 'Wishlist' }}>
      {soon.length ? (
        <GameShelf items={soon.map((g) => ({ game: g, meta: upcomingLabel(g) ?? 'Coming soon' }))} />
      ) : (
        <Quiet>Nothing on your wishlist is coming out soon.</Quiet>
      )}
    </Section>
  );
}

function QuickStats({ lib }: { lib: LibraryGame[] }) {
  const xp = useXp();
  const minutes = lib.reduce((n, g) => n + g.totalMinutes, 0);
  const played = lib.filter((g) => g.totalMinutes > 0).length;
  const tiles = [
    { label: 'Hours played', value: Math.round(minutes / 60).toLocaleString() },
    { label: 'Games played', value: played.toLocaleString() },
    { label: 'Level', value: `${xp.level}`, sub: xp.rank },
  ];
  return (
    <Section title="Quick stats" more={{ to: '/stats', label: 'My Stats' }}>
      <SimpleGrid cols={{ base: 3 }} spacing="md">
        {tiles.map((t) => (
          <Paper key={t.label} p="md">
            <Text size="sm" c="dimmed">
              {t.label}
            </Text>
            <Text className="display num" fz={28}>
              {t.value}
            </Text>
            {t.sub && (
              <Text size="xs" c="dimmed">
                {t.sub}
              </Text>
            )}
          </Paper>
        ))}
      </SimpleGrid>
    </Section>
  );
}

function FriendsLeaderboard() {
  const board = useLoad(() => fetchLeaderboard('friends'));
  return (
    <Section title="Leaderboard" more={{ to: '/leaderboard', label: 'Full board' }}>
      {board === null ? (
        <Quiet>Loading…</Quiet>
      ) : board === 'error' ? (
        <Quiet>Couldn&apos;t load the leaderboard right now.</Quiet>
      ) : board.rows.length < 2 ? (
        <Quiet>Add friends to see where you stand.</Quiet>
      ) : (
        <Paper p={{ base: 'xs', sm: 'sm' }}>
          <Stack gap={2}>
            {board.rows.slice(0, 5).map((r) => (
              <LeaderboardRow key={r.id} r={r} friend />
            ))}
            {board.you && board.you.place > 5 && <LeaderboardRow r={board.you} />}
          </Stack>
        </Paper>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- page

export function HomePage() {
  const homepage = useStore((s) => s.homepage);
  const account = useLoad(fetchAccount);
  const username = account && account !== 'error' ? account.username : null;
  const lib = useLibrary();
  const widgets = normalizeHomepage(homepage).widgets.filter((w) => w.on);

  const render = (id: HomeWidgetId) => {
    switch (id) {
      case 'continue':
        return <ContinuePlaying lib={lib} />;
      case 'picks':
        return <PlayNext lib={lib} />;
      case 'live':
        return <LiveNow />;
      case 'friends':
        return <FriendActivity />;
      case 'free':
        return <FreeGames />;
      case 'news':
        return <News />;
      case 'upcoming':
        return <ComingSoon />;
      case 'deals':
        return <BigDeals />;
      case 'top':
        return <TopGames lib={lib} />;
      case 'stats':
        return <QuickStats lib={lib} />;
      case 'leaderboard':
        return <FriendsLeaderboard />;
    }
  };

  return (
    <Stack gap={44}>
      <Group justify="space-between" align="flex-end" gap="md">
        <div>
          <Title order={1}>{username ? `Welcome back, ${username}` : 'Home'}</Title>
          <Text c="dimmed" mt={6} size="lg">
            Your games, streams, friends and news in one place.
          </Text>
        </div>
        <Button component={Link} to="/settings#homepage" variant="default" leftSection={<IconAdjustments size={16} />}>
          Customize
        </Button>
      </Group>
      {widgets.length ? (
        widgets.map((w) => <div key={w.id}>{render(w.id)}</div>)
      ) : (
        <Quiet>
          Every section is turned off.{' '}
          <Anchor component={Link} to="/settings#homepage" inherit>
            Pick what to show
          </Anchor>
          .
        </Quiet>
      )}
      {Object.keys(HOME_WIDGETS).length > widgets.length && widgets.length > 0 && (
        <Text size="xs" c="dimmed" ta="center">
          {Object.keys(HOME_WIDGETS).length - widgets.length} more sections can be turned on in{' '}
          <Anchor component={Link} to="/settings#homepage" inherit>
            Customize
          </Anchor>
          .
        </Text>
      )}
    </Stack>
  );
}
