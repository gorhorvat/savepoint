import { Anchor, Button, Center, Loader, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
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
  signUp,
  signupOpen,
  subscribeSyncStatus,
} from '../lib/serverStorage';
import { useStore } from '../lib/store';
import { Crystal } from './Layout';

function reload() {
  void useStore.persist.rehydrate();
}

function LoginForm() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [canSignUp, setCanSignUp] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';
  const mismatch = signup && repeat.length > 0 && password !== repeat;

  useEffect(() => {
    void signupOpen().then(setCanSignUp);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    const failed = signup ? await signUp(username.trim(), password, code) : await logIn(username, password);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    await resumeAfterLogin();
    reload();
  }

  const switchTo = (next: 'login' | 'signup') => {
    setMode(next);
    setError(null);
    setRepeat('');
  };

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
          {signup && <Text c="dimmed">Create your account</Text>}
        </Stack>
        <TextInput
          label="Username"
          description={signup ? 'Letters, digits, dots, dashes or underscores.' : undefined}
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          required
        />
        <PasswordInput
          label="Password"
          description={signup ? 'At least 8 characters.' : undefined}
          autoComplete={signup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          error={signup ? undefined : error}
          minLength={signup ? 8 : undefined}
          required
        />
        {signup && (
          <>
            <PasswordInput
              label="Password again"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.currentTarget.value)}
              error={mismatch ? "The passwords don't match." : undefined}
              required
            />
            <TextInput
              label="Invite code"
              autoComplete="off"
              autoCapitalize="characters"
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              error={error}
              required
            />
          </>
        )}
        <Button type="submit" loading={busy} disabled={mismatch}>
          {signup ? 'Create account' : 'Log in'}
        </Button>
        {canSignUp && (
          <Text size="sm" c="dimmed" ta="center">
            {signup ? 'Already have an account? ' : 'Have an invite code? '}
            <Anchor component="button" type="button" size="sm" onClick={() => switchTo(signup ? 'login' : 'signup')}>
              {signup ? 'Log in' : 'Create an account'}
            </Anchor>
          </Text>
        )}
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
