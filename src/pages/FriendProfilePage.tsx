import { Badge, Button, Group, Paper, Progress, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconDisc, IconGift, IconHeartFilled, IconMessage, IconUserMinus } from '@tabler/icons-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AddOnPlatforms } from '../components/AddOnPlatforms';
import { BadgeRow } from '../components/Badges';
import { Cover } from '../components/Cover';
import { GiftWantModal, GiftWishModal } from '../components/GiftModal';
import { PlatformIcon } from '../components/PlatformBadge';
import { FriendAvatar } from '../components/ProfileAvatar';
import { RarestUnlocks } from '../components/RarestUnlocks';
import { PLATFORM_BY_ID } from '../data/platforms';
import {
  describePresence,
  fetchFriend,
  isOnline,
  removeFriend,
  type FriendProfile,
  type ProfileGame,
  type ProfileWant,
} from '../lib/friends';
import { formatLastPlayed } from '../lib/format';
import { normalizeTitle } from '../lib/match';
import { useTick } from '../lib/pulse';
import { useStore } from '../lib/store';
import type { Game, PlatformId } from '../types';

const fmt = (n: number) => Math.round(n).toLocaleString();

/** A friend's game as something the cover component can show. */
const asGame = (g: Pick<ProfileGame, 'title' | 'imageUrl' | 'platforms'>, i: number): Game => ({
  id: `friend-game-${i}-${g.title}`,
  title: g.title,
  imageUrl: g.imageUrl,
  genres: [],
  subgenres: [],
  tags: [],
  availableOn: (g.platforms ?? []).filter((p): p is PlatformId => p in PLATFORM_BY_ID),
});

function GiftButton({ onClick, title, label = 'Gift' }: { onClick: () => void; title: string; label?: string }) {
  return (
    <Button
      size="compact-xs"
      variant="light"
      leftSection={<IconGift size={13} />}
      onClick={onClick}
      aria-label={`Gift ${title}`}
      mt={6}
    >
      {label}
    </Button>
  );
}

/** "Today", "Yesterday", "3 days ago", "21 Oct" */
function lastPlayedLabel(iso?: string) {
  const text = formatLastPlayed(iso ?? null);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Opens a friend's game on its game page: your own copy of it when you have
 * one, otherwise it's saved the way a search result is (not added to your
 * library) so its page can show.
 */
function useOpenFriendGame() {
  const saveFound = useStore((s) => s.saveFound);
  const navigate = useNavigate();
  return (g: ProfileGame) => {
    const id = saveFound({
      title: g.title,
      imageUrl: g.imageUrl,
      steamAppId: g.steamAppId,
      availableOn: (g.platforms ?? []).filter((p): p is PlatformId => p in PLATFORM_BY_ID),
      genres: [],
      subgenres: [],
      tags: [],
    });
    navigate(`/game/${id}`);
  };
}

