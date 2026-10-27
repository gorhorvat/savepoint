import { Button, Center, Loader, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import {
  flushNow,
  getLoadError,
  getSyncStatus,
  hasPendingSave,
  logIn,
  markLoading,
  resumeAfterLogin,
  serverHasNewer,
  setSyncHandlers,
  subscribeSyncStatus,
} from '../lib/serverStorage';
import { useStore } from '../lib/store';
import { Crystal } from './Layout';

function reload() {
  void useStore.persist.rehydrate();
}

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const failed = await logIn(username, password);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    await resumeAfterLogin();
    reload();
  }

  return (
    <form onSubmit={submit} style={{ width: '100%', maxWidth: 360 }}>
      <Stack gap="md">
        <Stack align="center" gap={6} mb="lg">
          <div className="login-crystal">
            <Crystal size={72} />
          </div>
          <Text className="display" fz={40} lh={1}>
            savepoint
          </Text>
        </Stack>
        <TextInput
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          required
        />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          error={error}
          required
        />
        <Button type="submit" loading={busy}>
          Log in
        </Button>
      </Stack>
    </form>
  );
}

/**
 * Holds the app back until you're logged in and the saved library has loaded
 * from the server, so nothing (background jobs included) runs on, or saves,
 * the sample defaults. Also keeps this device in step with changes made on
 * another one.
 */
export function StateGate({ children }: { children: ReactNode }) {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);

  useEffect(() => {
    let warned = false;
    setSyncHandlers({
      conflict: () => {
        notifications.show({
          id: 'state-conflict',
          message:
            'Your library was changed on another device, so it was reloaded. Redo your last change if it is missing.',
        });
        reload();
      },
      saveFailed: () => {
        if (warned) return;
        warned = true;
        notifications.show({
          id: 'state-save',
          message: "Couldn't reach the Savepoint server to save. Retrying in the background; keep this tab open.",
        });
      },
    });

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void flushNow();
      } else if (getSyncStatus() === 'ready' && !hasPendingSave()) {
        serverHasNewer()
          .then((newer) => newer && !hasPendingSave() && reload())
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (status === 'ready') return children;

  return (
    <Center mih="100vh" p="md">
      {status === 'loading' && <Loader />}
      {status === 'login' && <LoginForm />}
      {status === 'offline' && (
        <Stack align="center" gap="sm" maw={420} ta="center">
          <Title order={3}>Can't load your library</Title>
          <Text c="dimmed" size="sm">
            {getLoadError() ?? "The Savepoint server isn't answering. Start it, then try again."}
          </Text>
          <Button
            onClick={() => {
              markLoading();
              reload();
            }}
          >
            Try again
          </Button>
        </Stack>
      )}
    </Center>
  );
}
