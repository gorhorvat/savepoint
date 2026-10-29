import { Badge, Button, Group, Paper, Progress, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconGift, IconHeartFilled, IconUserMinus } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AddOnPlatforms } from '../components/AddOnPlatforms';
import { Cover } from '../components/Cover';
import { GiftWantModal, GiftWishModal } from '../components/GiftModal';
import { PlatformIcon } from '../components/PlatformBadge';
import { FriendAvatar } from '../components/ProfileAvatar';
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
import type { Game, PlatformId } from '../types';

const fmt = (n: number) => Math.round(n).toLocaleString();

/** A friend's game as something the cover component can show. */
const asGame = (g: ProfileGame, i: number): Game => ({
  id: `friend-game-${i}-${g.title}`,
  title: g.title,
  imageUrl: g.imageUrl,
  genres: [],
  subgenres: [],
  tags: [],
  availableOn: (g.platforms ?? []).filter((p): p is PlatformId => p in PLATFORM_BY_ID),
});

function GiftButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <Button
      size="compact-xs"
      variant="light"
      leftSection={<IconGift size={13} />}
      onClick={onClick}
      aria-label={`Gift ${title}`}
      mt={6}
    >
      Gift
    </Button>
  );
}

function Shelf({
  title,
  games,
  meta,
  onGift,
}: {
  title: string;
  games: ProfileGame[];
  meta: (g: ProfileGame) => string;
  onGift?: (g: ProfileGame) => void;
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
            <Cover game={asGame(g, i)} width="100%" radius={12} />
            <Text fw={700} mt={8} truncate>
              {g.title}
            </Text>
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

function WantsShelf({ wants, onGift }: { wants: ProfileWant[]; onGift: (w: ProfileWant) => void }) {
  if (!wants.length) return null;
  return (
    <section aria-label="Physical wants">
      <Title order={2} mb="sm">
        Physical wants
      </Title>
      <div className="shelf">
        {wants.map((w, i) => (
          <div key={`${w.title}-${w.platform}-${i}`} className="shelf-tile">
            <Cover
              game={{ id: `want-${i}-${w.title}`, title: w.title, imageUrl: w.imageUrl, genres: [], subgenres: [], tags: [], availableOn: [] }}
              width="100%"
              radius={12}
            />
            <Text fw={700} mt={8} truncate>
              {w.title}
            </Text>
            <Text size="sm" c="dimmed" truncate>
              {[w.platform, w.edition].filter(Boolean).join(', ')}
            </Text>
            <GiftButton title={w.title} onClick={() => onGift(w)} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function FriendProfilePage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
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

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000); // Online status changes.
    return () => clearInterval(timer);
  }, [load]);

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

      <Shelf title="Most played" games={p.topGames ?? []} meta={(g) => `${fmt(g.hours ?? 0)} h`} />
      <Shelf
        title="Wishlist"
        games={p.wishlist ?? []}
        meta={(g) =>
          (g.platforms ?? [])
            .filter((x): x is PlatformId => x in PLATFORM_BY_ID)
            .map((x) => PLATFORM_BY_ID[x].short)
            .join(', ')
        }
        onGift={setGiftWish}
      />
      <WantsShelf wants={p.physicalWants ?? []} onGift={setGiftWant} />
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
