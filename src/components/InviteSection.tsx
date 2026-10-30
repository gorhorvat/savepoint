import { Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconLock, IconRefresh } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { fetchInviteCode, updateInviteCode } from '../lib/api';

/** The invite code for sign-up; only the super admin sees this. */
export function InviteSection() {
  const [code, setCode] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInviteCode()
      .then(setCode)
      .catch((e: Error) => setError(e.message));
  }, []);

  const change = async (next: { code: string } | { generate: true }) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await updateInviteCode(next);
      setCode(saved);
      setEditing(false);
      notifications.show({ message: saved ? 'Invite code changed.' : 'Sign-up is closed.' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code ?? '');
      notifications.show({ message: 'Invite code copied.', autoClose: 2000 });
    } catch {
      notifications.show({ message: "Couldn't copy. Select the code and copy it instead.", color: 'red' });
    }
  };

  return (
    <Paper p={{ base: 'md', sm: 'lg' }}>
      <Stack gap="sm">
        <div>
          <Text fw={600}>Invite code</Text>
          <Text size="sm" c="dimmed">
            Anyone with this code can create an account from the login screen. Only you see it here. Changing it
            doesn&apos;t affect accounts already created.
          </Text>
        </div>
        {code === null && !error ? (
          <Text size="sm" c="dimmed">
            Loading…
          </Text>
        ) : editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void change({ code: draft });
            }}
          >
            <Stack gap="xs">
              <TextInput
                aria-label="New invite code"
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                placeholder="At least 6 characters"
                autoFocus
              />
              <Group gap="xs">
                <Button type="submit" size="xs" loading={busy}>
                  Save code
                </Button>
                <Button size="xs" variant="subtle" color="gray" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </Group>
            </Stack>
          </form>
        ) : (
          <>
            {code ? (
              <Group gap="xs" wrap="nowrap">
                <Text className="num" fw={700} fz="lg" style={{ letterSpacing: '0.04em', wordBreak: 'break-all' }}>
                  {code}
                </Text>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconCopy size={14} />}
                  onClick={copy}
                  style={{ flexShrink: 0 }}
                >
                  Copy
                </Button>
              </Group>
            ) : (
              <Text size="sm">Sign-up is closed: nobody can create an account until you set a code.</Text>
            )}
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                leftSection={<IconRefresh size={14} />}
                loading={busy}
                onClick={() => void change({ generate: true })}
              >
                {code ? 'New random code' : 'Open sign-up with a random code'}
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setDraft(code ?? '');
                  setEditing(true);
                }}
              >
                Type my own
              </Button>
              {code && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconLock size={14} />}
                  onClick={() => void change({ code: '' })}
                >
                  Close sign-up
                </Button>
              )}
            </Group>
          </>
        )}
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
