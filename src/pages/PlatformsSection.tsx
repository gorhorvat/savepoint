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
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { GameSearch } from '../components/GameSearch';
import { ListImport } from '../components/ListImport';
import { PlatformIcon } from '../components/PlatformBadge';
import { PLATFORM_BY_ID } from '../data/platforms';
import { importPsn, importSteam, useServerStatus, type FoundGame, type ServerStatus } from '../lib/api';
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
          ? `${conn.count} games imported${conn.account ? ` from ${conn.account}` : ''}, synced ${formatLastPlayed(conn.lastSync ?? null)}`
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

function ServerHint({ status, envVar }: { status: ServerStatus | null; envVar: string }) {
  if (!status) return null;
  if (!status.online) {
    return (
      <Alert variant="light" color="gray" radius="md">
        The Savepoint server isn't running. Start the app with <Code>npm run dev</Code> to import.
      </Alert>
    );
  }
  return (
    <Alert variant="light" color="gray" radius="md">
      Add <Code>{envVar}</Code> to the <Code>.env</Code> file, then restart the server.
    </Alert>
  );
}

function SteamPanel({ status }: { status: ServerStatus | null }) {
  const conn = useStore((s) => s.connections.steam);
  const importLibrary = useStore((s) => s.importLibrary);
  const disconnect = useStore((s) => s.disconnect);
  const [profile, setProfile] = useState(conn?.account ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await importSteam(profile);
      const r = importLibrary('steam', 'steam', res.games, profile.trim());
      notifications.show({
        title: 'Steam imported',
        message: `${r.added} played games.${r.removedSample ? ' The sample library was removed.' : ''}`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlatformPanel platform="steam" method="Steam Web API">
      {status && !status.steam ? (
        <ServerHint status={status} envVar="STEAM_API_KEY" />
      ) : (
        <>
          <TextInput
            label="Steam profile"
            description="Profile URL, custom URL name, or SteamID64. Game details must be public."
            placeholder="steamcommunity.com/id/yourname"
            value={profile}
            onChange={(e) => setProfile(e.currentTarget.value)}
            error={error}
          />
          <Group gap="sm">
            <Button
              onClick={run}
              loading={busy}
              disabled={!profile.trim()}
              leftSection={conn ? <IconRefresh size={18} /> : <IconDownload size={18} />}
            >
              {conn ? 'Sync again' : 'Import from Steam'}
            </Button>
            {conn && (
              <Button variant="subtle" color="gray" onClick={() => disconnect('steam')}>
                Disconnect
              </Button>
            )}
          </Group>
        </>
      )}
    </PlatformPanel>
  );
}

function PsnPanel({ status }: { status: ServerStatus | null }) {
  const conn = useStore((s) => s.connections.playstation);
  const importLibrary = useStore((s) => s.importLibrary);
  const disconnect = useStore((s) => s.disconnect);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await importPsn();
      const r = importLibrary('playstation', 'psn', res.games);
      notifications.show({
        title: 'PlayStation imported',
        message: `${r.added} played games.${r.removedSample ? ' The sample library was removed.' : ''}`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlatformPanel platform="playstation" method="PSN, unofficial">
      {status?.owner === false ? (
        <Text size="sm" c="dimmed">
          PlayStation import signs in with the owner&apos;s PlayStation account, so it&apos;s only available to them.
          You can still log PlayStation hours by hand on a game&apos;s page.
        </Text>
      ) : status && !status.psn ? (
        <>
          <ServerHint status={status} envVar="PSN_NPSSO" />
          {status.online && (
            <List size="sm" c="dimmed" type="ordered" spacing={4}>
              <List.Item>
                Sign in at{' '}
                <Anchor href="https://www.playstation.com" target="_blank" rel="noopener noreferrer">
                  playstation.com
                </Anchor>
                .
              </List.Item>
              <List.Item>
                Open{' '}
                <Anchor href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noopener noreferrer">
                  ca.account.sony.com/api/v1/ssocookie
                </Anchor>{' '}
                and copy the <Code>npsso</Code> value.
              </List.Item>
              <List.Item>
                Set it as <Code>PSN_NPSSO</Code>. It's a sign-in token, so keep it private.
              </List.Item>
            </List>
          )}
        </>
      ) : (
        <>
          <Text size="sm">Imports PS4 and PS5 play time for the account the token belongs to.</Text>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Group gap="sm">
            <Button
              onClick={run}
              loading={busy}
              leftSection={conn ? <IconRefresh size={18} /> : <IconDownload size={18} />}
            >
              {conn ? 'Sync again' : 'Import from PlayStation'}
            </Button>
            {conn && (
              <Button variant="subtle" color="gray" onClick={() => disconnect('playstation')}>
                Disconnect
              </Button>
            )}
          </Group>
        </>
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
  const [status] = useServerStatus();
  const demoCount = useStore((s) => s.entries.filter((e) => e.source === 'demo').length);
  const removeDemo = useStore((s) => s.removeDemo);

  return (
    <Stack gap="lg" id="platforms">
      <div>
        <Title order={2}>Platforms</Title>
        <Text c="dimmed" mt={6} maw={640}>
          Steam and PlayStation import play time automatically. Epic and Nintendo don't offer a way to read it, so add
          those games by hand.
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
        <PsnPanel status={status} />
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
