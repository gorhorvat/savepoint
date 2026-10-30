import {
  Anchor,
  Button,
  Center,
  Loader,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
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
  linkSteamToAccount,
  signUp,
  signupOpen,
  steamPending,
  subscribeSyncStatus,
} from '../lib/serverStorage';
import { useStore } from '../lib/store';
import { Crystal } from './Layout';
import { importLinkedSteamOnce } from '../lib/autoSync';
import { completePasswordReset, fetchResetLink } from '../lib/api';

/** /reset/<token>: a one-time link from the admin to set a new password. Works logged out. */
function ResetPassword({ token }: { token: string }) {
  const [username, setUsername] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = repeat.length > 0 && password !== repeat;

  useEffect(() => {
    fetchResetLink(token)
      .then((r) => setUsername(r.username))
      .catch((e: Error) => setGone(e.message));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await completePasswordReset(token, password);
      location.replace('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Center className="gate-screen" p="md">
      <Stack gap="lg" w="100%" maw={360}>
        <Stack gap={6} align="center">
          <Crystal size={36} />
          <Title order={2}>Set a new password</Title>
        </Stack>
        {gone ? (
          <Stack gap="sm">
            <Text size="sm" c="dimmed" ta="center">
              {gone}
            </Text>
            <Button component="a" href="/" variant="light">
              Go to the login page
            </Button>
          </Stack>
        ) : !username ? (
          <Center>
            <Loader />
          </Center>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <Stack gap="sm">
              <Text size="sm" ta="center">
                For <b>{username}</b>. Devices logged in with the old password are logged out.
              </Text>
              <PasswordInput
                label="New password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                autoComplete="new-password"
                required
                autoFocus
              />
              <PasswordInput
                label="Repeat it"
                value={repeat}
                onChange={(e) => setRepeat(e.currentTarget.value)}
                autoComplete="new-password"
                error={mismatch ? "The passwords don't match." : undefined}
                required
              />
              {error && (
                <Text size="sm" c="red">
                  {error}
                </Text>
              )}
              <Button type="submit" loading={busy} disabled={mismatch || !password}>
                Save and log in
              </Button>
            </Stack>
          </form>
        )}
      </Stack>
    </Center>
  );
}

function reload() {
  void useStore.persist.rehydrate();
}

/** What a return from Steam's login page (?steam=...) means for the login screen. */
const STEAM_MESSAGES: Record<string, string> = {
  failed: "Signing in through Steam didn't work. Try again.",
  disabled: 'This account is disabled. Ask the Savepoint admin.',
};

/** Removes ?steam=... from the address bar. */
function clearSteamParam() {
  const url = new URL(location.href);
  url.searchParams.delete('steam');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

function SteamButton() {
  return (
    <Button component="a" href="/api/auth/steam/start" variant="default" leftSection={<IconBrandSteam size={18} />}>
      Sign in through Steam
    </Button>
  );
}

/** steamNew / steamLink: back from Steam with a Steam account that isn't linked yet. */
type Mode = 'login' | 'signup' | 'steamNew' | 'steamLink';

function LoginForm() {
  const steamReturn = new URLSearchParams(location.search).get('steam');
  const [mode, setMode] = useState<Mode>(steamReturn === 'signup' ? 'steamNew' : 'login');
  const [canSignUp, setCanSignUp] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(steamReturn ? (STEAM_MESSAGES[steamReturn] ?? null) : null);
  const [busy, setBusy] = useState(false);
  const steam = mode === 'steamNew' || mode === 'steamLink';
  const newAccount = mode === 'signup' || mode === 'steamNew';
  const needsPassword = mode !== 'steamNew';
  const mismatch = mode === 'signup' && repeat.length > 0 && password !== repeat;
  const [suggested, setSuggested] = useState('');
  const [steamSignupOpen, setSteamSignupOpen] = useState(false);

  useEffect(() => {
    void signupOpen().then(setCanSignUp);
    if (steamReturn !== 'signup') {
      if (steamReturn) clearSteamParam();
      return;
    }
    void steamPending().then((pending) => {
      if (pending === null) {
        setMode('login');
        setError('That took too long. Sign in through Steam again.');
        clearSteamParam();
        return;
      }
      setSuggested(pending.username);
      setSteamSignupOpen(pending.signupOpen);
      setUsername(pending.username);
      // Sign-up closed: the only way forward is linking an existing account.
      if (!pending.signupOpen) setMode('steamLink');
    });
  }, [steamReturn]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    const name = username.trim();
    const failed =
      mode === 'steamNew'
        ? await completeSteamSignup(name, code)
        : mode === 'steamLink'
          ? await linkSteamToAccount(name, password)
          : mode === 'signup'
            ? await signUp(name, password, code)
            : await logIn(username, password);
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    if (steam) {
      // A fresh start; a new account then imports its Steam library (see StateGate).
      location.replace(mode === 'steamNew' ? '/?steam=new' : '/');
      return;
    }
    await resumeAfterLogin();
    reload();
  }

  // Show the error under the field it's about; anything else goes under the button.
  const errorOn = newAccount && error ? errorField(error) : 'password';
  const fieldError = (f: ErrorField) => (errorOn === f ? error : undefined);

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setRepeat('');
    setPassword('');
    // The Steam name only makes sense as the suggestion for a new account.
    if (next === 'steamNew') setUsername(suggested);
    else if (mode === 'steamNew' && username === suggested) setUsername('');
    if (!(next === 'steamNew' || next === 'steamLink')) clearSteamParam();
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
          {mode === 'signup' && <Text c="dimmed">Create your account</Text>}
          {steam && (
            <Text c="dimmed" ta="center">
              Signed in to Steam. This Steam account isn&apos;t linked to Savepoint yet.
            </Text>
          )}
        </Stack>
        {steam && steamSignupOpen && (
          <SegmentedControl
            fullWidth
            value={mode}
            onChange={(v) => switchTo(v as Mode)}
            data={[
              { value: 'steamNew', label: 'New to Savepoint' },
              { value: 'steamLink', label: 'I already have an account' },
            ]}
          />
        )}
        {mode === 'steamLink' && (
          <Text size="sm" c="dimmed">
            Log in once to link this Steam account. After that, Sign in through Steam is enough.
          </Text>
        )}
        <TextInput
          label="Username"
          description={
            newAccount ? 'Letters without accents, digits, dots, dashes or underscores. No spaces.' : undefined
          }
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          error={fieldError('username')}
          required
        />
        {needsPassword && (
          <PasswordInput
            label="Password"
            description={mode === 'signup' ? 'At least 8 characters.' : undefined}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            error={fieldError('password')}
            minLength={mode === 'signup' ? 8 : undefined}
            required
          />
        )}
        {mode === 'signup' && (
          <PasswordInput
            label="Password again"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.currentTarget.value)}
            error={mismatch ? "The passwords don't match." : undefined}
            required
          />
        )}
        {newAccount && (
          <TextInput
            label="Invite code"
            autoComplete="off"
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            error={fieldError('code')}
            required
          />
        )}
        {error && errorOn === 'other' && (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        )}
        <Button type="submit" loading={busy} disabled={mismatch}>
          {mode === 'login' ? 'Log in' : mode === 'steamLink' ? 'Log in and link Steam' : 'Create account'}
        </Button>
        {mode === 'login' && <SteamButton />}
        {steam ? (
          <Text size="sm" c="dimmed" ta="center">
            <Anchor component="button" type="button" size="sm" onClick={() => switchTo('login')}>
              Back to login
            </Anchor>
          </Text>
        ) : (
          canSignUp && (
            <Text size="sm" c="dimmed" ta="center">
              {mode === 'signup' ? 'Already have an account? ' : 'Have an invite code? '}
              <Anchor
                component="button"
                type="button"
                size="sm"
                onClick={() => switchTo(mode === 'signup' ? 'login' : 'signup')}
              >
                {mode === 'signup' ? 'Log in' : 'Create an account'}
              </Anchor>
            </Text>
          )
        )}
      </Stack>
    </form>
  );
}

