import {
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  Group,
  List,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandSteam, IconDownload, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GameSearch } from '../components/GameSearch';
import { ListImport } from '../components/ListImport';
import { PlatformIcon } from '../components/PlatformBadge';
import { PLATFORM_BY_ID } from '../data/platforms';
import { applyXboxAchievements, runAchievementsSync } from '../lib/achievements';
import {
  connectPsn,
  connectXbox,
  disconnectPlatform,
  fetchAccount,
  importPsn,
  importSteam,
  importXbox,
  steamProfileUrl,
  unlinkSteam,
  useServerStatus,
  type Account,
  type FoundGame,
  type ServerStatus,
} from '../lib/api';
import { formatLastPlayed } from '../lib/format';
import { useStore } from '../lib/store';
import type { PlatformId } from '../types';

function PlatformPanel({ platform, method, children }: { platform: PlatformId; method: string; children: ReactNode }) {
  const conn = useStore((s) => s.connections[platform]);
  const count = useStore((s) => s.entries.filter((e) => e.platform === platform && e.source !== 'demo').length);
  return (
    <Paper p={{ base: 'md', sm: 'lg' }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap={10} wrap="nowrap">
          <PlatformIcon platform={platform} size={22} />
          <Title order={3} fz="lg">
            {PLATFORM_BY_ID[platform].name}
          </Title>
        </Group>
        <Badge variant="outline" color="gray" radius="xs" tt="none" style={{ flexShrink: 0 }}>
          {method}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed" mt={6}>
        {conn
          ? `${conn.count} games imported, synced ${formatLastPlayed(conn.lastSync ?? null)}`
          : count
            ? `${count} games added`
            : 'Nothing imported yet'}
      </Text>
      <Stack gap="sm" mt="md">
        {children}
      </Stack>
    </Paper>
  );
}

function ServerHint({ status, envVar }: { status: ServerStatus | null; envVar?: string }) {
  if (!status) return null;
  if (!status.online) {
    return (
      <Alert variant="light" color="gray" radius="md">
        The Savepoint server isn't running. Start the app with <Code>npm run dev</Code> to import.
      </Alert>
    );
  }
  if (!envVar) return null;
  return (
    <Alert variant="light" color="gray" radius="md">
      Add <Code>{envVar}</Code> to the <Code>.env</Code> file, then restart the server.
    </Alert>
  );
}

const STEAM_CONNECT_ERRORS: Record<string, string> = {
  taken: 'That Steam account is already connected to another Savepoint account.',
  failed: "Connecting Steam didn't work. Try again.",
};

function SteamPanel({ status }: { status: ServerStatus | null }) {
  const conn = useStore((s) => s.connections.steam);
  const importLibrary = useStore((s) => s.importLibrary);
  const disconnect = useStore((s) => s.disconnect);
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  // Back from Steam's login page after Connect Steam: ?steam=connected|taken|failed|cancelled.
  const [steamReturn] = useState(() => new URLSearchParams(location.search).get('steam'));
  const importedOnReturn = useRef(false); // Development mode runs effects twice.
  const [error, setError] = useState<string | null>(() => STEAM_CONNECT_ERRORS[steamReturn ?? ''] ?? null);

  const [unlinking, setUnlinking] = useState(false);
  const unlink = async () => {
    setUnlinking(true);
    setError(null);
    const problem = await unlinkSteam();
    setUnlinking(false);
    if (problem) return setError(problem);
    notifications.show({ message: 'Steam unlinked.' });
    setAccount(await fetchAccount().catch(() => null));
  };

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await importSteam();
      const r = importLibrary('steam', 'steam', res.games, steamProfileUrl(res.steamId));
      notifications.show({
        title: 'Steam imported',
        message: `${r.added} played games.${r.removedSample ? ' The sample library was removed.' : ''}`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [importLibrary]);

  useEffect(() => {
    if (steamReturn) {
      const url = new URL(location.href);
      url.searchParams.delete('steam');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    fetchAccount()
      .then((account) => {
        setAccount(account);
        // Just connected: import straight away.
        if (steamReturn === 'connected' && account.steamId && !importedOnReturn.current) {
          importedOnReturn.current = true;
          notifications.show({ message: 'Steam connected. Importing your games…' });
          void run();
        }
      })
      .catch(() => {});
  }, [steamReturn, run]);

  return (
    <PlatformPanel platform="steam" method="Steam Web API">
      {status && !status.steam ? (
        <ServerHint status={status} envVar="STEAM_API_KEY" />
      ) : account === null ? null : !account.steamId ? (
        <>
          <Text size="sm">
            Connect through Steam&apos;s own login page. Savepoint then imports your games and play time, and you can
            log in with Steam too. Your Steam profile&apos;s Game details must be public.
          </Text>
          <Button
            component="a"
            href="/api/auth/steam/start?intent=connect"
            w="fit-content"
            leftSection={<IconBrandSteam size={18} />}
          >
            Connect Steam
          </Button>
        </>
      ) : (
        <>
          <Text size="sm">
            Connected to{' '}
            <Anchor href={steamProfileUrl(account.steamId)} target="_blank" rel="noopener noreferrer">
              your Steam account
            </Anchor>
            . Game details must be public in Steam&apos;s privacy settings.{' '}
            {account.hasPassword
              ? 'You can log in with Steam or with your username and password.'
              : 'You log in with Steam.'}
          </Text>
          <Group gap="sm">
            <Button
              onClick={run}
              loading={busy}
              leftSection={conn ? <IconRefresh size={18} /> : <IconDownload size={18} />}
            >
              {conn ? 'Sync again' : 'Import from Steam'}
            </Button>
            {conn && (
              <Button variant="subtle" color="gray" onClick={() => disconnect('steam')}>
                Remove imported games
              </Button>
            )}
            <Button
              variant="subtle"
              color="gray"
              loading={unlinking}
              disabled={!account.hasPassword}
              onClick={() => void unlink()}
            >
              Unlink Steam
            </Button>
          </Group>
          {!account.hasPassword && (
            <Text size="xs" c="dimmed">
              To unlink Steam, first set a password in{' '}
              <Anchor component={Link} to="/profile" inherit>
                Profile
              </Anchor>
              , so you can still log in.
            </Text>
          )}
        </>
      )}
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
    </PlatformPanel>
  );
}

/** The steps, a field for the key and Connect, for a platform that isn't connected yet. */
function ConnectForm({
  label,
  placeholder,
  steps,
  note,
  onConnect,
}: {
  label: string;
  placeholder: string;
  steps: ReactNode[];
  note: string;
  onConnect: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConnect(value);
      setValue('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <List size="sm" type="ordered" spacing={4}>
          {steps.map((step, i) => (
            <List.Item key={i}>{step}</List.Item>
          ))}
        </List>
        <PasswordInput
          label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          error={error}
          autoComplete="off"
          required
        />
        <Text size="xs" c="dimmed">
          {note}
        </Text>
        <Button type="submit" loading={busy} w="fit-content">
          Connect
        </Button>
      </Stack>
    </form>
  );
}

const SONY_SIGN_IN = 'https://www.playstation.com/';
const SONY_TOKEN_PAGE = 'https://ca.account.sony.com/api/v1/ssocookie';

/** The NPSSO token in whatever was copied: the whole {"npsso":"…"} page, or just the value. */
function findNpsso(text: string): string | null {
  const t = text.trim();
  return /"npsso"\s*:\s*"([\w-]{20,200})"/.exec(t)?.[1] ?? (/^[\w-]{40,200}$/.test(t) ? t : null);
}

/**
 * Connecting PlayStation in as few steps as a website allows: Sony doesn't let
 * other sites sign in for you or read its pages, so the token has to be copied
 * once. Savepoint opens the right page, then reads the copied page from the
 * clipboard (by a click, or by itself on coming back when the browser allows it).
 */
function PsnConnect({ onConnect }: { onConnect: (npsso: string) => Promise<void> }) {
  const [step, setStep] = useState<'start' | 'copy'>('start');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const connect = useCallback(
    async (text: string) => {
      const npsso = findNpsso(text);
      if (!npsso) {
        setError('No token in what was copied. On Sony\u2019s page, select everything (Ctrl+A) and copy it (Ctrl+C).');
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await onConnect(npsso);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onConnect],
  );

  const fromClipboard = async () => {
    try {
      await connect(await navigator.clipboard.readText());
    } catch {
      setError('The browser didn\u2019t let Savepoint read the clipboard. Paste it into the box below instead.');
    }
  };

  // Coming back from Sony's page with the token copied: connect without a click
  // when the browser already allows reading the clipboard.
  useEffect(() => {
    if (step !== 'copy') return;
    const onFocus = async () => {
      try {
        const p = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
        if (p.state !== 'granted') return;
        const text = await navigator.clipboard.readText();
        if (findNpsso(text)) await connect(text);
      } catch {
        // Not supported here (Firefox, Safari): the button does it.
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [step, connect]);

  const note = (
    <Text size="xs" c="dimmed">
      The token works like a sign-in to your PlayStation account. Savepoint keeps it encrypted, only reads your games
      and trophies with it, and never shows it again. Sony lets it last about two months; then connect again.
    </Text>
  );

  if (step === 'start') {
    return (
      <Stack gap="sm">
        <Text size="sm">
          Sign in to PlayStation in this browser, then Savepoint opens the page with your sign-in token for you to copy.
        </Text>
        <Group gap="sm">
          <Button component="a" href={SONY_SIGN_IN} target="_blank" rel="noopener noreferrer" variant="default">
            1. Sign in to PlayStation
          </Button>
          <Button
            component="a"
            href={SONY_TOKEN_PAGE}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setStep('copy')}
          >
            2. Get my token
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          Already signed in on playstation.com? Go straight to step 2.
        </Text>
        {note}
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm">
        On Sony&apos;s page, select everything and copy it: <Code>Ctrl+A</Code> then <Code>Ctrl+C</Code> (on a Mac{' '}
        <Code>⌘A</Code> <Code>⌘C</Code>; on a phone, Select all and Copy). Then come back here.
      </Text>
      <Text size="xs" c="dimmed">
        Sony&apos;s page shows <Code>{'{"npsso":"…"}'}</Code>. If it shows an error instead, you&apos;re not signed in
        yet:{' '}
        <Anchor href={SONY_SIGN_IN} target="_blank" rel="noopener noreferrer" inherit>
          sign in to PlayStation
        </Anchor>{' '}
        and open{' '}
        <Anchor href={SONY_TOKEN_PAGE} target="_blank" rel="noopener noreferrer" inherit>
          the token page
        </Anchor>{' '}
        again.
      </Text>
      <Group gap="sm">
        <Button onClick={() => void fromClipboard()} loading={busy}>
          Connect with what I copied
        </Button>
        <Button variant="subtle" color="gray" onClick={() => setStep('start')} disabled={busy}>
          Back
        </Button>
      </Group>
      <PasswordInput
        label="Or paste it here"
        placeholder="Paste Sony's page or the npsso value"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (findNpsso(text)) {
            e.preventDefault();
            void connect(text);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void connect(value);
        }}
        error={error}
        autoComplete="off"
      />
      {note}
    </Stack>
  );
}

const external = (href: string, text: string) => (
  <Anchor href={href} target="_blank" rel="noopener noreferrer">
    {text}
  </Anchor>
);

/** Import button, Disconnect, and any error, once a platform is connected. */
function ConnectedControls({
  platformName,
  account,
  synced,
  importLabel,
  onImport,
  onDisconnect,
}: {
  platformName: string;
  account: string | null | undefined;
  synced: boolean;
  importLabel: string;
  onImport: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<'import' | 'disconnect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = (which: 'import' | 'disconnect', fn: () => Promise<void>) => async () => {
    setBusy(which);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Text size="sm">{account ? `Connected as ${account}.` : `Connected to ${platformName}.`}</Text>
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      <Group gap="sm">
        <Button
          onClick={act('import', onImport)}
          loading={busy === 'import'}
          leftSection={synced ? <IconRefresh size={18} /> : <IconDownload size={18} />}
        >
          {synced ? 'Sync again' : importLabel}
        </Button>
        <Button variant="subtle" color="gray" loading={busy === 'disconnect'} onClick={act('disconnect', onDisconnect)}>
          Disconnect
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Disconnect removes the connection and the games imported from it.
      </Text>
    </>
  );
}

function PsnPanel({ status, refresh }: { status: ServerStatus | null; refresh: () => void }) {
  const conn = useStore((s) => s.connections.playstation);
  const importLibrary = useStore((s) => s.importLibrary);
  const disconnect = useStore((s) => s.disconnect);

  const run = async () => {
    const res = await importPsn();
    const r = importLibrary('playstation', 'psn', res.games);
    notifications.show({
      title: 'PlayStation imported',
      message: `${r.added} played games.${r.removedSample ? ' The sample library was removed.' : ''}`,
    });
    // A manual sync refreshes trophies (and their grades) straight away.
    void runAchievementsSync({ forcePsn: true });
    refresh(); // Picks up the PlayStation name, if it wasn't known yet.
  };

  return (
    <PlatformPanel platform="playstation" method="PSN, unofficial">
      {!status?.online ? (
        <ServerHint status={status} />
      ) : status.psn ? (
        <ConnectedControls
          platformName="PlayStation"
          account={status.psnAccount}
          synced={!!conn}
          importLabel="Import from PlayStation"
          onImport={run}
          onDisconnect={async () => {
            await disconnectPlatform('playstation');
            disconnect('playstation');
            refresh();
          }}
        />
      ) : (
        <PsnConnect
          onConnect={async (npsso) => {
            await connectPsn(npsso);
            refresh();
            await run();
          }}
        />
      )}
    </PlatformPanel>
  );
}

function XboxPanel({ status, refresh }: { status: ServerStatus | null; refresh: () => void }) {
  const conn = useStore((s) => s.connections.xbox);
  const importLibrary = useStore((s) => s.importLibrary);
  const disconnect = useStore((s) => s.disconnect);

  const run = async () => {
    const res = await importXbox();
    const r = importLibrary('xbox', 'xbox', res.games);
    applyXboxAchievements(res.games);
    notifications.show({ title: 'Xbox imported', message: `${r.added} games.` });
  };

  return (
    <PlatformPanel platform="xbox" method="OpenXBL, unofficial">
      {!status?.online ? (
        <ServerHint status={status} />
      ) : status.xbox ? (
        <ConnectedControls
          platformName="Xbox"
          account={status.xboxAccount}
          synced={!!conn}
          importLabel="Import from Xbox"
          onImport={run}
          onDisconnect={async () => {
            await disconnectPlatform('xbox');
            disconnect('xbox');
            refresh();
          }}
        />
      ) : (
        <ConnectForm
          label="OpenXBL API key"
          placeholder="Paste your API key"
          steps={[
            <>Go to {external('https://xbl.io', 'xbl.io')} and sign in with the Microsoft account you use on Xbox.</>,
            <>In your profile there, create an API key (the free plan is enough).</>,
            <>Copy the key and paste it here.</>,
          ]}
          note="Microsoft has no public way for apps to read your games, so this goes through OpenXBL. The key only reads your own Xbox account. Savepoint keeps it encrypted and never shows it again. Xbox only shares play time for some games."
          onConnect={async (key) => {
            await connectXbox(key);
            refresh();
            await run();
          }}
        />
      )}
    </PlatformPanel>
  );
}

function ManualPanel({ platform, why, where }: { platform: PlatformId; why: string; where: string }) {
  const add = useStore((s) => s.addManualEntry);
  const saveFound = useStore((s) => s.saveFound);
  const [picked, setPicked] = useState<{ title: string; found?: FoundGame } | null>(null);
  const [typing, setTyping] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [hours, setHours] = useState<number | string>('');
  const [date, setDate] = useState('');
  const name = PLATFORM_BY_ID[platform].name;

  const save = () => {
    if (!picked?.title.trim()) return;
    add({
      // Search results become a saved game (with cover, genres, prices);
      // typed titles are matched to a game you already have or saved as a new one.
      gameId: picked.found ? saveFound(picked.found) : undefined,
      title: picked.title.trim(),
      platform,
      minutes: Math.round(Number(hours) * 60),
      lastPlayed: date ? new Date(date).toISOString() : null,
    });
    notifications.show({ message: `Added ${picked.title.trim()} to ${name}` });
    setPicked(null);
    setTyping(false);
    setHours('');
    setDate('');
  };

  return (
    <PlatformPanel platform={platform} method="Added by hand">
      <Text size="sm" c="dimmed">
        {why} {where}
      </Text>
      {picked && !typing ? (
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text fw={600} size="sm">
            {picked.title}
          </Text>
          <Button size="xs" variant="subtle" color="gray" onClick={() => setPicked(null)}>
            Change
          </Button>
        </Group>
      ) : typing ? (
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            label="Game"
            placeholder="Type the title"
            value={picked?.title ?? ''}
            onChange={(e) => setPicked({ title: e.currentTarget.value })}
            style={{ flex: 1 }}
          />
          <Button variant="subtle" color="gray" onClick={() => setTyping(false)}>
            Search instead
          </Button>
        </Group>
      ) : (
        <Stack gap={4}>
          <GameSearch
            platform={platform}
            actionLabel="Select"
            placeholder={`Search ${name} games`}
            onPick={(f) => setPicked({ title: f.title, found: f })}
          />
          <Group gap="md">
            <Anchor component="button" size="xs" onClick={() => setTyping(true)} w="fit-content">
              Not listed? Type the title instead
            </Anchor>
            <Anchor component="button" size="xs" onClick={() => setPasting(true)} w="fit-content">
              Add many at once: paste a list
            </Anchor>
          </Group>
        </Stack>
      )}
      <Modal opened={pasting} onClose={() => setPasting(false)} title={`Add ${name} games from a list`} size="lg">
        {pasting && <ListImport platform={platform} onDone={() => setPasting(false)} />}
      </Modal>
      <Group gap="sm" grow>
        <NumberInput label="Hours" min={0} decimalScale={1} value={hours} onChange={setHours} placeholder="0" />
        <TextInput label="Last played" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
      </Group>
      <Button
        variant="light"
        onClick={save}
        disabled={!picked?.title.trim() || !Number(hours)}
        leftSection={<IconPlus size={18} />}
        style={{ alignSelf: 'flex-start' }}
      >
        Add game
      </Button>
    </PlatformPanel>
  );
}

/** The Platforms section of Settings: connect Steam and PlayStation, add Switch and Epic hours by hand. */
export function PlatformsSection() {
  const [status, refreshStatus] = useServerStatus();
  const demoCount = useStore((s) => s.entries.filter((e) => e.source === 'demo').length);
  const removeDemo = useStore((s) => s.removeDemo);

  return (
    <Stack gap="lg" id="platforms">
      <div>
        <Title order={2}>Platforms</Title>
        <Text c="dimmed" mt={6}>
          Steam, PlayStation and Xbox import play time automatically. Epic and Nintendo don't offer a way to read it, so
          add those games by hand.
        </Text>
      </div>

      {demoCount > 0 && (
        <Paper p="md" radius="md" style={{ background: 'transparent', borderStyle: 'dashed' }}>
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Text size="sm">
              {`You're seeing a sample library (${demoCount} entries). Your first Steam or PlayStation import removes it.`}
            </Text>
            <Button size="xs" variant="default" onClick={removeDemo}>
              Remove sample library
            </Button>
          </Group>
        </Paper>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <SteamPanel status={status} />
        <PsnPanel status={status} refresh={refreshStatus} />
        <XboxPanel status={status} refresh={refreshStatus} />
        <ManualPanel
          platform="switch"
          why="Nintendo has no public API for play time."
          where="On Switch, find hours on your user page under Play Activity, or in the Parental Controls app."
        />
        <ManualPanel
          platform="epic"
          why="Epic doesn't share play time with other apps."
          where="The Epic Games Launcher shows hours played on each game in your library."
        />
      </SimpleGrid>
    </Stack>
  );
}