function Shelf({
  title,
  games,
  meta,
  onGift,
  onOpen,
}: {
  title: string;
  games: ProfileGame[];
  meta: (g: ProfileGame) => string;
  onGift?: (g: ProfileGame) => void;
  /** Makes each game a link to its game page. */
  onOpen?: (g: ProfileGame) => void;
}) {
  if (!games.length) return null;
  return (
    <section aria-label={title}>
      <Title order={2} mb="sm">
        {title}
      </Title>
      <div className="shelf">
        {games.map((g, i) => (
          <div key={`${g.title}-${i}`} className="shelf-tile">
            {onOpen ? (
              <UnstyledButton onClick={() => onOpen(g)} aria-label={`Open ${g.title}`} display="block" w="100%">
                <Cover game={asGame(g, i)} width="100%" radius={12} />
                <Text fw={700} mt={8} truncate>
                  {g.title}
                </Text>
              </UnstyledButton>
            ) : (
              <>
                <Cover game={asGame(g, i)} width="100%" radius={12} />
                <Text fw={700} mt={8} truncate>
                  {g.title}
                </Text>
              </>
            )}
            <Text size="sm" c="dimmed" truncate>
              {meta(g)}
            </Text>
            {onGift && <GiftButton title={g.title} onClick={() => onGift(g)} />}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A friend's wishlist: one tile per game, physical copies they want marked on it. */
function WishlistShelf({
  wishlist,
  wants,
  onGift,
  onGiftWant,
  onOpen,
}: {
  wishlist: ProfileGame[];
  wants: ProfileWant[];
  onGift: (g: ProfileGame) => void;
  onGiftWant: (w: ProfileWant) => void;
  onOpen: (g: ProfileGame) => void;
}) {
  const tiles: { title: string; imageUrl?: string; digital?: ProfileGame; wants: ProfileWant[] }[] = [];
  const byTitle = new Map<string, (typeof tiles)[number]>();
  for (const g of wishlist) {
    const tile = { title: g.title, imageUrl: g.imageUrl, digital: g, wants: [] };
    tiles.push(tile);
    byTitle.set(normalizeTitle(g.title), tile);
  }
  for (const w of wants) {
    const key = normalizeTitle(w.title);
    const tile = byTitle.get(key) ?? { title: w.title, imageUrl: w.imageUrl, wants: [] };
    if (!byTitle.has(key)) {
      tiles.push(tile);
      byTitle.set(key, tile);
    }
    tile.wants.push(w);
  }
  if (!tiles.length) return null;
  return (
    <section aria-label="Wishlist">
      <Title order={2} mb="sm">
        Wishlist
      </Title>
      <div className="shelf">
        {tiles.map((t, i) => {
          const digitalOn = (t.digital?.platforms ?? [])
            .filter((x): x is PlatformId => x in PLATFORM_BY_ID)
            .map((x) => PLATFORM_BY_ID[x].short)
            .join(', ');
          const cover = (
            <>
              <Cover game={asGame(t.digital ?? { title: t.title, imageUrl: t.imageUrl }, i)} width="100%" radius={12} />
              <Text fw={700} mt={8} truncate>
                {t.title}
              </Text>
            </>
          );
          return (
            <div key={`${t.title}-${i}`} className="shelf-tile">
              {t.digital ? (
                <UnstyledButton
                  onClick={() => onOpen(t.digital!)}
                  aria-label={`Open ${t.title}`}
                  display="block"
                  w="100%"
                >
                  {cover}
                </UnstyledButton>
              ) : (
                cover
              )}
              {digitalOn && (
                <Text size="sm" c="dimmed" truncate>
                  {digitalOn}
                </Text>
              )}
              {t.wants.length > 0 && (
                <Badge
                  size="sm"
                  variant="light"
                  radius="xs"
                  tt="none"
                  mt={4}
                  maw="100%"
                  leftSection={<IconDisc size={12} />}
                >
                  Physical: {t.wants.map((w) => [w.platform, w.edition].filter(Boolean).join(' ')).join(', ')}
                </Badge>
              )}
              <Group gap={6} wrap="wrap">
                {t.digital && <GiftButton title={t.title} onClick={() => onGift(t.digital!)} />}
                {t.wants.map((w) => (
                  <GiftButton
                    key={`${w.platform}-${w.edition ?? ''}`}
                    title={`${t.title} (${w.platform})`}
                    label={t.digital || t.wants.length > 1 ? `Gift ${w.platform}` : 'Gift'}
                    onClick={() => onGiftWant(w)}
                  />
                ))}
              </Group>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function FriendProfilePage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const openGame = useOpenFriendGame();
  const [friend, setFriend] = useState<FriendProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [giftWish, setGiftWish] = useState<ProfileGame | null>(null);
  const [giftWant, setGiftWant] = useState<ProfileWant | null>(null);

  const load = useCallback(() => {
    fetchFriend(id)
      .then((f) => {
        setFriend(f);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useTick(load, 60_000); // Online status changes.

  const remove = async () => {
    try {
      await removeFriend(id);
      notifications.show({ message: `${friend?.username} is no longer your friend.` });
      navigate('/friends');
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    }
  };

  const back = (
    <Button
      component={Link}
      to="/friends"
      variant="subtle"
      color="gray"
      leftSection={<IconArrowLeft size={16} />}
      w="fit-content"
      px={0}
    >
      Friends
    </Button>
  );

  if (error) {
    return (
      <Stack gap="md">
        {back}
        <Text c="dimmed">{error}</Text>
      </Stack>
    );
  }
  if (!friend) return back;

  const p = friend.profile ?? {};
  const online = isOnline(friend.presence);
  const card = {
    username: friend.username,
    avatar: p.avatar ?? null,
    level: p.level ?? null,
    into: p.into ?? null,
    needed: p.needed ?? null,
  };
  const platforms = Object.entries(p.hoursByPlatform ?? {})
    .filter(([id]) => id in PLATFORM_BY_ID)
    .sort((a, b) => b[1] - a[1]) as [PlatformId, number][];
  const favourites = [...(p.favoriteGenres ?? []), ...(p.favoriteFranchises ?? [])];

  return (
    <Stack gap={40}>
      {back}
      <Group gap="xl" wrap="wrap" align="center">
        <FriendAvatar friend={card} size={96} online={online} />
        <Stack gap={4} style={{ flex: '1 1 260px' }}>
          <Group gap="sm" align="baseline">
            <Title order={1}>{friend.username}</Title>
            {p.rank && (
              <Badge variant="light" size="lg" radius="sm" tt="none">
                {p.rank}
              </Badge>
            )}
          </Group>
          <Text c={online ? undefined : 'dimmed'}>{describePresence(friend.presence)}</Text>
          {p.level != null && p.into != null && p.needed ? (
            <Stack gap={4} maw={420} mt={6}>
              <Progress
                value={(p.into / p.needed) * 100}
                size="sm"
                radius="xl"
                aria-label="Progress to the next level"
              />
              <Text size="xs" c="dimmed" className="num">
                Level {p.level}, {fmt(p.xp ?? 0)} XP
              </Text>
            </Stack>
          ) : null}
        </Stack>
        <Button component={Link} to={`/messages/${friend.id}`} leftSection={<IconMessage size={16} />}>
          Message
        </Button>
      </Group>

      {!friend.profile && (
        <Text c="dimmed">
          {friend.username} hasn&apos;t opened Savepoint since friends arrived, so there&apos;s nothing to show yet.
        </Text>
      )}

      {friend.profile && (
        <SimpleGrid cols={{ base: 2, sm: 2 + Math.min(platforms.length, 3) }} spacing="md">
          <Paper p="md">
            <Text size="sm" c="dimmed">
              Hours played
            </Text>
            <Text className="display num" fz={32}>
              {fmt(p.totalHours ?? 0)}
            </Text>
          </Paper>
          <Paper p="md">
            <Text size="sm" c="dimmed">
              Games played
            </Text>
            <Text className="display num" fz={32}>
              {fmt(p.gameCount ?? 0)}
            </Text>
          </Paper>
          {platforms.slice(0, 3).map(([id, hours]) => (
            <Paper p="md" key={id}>
              <Group gap={6}>
                <PlatformIcon platform={id} size={14} />
                <Text size="sm" c="dimmed">
                  {PLATFORM_BY_ID[id].name}
                </Text>
              </Group>
              <Text className="display num" fz={32}>
                {fmt(hours)} h
              </Text>
            </Paper>
          ))}
        </SimpleGrid>
      )}

      <AddOnPlatforms friend={friend} />

      {(p.badges?.length ?? 0) > 0 && (
        <section aria-label="Badges">
          <Title order={2} mb="sm">
            Badges
          </Title>
          <BadgeRow items={(p.badges ?? []).slice(0, 8)} />
        </section>
      )}

      {favourites.length > 0 && (
        <Stack gap="sm">
          <Title order={2}>Favourites</Title>
          <Group gap="xs">
            {favourites.map((name) => (
              <Badge
                key={name}
                size="lg"
                radius="xs"
                tt="none"
                fw={600}
                className="fav-chip"
                leftSection={<IconHeartFilled size={12} />}
              >
                {name}
              </Badge>
            ))}
          </Group>
        </Stack>
      )}

      <Shelf
        title="Recently played"
        games={p.recentGames ?? []}
        meta={(g) => lastPlayedLabel(g.lastPlayed)}
        onOpen={openGame}
      />
      <Shelf title="Most played" games={p.topGames ?? []} meta={(g) => `${fmt(g.hours ?? 0)} h`} onOpen={openGame} />
      <RarestUnlocks
        items={p.rarest ?? []}
        onOpen={(r) =>
          openGame({ title: r.title, imageUrl: r.imageUrl, steamAppId: r.steamAppId, platforms: [r.platform] })
        }
      />
      <WishlistShelf
        wishlist={p.wishlist ?? []}
        wants={p.physicalWants ?? []}
        onGift={setGiftWish}
        onGiftWant={setGiftWant}
        onOpen={openGame}
      />
      <GiftWishModal friend={{ id, username: friend.username }} game={giftWish} onClose={() => setGiftWish(null)} />
      <GiftWantModal want={giftWant} onClose={() => setGiftWant(null)} />

      <Group gap="xs">
        {confirmRemove ? (
          <>
            <Button color="red" variant="light" size="xs" onClick={() => void remove()}>
              Remove {friend.username}
            </Button>
            <Button variant="subtle" color="gray" size="xs" onClick={() => setConfirmRemove(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<IconUserMinus size={14} />}
            onClick={() => setConfirmRemove(true)}
          >
            Remove friend
          </Button>
        )}
      </Group>
    </Stack>
  );
}
