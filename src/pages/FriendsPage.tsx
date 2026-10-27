import { Badge, Button, Group, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconRefresh, IconUserPlus } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FriendAvatar } from '../components/ProfileAvatar';
import {
  acceptFriend,
  describePresence,
  dropRequest,
  FRIENDS_CHANGED,
  fetchFriendCode,
  fetchFriends,
  friendLink,
  isOnline,
  newFriendCode,
  sendFriendRequest,
  type Friend,
  type FriendCard,
  type FriendsList,
} from '../lib/friends';

const REFRESH_MS = 60_000;

const announce = () => window.dispatchEvent(new Event(FRIENDS_CHANGED));

function AddFriend({ onSent }: { onSent: () => void }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => {
    fetchFriendCode()
      .then((r) => setCode(r.code))
      .catch(() => {});
  }, []);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await sendFriendRequest({ username });
      notifications.show({
        message:
          r.status === 'accepted'
            ? `You and ${r.friend.username} are friends now.`
            : `Friend request sent to ${r.friend.username}.`,
      });
      setUsername('');
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(friendLink(code));
      notifications.show({ message: 'Friend link copied.', autoClose: 2000 });
    } catch {
      notifications.show({ message: "Couldn't copy. Select the link and copy it instead.", color: 'red' });
    }
  };

  const replace = async () => {
    try {
      setCode((await newFriendCode()).code);
      notifications.show({ message: 'New friend link made. The old one no longer works.' });
    } catch (err) {
      notifications.show({ message: (err as Error).message, color: 'red' });
    } finally {
      setConfirmNew(false);
    }
  };

  return (
    <Paper p={{ base: 'md', sm: 'lg' }}>
      <Stack gap="lg">
        <form onSubmit={send}>
          <Group gap="sm" align="flex-start" wrap="wrap">
            <TextInput
              label="Add a friend by username"
              placeholder="Their Savepoint username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              error={error}
              autoCapitalize="none"
              style={{ flex: '1 1 240px' }}
              required
            />
            <Button type="submit" loading={busy} leftSection={<IconUserPlus size={16} />} mt={25}>
              Send request
            </Button>
          </Group>
        </form>
        {code && (
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Or share your friend link
            </Text>
            <Text size="xs" c="dimmed">
              Anyone with a Savepoint account who opens it sends you a friend request.
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" className="num" style={{ wordBreak: 'break-all' }}>
                {friendLink(code)}
              </Text>
              <Button size="xs" variant="default" leftSection={<IconCopy size={14} />} onClick={copy}>
                Copy
              </Button>
            </Group>
            <Group gap="xs">
              {confirmNew ? (
                <>
                  <Button size="xs" color="red" variant="light" onClick={() => void replace()}>
                    Make a new link
                  </Button>
                  <Button size="xs" variant="subtle" color="gray" onClick={() => setConfirmNew(false)}>
                    Keep this one
                  </Button>
                  <Text size="xs" c="dimmed">
                    The current link stops working.
                  </Text>
                </>
              ) : (
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconRefresh size={14} />}
                  onClick={() => setConfirmNew(true)}
                >
                  New link
                </Button>
              )}
            </Group>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function RequestRow({ person, incoming, onDone }: { person: FriendCard; incoming: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = (fn: () => Promise<unknown>, message: string) => async () => {
    setBusy(true);
    try {
      await fn();
      notifications.show({ message });
      announce();
      onDone();
    } catch (err) {
      notifications.show({ message: (err as Error).message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
        <FriendAvatar friend={person} size={36} />
        <div style={{ minWidth: 0 }}>
          <Text fw={600} truncate>
            {person.username}
          </Text>
          <Text size="xs" c="dimmed">
            {incoming ? 'Wants to be friends' : 'Waiting for them to accept'}
          </Text>
        </div>
      </Group>
      <Group gap="xs" wrap="nowrap">
        {incoming && (
          <Button
            size="xs"
            loading={busy}
            onClick={act(() => acceptFriend(person.id), `You and ${person.username} are friends now.`)}
          >
            Accept
          </Button>
        )}
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          disabled={busy}
          onClick={act(() => dropRequest(person.id), incoming ? 'Request declined.' : 'Request cancelled.')}
        >
          {incoming ? 'Decline' : 'Cancel'}
        </Button>
      </Group>
    </Group>
  );
}

function FriendRow({ friend }: { friend: Friend }) {
  const online = isOnline(friend.presence);
  return (
    <Link to={`/friends/${friend.id}`} className="friend-row">
      <FriendAvatar friend={friend} online={online} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={700} truncate>
            {friend.username}
          </Text>
          {friend.rank && (
            <Badge variant="light" size="sm" radius="sm" tt="none">
              {friend.rank}
            </Badge>
          )}
        </Group>
        <Text size="sm" c={online ? undefined : 'dimmed'} truncate>
          {describePresence(friend.presence)}
        </Text>
      </div>
    </Link>
  );
}

export function FriendsPage() {
  const [list, setList] = useState<FriendsList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchFriends()
      .then((l) => {
        setList(l);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    // Keep online status fresh while the page is open.
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Online friends first, then the rest; alphabetical within each.
  const friends = [...(list?.friends ?? [])].sort(
    (a, b) => Number(isOnline(b.presence)) - Number(isOnline(a.presence)) || a.username.localeCompare(b.username),
  );

  return (
    <Stack gap={40}>
      <div>
        <Title order={1}>Friends</Title>
        <Text c="dimmed" mt={6} size="lg">
          See who&apos;s online, what they&apos;re playing, and their levels and libraries.
        </Text>
      </div>

      <AddFriend onSent={load} />

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {!!list?.incoming.length && (
        <Stack gap="sm">
          <Title order={2}>Requests</Title>
          <Paper p={{ base: 'md', sm: 'lg' }}>
            <Stack gap="md">
              {list.incoming.map((p) => (
                <RequestRow key={p.id} person={p} incoming onDone={load} />
              ))}
            </Stack>
          </Paper>
        </Stack>
      )}

      <Stack gap="sm">
        <Title order={2}>Your friends{list ? ` (${list.friends.length})` : ''}</Title>
        {list && !friends.length ? (
          <Text c="dimmed">No friends yet. Add someone by username, or share your friend link.</Text>
        ) : (
          <Stack gap={2}>
            {friends.map((f) => (
              <FriendRow key={f.id} friend={f} />
            ))}
          </Stack>
        )}
        <Text size="xs" c="dimmed">
          Online status and the game being played come from Steam, PlayStation and Xbox, for the platforms each friend
          has connected (Steam only shows it when their profile is public).
        </Text>
      </Stack>

      {!!list?.outgoing.length && (
        <Stack gap="sm">
          <Title order={3}>Sent requests</Title>
          <Paper p={{ base: 'md', sm: 'lg' }}>
            <Stack gap="md">
              {list.outgoing.map((p) => (
                <RequestRow key={p.id} person={p} incoming={false} onDone={load} />
              ))}
            </Stack>
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}
