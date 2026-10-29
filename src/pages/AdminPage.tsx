import {
  ActionIcon,
  Badge,
  Button,
  Code,
  CopyButton,
  Divider,
  Group,
  Menu,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBrandKick,
  IconBrandTwitch,
  IconCheck,
  IconCopy,
  IconDots,
  IconKey,
  IconLock,
  IconLockOpen,
  IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlatformIcon } from '../components/PlatformBadge';
import { PLATFORM_BY_ID } from '../data/platforms';
import {
  createResetLink,
  deleteUser,
  fetchAdminUsers,
  fetchStatus,
  setUserDisabled,
  type AdminUser,
} from '../lib/api';
import { formatLastPlayed } from '../lib/format';
import type { PlatformId } from '../types';

const PLATFORM_IDS = new Set(['steam', 'playstation', 'xbox']);
// Streaming services a user can connect; they sit apart from the game platforms.
const STREAMING: Record<string, { name: string; Icon: typeof IconBrandTwitch; color: string }> = {
  twitch: { name: 'Twitch', Icon: IconBrandTwitch, color: '#9146ff' },
  kick: { name: 'Kick', Icon: IconBrandKick, color: '#53fc18' },
};
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function Platforms({ list }: { list: string[] }) {
  if (!list.length) return <Text size="sm" c="dimmed">None</Text>;
  const games = list.filter((p) => PLATFORM_IDS.has(p));
  const streaming = list.filter((p) => p in STREAMING);
  const other = list.filter((p) => !PLATFORM_IDS.has(p) && !(p in STREAMING));
  return (
    <Group gap={6} wrap="nowrap">
      {games.map((p) => (
        <Tooltip key={p} label={PLATFORM_BY_ID[p as PlatformId].name} withArrow>
          <span style={{ display: 'inline-flex' }}>
            <PlatformIcon platform={p as PlatformId} size={14} />
          </span>
        </Tooltip>
      ))}
      {games.length > 0 && streaming.length > 0 && <Divider orientation="vertical" h={14} mx={2} />}
      {streaming.map((p) => {
        const { name, Icon, color } = STREAMING[p];
        return (
          <Tooltip key={p} label={name} withArrow>
            <Icon size={16} stroke={1.8} color={color} style={{ flexShrink: 0 }} aria-label={name} />
          </Tooltip>
        );
      })}
      {other.map((p) => (
        <Text key={p} size="xs" c="dimmed" tt="capitalize">
          {p}
        </Text>
      ))}
    </Group>
  );
}