type ErrorField = 'username' | 'password' | 'code' | 'other';

/** Which sign-up field a server message is about. */
function errorField(message: string): ErrorField {
  if (/invite code|sign-up is closed/i.test(message)) return 'code';
  if (/username|letters/i.test(message)) return 'username';
  if (/password|at least \d+ characters/i.test(message)) return 'password';
  return 'other';
}

/** Right after an account was created through Steam (?steam=new): import its Steam library. */
async function importNewSteamAccount() {
  if (new URLSearchParams(location.search).get('steam') !== 'new') return;
  clearSteamParam();
  try {
    const added = await importLinkedSteamOnce();
    notifications.show({ title: 'Welcome to Savepoint', message: `Imported ${added} games from Steam.` });
  } catch (e) {
    notifications.show({
      title: 'Welcome to Savepoint',
      message: `Your Steam library couldn't be imported yet (${(e as Error).message}). Savepoint tries again the next time you open it, or import it in Settings, Platforms.`,
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
  const resetToken = location.pathname.match(/^\/reset\/([\w-]+)$/)?.[1];
  if (resetToken) return <ResetPassword token={resetToken} />;
  return <Gate>{children}</Gate>;
}

function Gate({ children }: { children: ReactNode }) {
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
    <Center className="gate-screen" p="md">
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
