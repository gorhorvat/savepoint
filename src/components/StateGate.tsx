import { Anchor, Button, Center, Loader, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandSteam } from '@tabler/icons-react';
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
  completeSteamSignup,
  signUp,
  signupOpen,
  steamPending,
  subscribeSyncStatus,
} from '../lib/serverStorage';
import { useStore } from '../lib/store';
import { Crystal } from './Layout';
import { fetchAccount, importSteam } from '../lib/api';

function reload() {
  void useStore.persist.rehydrate();
}

/** What a return from Steam's login page (?steam=...) means for the login screen. */
const STEAM_MESSAGES: Record<string, string> = {
  failed: "Signing in through Steam didn't work. Try again.",
  closed: "That Steam account isn't linked to a Savepoint account, and sign-up is closed.",
};

/** Removes ?steam=... from the address bar. */
function clearSteamParam() {
  const url = new URL(location.href);
  url.searchParams.delete('steam');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function SteamButton() {
  return (
    <Button
      component="a"
      href="/api/auth/steam/start?intent=login"
      variant="default"
      leftSection={<IconBrandSteam size={18} />}
    >
      Sign in through Steam
    </Button>
  );
}

type Mode = 'login' | 'signup' | 'steam';

function LoginForm() {
  const steamReturn = new URLSearchParams(location.search).get('steam');
  const [mode, setMode] = useState<Mode>(steamReturn === 'signup' ? 'steam' : 'login');
  const [canSignUp, setCanSignUp] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(steamReturn ? (STEAM_MESSAGES[steamReturn] ?? null) : null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';
  const steam = mode === 'steam';
  const mismatch = signup && repeat.length > 0 && password !== repeat;

  useEffect(() => {
    void signupOpen().then(setCanSignUp);
    if (steamReturn !== 'signup') {
      if (steamReturn) clearSteamParam();
      return;
    }
    // Back from Steam with a Steam account that has no Savepoint account yet.
    void steamPending().then((suggested) => {
      if (suggested === null) {
        setMode('login');
        setError('That took too long. Sign in through Steam again.');
        clearSteamParam();
      } else setUsername(suggested);
    });
  }, [steamReturn]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    const failed = steam
      ? await completeSteamSignup(username.trim(), code)
      : signup
        ? await signUp(username.trim(), password, code)
        : await logIn(username, password);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    if (steam) {
      // A fresh start that then imports the Steam library (see StateGate).
      location.replace('/?steam=new');
      return;
    }
    await resumeAfterLogin();
    reload();
  }

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setRepeat('');
    clearSteamParam();
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
          {steam && (
            <Text c="dimmed" ta="center">
              Signed in to Steam. Pick a username and enter your invite code to create your account.
            </Text>
          )}
        </Stack>
        <TextInput
          label="Username"
          description={signup || steam ? 'Letters, digits, dots, dashes or underscores.' : undefined}
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          required
        />
        {!steam && (
          <PasswordInput
            label="Password"
            description={signup ? 'At least 8 characters.' : undefined}
            autoComplete={signup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            error={mode === 'login' ? error : undefined}
            minLength={signup ? 8 : undefined}
            required
          />
        )}
        {signup && (
          <PasswordInput
            label="Password again"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.currentTarget.value)}
            error={mismatch ? "The passwords don't match." : undefined}
            required
          />
        )}
        {(signup || steam) && (
          <TextInput
            label="Invite code"
            autoComplete="off"
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            error={error}
            required
          />
        )}
        <Button type="submit" loading={busy} disabled={mismatch}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </Button>
        {mode === 'login' && <SteamButton />}
        {steam ? (
          <Text size="sm" c="dimmed" ta="center">
            Already have an account? Log in, then link Steam in Profile.{' '}
            <Anchor component="button" type="button" size="sm" onClick={() => switchTo('login')}>
              Log in
            </Anchor>
          </Text>
        ) : (
          canSignUp && (
            <Text size="sm" c="dimmed" ta="center">
              {signup ? 'Already have an account? ' : 'Have an invite code? '}
              <Anchor component="button" type="button" size="sm" onClick={() => switchTo(signup ? 'login' : 'signup')}>
                {signup ? 'Log in' : 'Create an account'}
              </Anchor>
            </Text>
          )
        )}
      </Stack>
    </form>
  );
}

/** Right after an account was created through Steam (?steam=new): import its Steam library. */
async function importNewSteamAccount() {
  if (new URLSearchParams(location.search).get('steam') !== 'new') return;
  clearSteamParam();
  try {
    const { steamId } = await fetchAccount();
    if (!steamId) return;
    const profile = `https://steamcommunity.com/profiles/${steamId}/`;
    const res = await importSteam(profile);
    const r = useStore.getState().importLibrary('steam', 'steam', res.games, profile);
    notifications.show({ title: 'Welcome to Savepoint', message: `Imported ${r.added} games from Steam.` });
  } catch (e) {
    notifications.show({
      title: 'Welcome to Savepoint',
      message: `Your Steam library couldn't be imported yet (${(e as Error).message}). Try again in Settings, Platforms.`,
    });
  }
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

  useEffect(() => {
    if (status === 'ready') void importNewSteamAccount();
  }, [status]);

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