/** The one-time reset link for an account, to copy and send. */
function ResetModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const make = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      setLink(await createResetLink(user.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={!!user}
      onClose={() => {
        setLink(null);
        setError(null);
        onClose();
      }}
      title={user ? `Reset ${user.username}'s password` : ''}
    >
      {user && (
        <Stack gap="sm">
          {!link ? (
            <>
              <Text size="sm">
                Savepoint can&apos;t send email, so this makes a link you send {user.username} yourself. It works once,
                for 24 hours. Their current password keeps working until they use it; then every device they&apos;re
                logged in on is logged out.
              </Text>
              {user.resetUntil && (
                <Text size="sm" c="dimmed">
                  A link from earlier still works until {new Date(user.resetUntil).toLocaleString()}. A new one replaces
                  it.
                </Text>
              )}
              <Button w="fit-content" loading={busy} leftSection={<IconKey size={16} />} onClick={() => void make()}>
                Make a reset link
              </Button>
            </>
          ) : (
            <>
              <Text size="sm">Send this to {user.username}:</Text>
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Code block style={{ flex: 1, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                  {link.url}
                </Code>
                <CopyButton value={link.url}>
                  {({ copied, copy }) => (
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      onClick={copy}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  )}
                </CopyButton>
              </Group>
              <Text size="xs" c="dimmed">
                Works until {new Date(link.expiresAt).toLocaleString()}. You won&apos;t see it again after closing this.
              </Text>
            </>
          )}
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  );
}

/** Deleting asks for the username, since it can't be undone. */
function DeleteModal({
  user,
  onClose,
  onDeleted,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await deleteUser(user.id);
      notifications.show({ message: `${user.username} was deleted.` });
      setTyped('');
      onDeleted();
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      opened={!!user}
      onClose={() => {
        setTyped('');
        onClose();
      }}
      title={user ? `Delete ${user.username}?` : ''}
    >
      {user && (
        <Stack gap="sm">
          <Text size="sm">
            This deletes the account and everything in it: library, play history, wishlist, physical games, friends,
            gifts and connections. It can&apos;t be undone. To keep the data but stop them logging in, disable the
            account instead.
          </Text>
          <TextInput
            label={`Type ${user.username} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
            autoComplete="off"
          />
          <Group justify="flex-end">
            <Button
              color="red"
              loading={busy}
              disabled={typed.trim().toLowerCase() !== user.username.toLowerCase()}
              onClick={() => void remove()}
            >
              Delete account
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** Super admin: every account, with disabling, deleting and password reset links. */
export function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  const load = useCallback(() => {
    fetchAdminUsers()
      .then((u) => {
        setUsers(u);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    fetchStatus()
      .then((s) => {
        setAllowed(!!s.superAdmin);
        if (s.superAdmin) load();
      })
      .catch(() => setAllowed(false));
  }, [load]);

  const toggleDisabled = async (u: AdminUser) => {
    try {
      await setUserDisabled(u.id, !u.disabled);
      notifications.show({
        message: u.disabled ? `${u.username} can log in again.` : `${u.username} is disabled and logged out.`,
      });
      load();
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    }
  };

  const shown = useMemo(
    () => (users ?? []).filter((u) => u.username.toLowerCase().includes(query.trim().toLowerCase())),
    [users, query],
  );
  const active = (users ?? []).filter((u) => !u.disabled).length;

  if (allowed === false) {
    return (
      <Stack>
        <Title order={1}>Users</Title>
        <Text c="dimmed">Only the super admin can manage accounts.</Text>
        <Button component={Link} to="/" variant="light" w="fit-content">
          Home
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>Users</Title>
        <Text c="dimmed" mt={6} size="lg">
          {users
            ? `${users.length} ${users.length === 1 ? 'account' : 'accounts'}, ${active} active.`
            : 'Every Savepoint account.'}{' '}
          The invite code is in{' '}
          <Text component={Link} to="/profile" span inherit c="var(--mantine-primary-color-filled)">
            Profile
          </Text>
          .
        </Text>
      </div>
      <TextInput
        placeholder="Filter by username"
        aria-label="Filter by username"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        maw={320}
      />
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {users && (
        <Paper p={0} style={{ overflowX: 'auto' }}>
          <Table verticalSpacing="sm" horizontalSpacing="md" miw={760} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Account</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Last active</Table.Th>
                <Table.Th>Platforms</Table.Th>
                <Table.Th ta="right">Games</Table.Th>
                <Table.Th ta="right">Friends</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((u) => (
                <Table.Tr key={u.id} style={{ opacity: u.disabled ? 0.6 : 1 }}>
                  <Table.Td>
                    <Group gap={8} wrap="nowrap">
                      <Text fw={600}>{u.username}</Text>
                      {u.superAdmin && (
                        <Badge size="xs" variant="light" radius="xs">
                          Super admin
                        </Badge>
                      )}
                      {u.disabled && (
                        <Badge size="xs" color="red" variant="light" radius="xs">
                          Disabled
                        </Badge>
                      )}
                      {u.resetUntil && (
                        <Tooltip label={`Reset link open until ${new Date(u.resetUntil).toLocaleString()}`}>
                          <Badge size="xs" color="gray" variant="outline" radius="xs">
                            Reset pending
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {[u.level != null && `Level ${u.level}`, !u.hasPassword && 'Steam login only']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{day(u.createdAt)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={u.lastSeenAt ? undefined : 'dimmed'}>
                      {u.lastSeenAt ? formatLastPlayed(u.lastSeenAt) : 'Not yet'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Platforms list={u.platforms} />
                  </Table.Td>
                  <Table.Td ta="right" className="num">
                    {u.games}
                  </Table.Td>
                  <Table.Td ta="right" className="num">
                    {u.friends}
                  </Table.Td>
                  <Table.Td ta="right">
                    {!u.superAdmin && (
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${u.username}`}>
                            <IconDots size={18} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconKey size={15} />} onClick={() => setResetting(u)}>
                            Password reset link
                          </Menu.Item>
                          <Menu.Item
                            leftSection={u.disabled ? <IconLockOpen size={15} /> : <IconLock size={15} />}
                            onClick={() => void toggleDisabled(u)}
                          >
                            {u.disabled ? 'Enable account' : 'Disable account'}
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item color="red" leftSection={<IconTrash size={15} />} onClick={() => setDeleting(u)}>
                            Delete account
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {!shown.length && (
            <Text c="dimmed" p="md">
              No accounts match.
            </Text>
          )}
        </Paper>
      )}
      <Text size="xs" c="dimmed">
        Disabling logs the account out within a minute and stops it logging in; its data stays. &quot;Last active&quot;
        updates at most every ten minutes.
      </Text>
      <ResetModal user={resetting} onClose={() => setResetting(null)} />
      <DeleteModal
        user={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          load();
        }}
      />
    </Stack>
  );
}
