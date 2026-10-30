import {
  Avatar,
  Badge,
  Button,
  Grid,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconHeart, IconSend } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchFriends, type FriendCard } from '../lib/friends';
import { useLibrary } from '../lib/library';
import { ownedKey } from '../lib/match';
import {
  fetchChat,
  fetchConversations,
  MESSAGES_CHANGED,
  sendMessage,
  type ChatPerson,
  type Conversation,
  type Message,
  type SharedGame,
} from '../lib/messages';
import { useStore } from '../lib/store';

const CHAT_POLL = 4000;
const LIST_POLL = 15000;

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function shortWhen(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? time(iso)
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Runs `fn` every `ms` while the tab is visible, and once when it becomes visible again. */
function usePoll(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    const tick = () => document.visibilityState === 'visible' && ref.current();
    const timer = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms, enabled]);
}

function Person({ p, size = 36 }: { p: ChatPerson; size?: number }) {
  return (
    <Avatar src={p.avatar} size={size} radius={size} color="gold" alt="">
      {p.username.slice(0, 2).toUpperCase()}
    </Avatar>
  );
}

/** A shared game: open it if you have it, or put it on your wishlist. */
function GameCardMessage({ game, mine }: { game: SharedGame; mine: boolean }) {
  const lib = useLibrary({ includeApps: true });
  const customGames = useStore((s) => s.customGames);
  const addFoundToWishlist = useStore((s) => s.addFoundToWishlist);
  const navigate = useNavigate();
  const known = useMemo(() => {
    const key = ownedKey(game.title);
    const all = [...lib.map((l) => l.game), ...Object.values(customGames)];
    return all.find((g) => (game.steamAppId && g.steamAppId === game.steamAppId) || ownedKey(g.title) === key);
  }, [lib, customGames, game]);
  const owned = known && lib.some((l) => l.game.id === known.id);

  const wishlist = () => {
    const id = addFoundToWishlist({ ...game, availableOn: game.availableOn ?? [] });
    notifications.show({ message: `Added ${game.title} to your wishlist`, autoClose: 2200 });
    navigate(`/game/${id}`);
  };

  return (
    <Paper withBorder radius="md" p={8} w={280} maw="100%">
      <Group gap={10} wrap="nowrap" align="flex-start">
        {game.imageUrl ? (
          <img
            src={game.imageUrl}
            alt=""
            width={56}
            height={74}
            style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
          />
        ) : (
          <div style={{ width: 56, height: 74, borderRadius: 6, background: 'var(--sp-raised)', flexShrink: 0 }} />
        )}
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} lineClamp={2}>
            {game.title}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {[game.year ?? game.releaseDate?.slice(0, 4), game.genres.slice(0, 2).join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {game.fit != null && (
            <Text size="xs" c="dimmed">
              {mine ? `${game.fit}% match for you` : `${game.fit}% match for them`}
            </Text>
          )}
          {known ? (
            <Button component={Link} to={`/game/${known.id}`} size="compact-xs" variant="light" w="fit-content">
              {owned ? 'In your library' : 'Open'}
            </Button>
          ) : (
            !mine && (
              <Button
                size="compact-xs"
                variant="light"
                w="fit-content"
                leftSection={<IconHeart size={12} />}
                onClick={wishlist}
              >
                Add to wishlist
              </Button>
            )
          )}
        </Stack>
      </Group>
    </Paper>
  );
}

function Bubble({ m, mine, seen }: { m: Message; mine: boolean; seen: boolean }) {
  return (
    <Stack gap={4} align={mine ? 'flex-end' : 'flex-start'}>
      {m.game && <GameCardMessage game={m.game} mine={mine} />}
      {m.body && (
        <div className={`chat-bubble${mine ? ' chat-bubble--mine' : ''}`}>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {m.body}
          </Text>
        </div>
      )}
      <Text size="10px" c="dimmed">
        {time(m.at)}
        {seen ? ' · Seen' : ''}
      </Text>
    </Stack>
  );
}

function ChatView({ friendId, onSent }: { friendId: number; onSent: () => void }) {
  const [friend, setFriend] = useState<ChatPerson | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [more, setMore] = useState(false);
  const [canWrite, setCanWrite] = useState(true);
  const [seenUpTo, setSeenUpTo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let alive = true;
    fetchChat(friendId)
      .then((c) => {
        if (!alive) return;
        setFriend(c.friend);
        setMessages(c.messages);
        setMore(c.more);
        setCanWrite(c.canWrite);
        setSeenUpTo(c.seenUpTo);
        setError(null);
        stick.current = true;
        window.dispatchEvent(new Event(MESSAGES_CHANGED));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [friendId]);

  const lastId = messages?.length ? messages[messages.length - 1].id : 0;
  usePoll(
    () =>
      fetchChat(friendId, { after: lastId || undefined })
        .then((c) => {
          setSeenUpTo(c.seenUpTo);
          setCanWrite(c.canWrite);
          if (c.messages.length) {
            setMessages((list) => {
              const ids = new Set((list ?? []).map((x) => x.id));
              return [...(list ?? []), ...c.messages.filter((x) => !ids.has(x.id))];
            });
            if (c.messages.some((x) => !x.mine)) window.dispatchEvent(new Event(MESSAGES_CHANGED));
          }
        })
        .catch(() => {}),
    CHAT_POLL,
    messages !== null,
  );

  useEffect(() => {
    if (stick.current) bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const older = async () => {
    if (!messages?.length) return;
    stick.current = false;
    try {
      const c = await fetchChat(friendId, { before: messages[0].id });
      setMessages([...c.messages, ...messages]);
      setMore(c.more);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await sendMessage(friendId, body);
      stick.current = true;
      setMessages((list) => [...(list ?? []), m]);
      setDraft('');
      onSent();
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  if (error && !messages) return <Text c="red">{error}</Text>;
  if (!messages || !friend) return <Loader size="sm" />;

  const lastMine = [...messages].reverse().find((m) => m.mine);

  return (
    <Stack gap="md" className="chat">
      <Link to={`/friends/${friend.id}`} style={{ textDecoration: 'none', color: 'inherit', width: 'fit-content' }}>
        <Group gap="sm">
          <Person p={friend} size={40} />
          <Text fw={700} size="lg">
            {friend.username}
          </Text>
        </Group>
      </Link>
      <div className="chat-scroll">
        <Stack gap="sm">
          {more && (
            <Button variant="subtle" size="xs" onClick={() => void older()} style={{ alignSelf: 'center' }}>
              Older messages
            </Button>
          )}
          {!messages.length && (
            <Text c="dimmed" ta="center" size="sm" py="xl">
              No messages yet. Say hi, or share a game from its page.
            </Text>
          )}
          {messages.map((m, i) => {
            const day = dayLabel(m.at);
            const showDay = i === 0 || day !== dayLabel(messages[i - 1].at);
            const mine = m.mine;
            return (
              <div key={m.id}>
                {showDay && (
                  <Text size="xs" c="dimmed" ta="center" my="xs">
                    {day}
                  </Text>
                )}
                <Bubble
                  m={m}
                  mine={mine}
                  seen={mine && m.id === lastMine?.id && seenUpTo != null && seenUpTo >= m.id}
                />
              </div>
            );
          })}
          <div ref={bottom} />
        </Stack>
      </div>
      {canWrite ? (
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={onKey}
            placeholder={`Message ${friend.username}`}
            aria-label={`Message ${friend.username}`}
            autosize
            minRows={1}
            maxRows={6}
            maxLength={2000}
            style={{ flex: 1 }}
          />
          <Button
            onClick={() => void send()}
            loading={sending}
            disabled={!draft.trim()}
            leftSection={<IconSend size={16} />}
          >
            Send
          </Button>
        </Group>
      ) : (
        <Text size="sm" c="dimmed">
          You&apos;re no longer friends, so you can read this chat but not reply.
        </Text>
      )}
    </Stack>
  );
}

function ConversationList({
  list,
  active,
  friends,
}: {
  list: Conversation[] | null;
  active: number | null;
  friends: FriendCard[];
}) {
  const navigate = useNavigate();
  const withChat = new Set((list ?? []).map((c) => c.friend.id));
  const others = friends.filter((f) => !withChat.has(f.id));
  return (
    <Stack gap="md">
      {others.length > 0 && (
        <Select
          placeholder="Message a friend"
          aria-label="Message a friend"
          data={others.map((f) => ({ value: String(f.id), label: f.username }))}
          searchable
          value={null}
          onChange={(v) => v && navigate(`/messages/${v}`)}
        />
      )}
      {!list ? (
        <Loader size="sm" />
      ) : !list.length ? (
        <Text size="sm" c="dimmed">
          No conversations yet.
        </Text>
      ) : (
        <Stack gap={2}>
          {list.map((c) => {
            const last = c.last;
            const preview = last.body || (last.game ? `Shared ${last.game.title}` : '');
            return (
              <UnstyledButton
                key={c.friend.id}
                onClick={() => navigate(`/messages/${c.friend.id}`)}
                className={`chat-row${c.friend.id === active ? ' chat-row--active' : ''}`}
                aria-current={c.friend.id === active ? 'true' : undefined}
              >
                <Group gap="sm" wrap="nowrap">
                  <Person p={c.friend} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Group justify="space-between" gap={6} wrap="nowrap">
                      <Text size="sm" fw={c.unread ? 700 : 600} truncate>
                        {c.friend.username}
                      </Text>
                      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                        {shortWhen(last.at)}
                      </Text>
                    </Group>
                    <Group justify="space-between" gap={6} wrap="nowrap">
                      <Text size="xs" c={c.unread ? undefined : 'dimmed'} fw={c.unread ? 600 : 400} truncate>
                        {last.mine ? 'You: ' : ''}
                        {preview}
                      </Text>
                      {c.unread > 0 && (
                        <Badge size="sm" circle>
                          {c.unread}
                        </Badge>
                      )}
                    </Group>
                  </div>
                </Group>
              </UnstyledButton>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

/** Messages with friends: the conversations, and the open chat. */
export function MessagesPage() {
  const { id } = useParams();
  const active = id ? Number(id) : null;
  const [list, setList] = useState<Conversation[] | null>(null);
  const [friends, setFriends] = useState<FriendCard[]>([]);

  const loadList = useCallback(() => {
    fetchConversations()
      .then(setList)
      .catch(() => setList((l) => l ?? []));
  }, []);

  useEffect(() => {
    loadList();
    fetchFriends()
      .then((f) => setFriends(f.friends))
      .catch(() => {});
    window.addEventListener(MESSAGES_CHANGED, loadList);
    return () => window.removeEventListener(MESSAGES_CHANGED, loadList);
  }, [loadList]);
  usePoll(loadList, LIST_POLL);

  const conversations = <ConversationList list={list} active={active} friends={friends} />;

  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>Messages</Title>
        <Text c="dimmed" mt={6} size="lg">
          Chat with your friends and share games.
        </Text>
      </div>
      <Grid gap="xl">
        <Grid.Col span={{ base: 12, md: 4 }} display={{ base: active ? 'none' : 'block', md: 'block' }}>
          {conversations}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }} display={{ base: active ? 'block' : 'none', md: 'block' }}>
          {active ? (
            <Stack gap="sm">
              <Button
                component={Link}
                to="/messages"
                variant="subtle"
                color="gray"
                leftSection={<IconArrowLeft size={16} />}
                w="fit-content"
                px={0}
                hiddenFrom="md"
              >
                All messages
              </Button>
              <ChatView key={active} friendId={active} onSent={loadList} />
            </Stack>
          ) : (
            <Paper p="xl" withBorder visibleFrom="md">
              <Text c="dimmed" ta="center">
                Pick a conversation, or message a friend.
              </Text>
            </Paper>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
