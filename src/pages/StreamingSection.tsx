import { Anchor, Badge, Button, Group, Paper, Stack, TagsInput, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlugConnected, IconRefresh } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ServiceIcon } from '../components/LiveStreams';
import { useStore } from '../lib/store';
import {
  allChannels,
  disconnectStreaming,
  fetchStreamingStatus,
  normalizeKickChannel,
  refreshStreamTaste,
  signInUrl,
  type StreamingStatus,
} from '../lib/streaming';

const RESULT: Record<string, string> = {
  connected: 'connected. Working out what your streamers play…',
  cancelled: 'sign-in was cancelled.',
  failed: "sign-in didn't work. Try again.",
  unavailable: "isn't set up on this Savepoint server.",
};
const NAME = { twitch: 'Twitch' } as const;

function SignIn({
  service,
  status,
  available,
  onChange,
}: {
  service: 'twitch';
  status: StreamingStatus | null;
  available: boolean;
  onChange: () => void;
}) {
  const account = status?.[service]?.account;
  const [busy, setBusy] = useState(false);
  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectStreaming(service);
      onChange();
    } catch (err) {
      notifications.show({ message: (err as Error).message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <ServiceIcon service={service} size={22} />
        <div style={{ minWidth: 0 }}>
          <Text fw={600}>{NAME[service]}</Text>
          <Text size="xs" c="dimmed" truncate>
            {!available
              ? 'Not set up on this server.'
              : account
                ? `Signed in as ${account}`
                : 'Brings in the channels you follow.'}
          </Text>
        </div>
      </Group>
      {available &&
        (account ? (
          <Button size="xs" variant="subtle" color="gray" loading={busy} onClick={() => void disconnect()}>
            Disconnect
          </Button>
        ) : (
          <Button size="xs" component="a" href={signInUrl(service)} leftSection={<IconPlugConnected size={14} />}>
            Sign in
          </Button>
        ))}
    </Group>
  );
}

/**
 * Settings: Twitch sign-in, Kick channels, and the games your
 * streamers play (they feed Play next and More like this).
 */
export function StreamingSection() {
  const [status, setStatus] = useState<StreamingStatus | null>(null);
  const [params, setParams] = useSearchParams();
  const kick = useStore((s) => s.kickChannels);
  const setKick = useStore((s) => s.setKickChannels);
  const taste = useStore((s) => s.streamTaste);
  const [refreshing, setRefreshing] = useState(false);

  const connections = (s: StreamingStatus | null) =>
    (s?.twitch ? `t:${s.twitch.account}` : '');

  const refresh = async (s: StreamingStatus | null = status) => {
    setRefreshing(true);
    try {
      await refreshStreamTaste(connections(s));
    } catch (err) {
      notifications.show({ message: (err as Error).message, color: 'red' });
    } finally {
      setRefreshing(false);
    }
  };

  const load = () =>
    fetchStreamingStatus()
      .then((s) => {
        setStatus(s);
        return s;
      })
      .catch(() => null);

  useEffect(() => {
    void load().then((s) => {
      // Back from a sign-in: say how it went, and learn from it straight away.
      for (const service of ['twitch'] as const) {
        const result = params.get(service);
        if (!result) continue;
        notifications.show({
          message: `${NAME[service]} ${RESULT[result] ?? RESULT.failed}`,
          color: result === 'connected' ? undefined : 'red',
        });
        if (result === 'connected' && s) void refresh(s);
      }
      if (params.has('twitch')) {
        params.delete('twitch');
        setParams(params, { replace: true });
      }
    });
    // Once, on opening Settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configured = status?.configured;
  const channels = allChannels(taste);
  const nothingSetUp = configured && !configured.twitch && !configured.kick;

  return (
    <Stack gap="lg" id="streaming">
      <div>
        <Title order={2}>Streaming</Title>
        <Text c="dimmed" mt={6} maw={640}>
          Bring in the streamers you watch. The games they play count toward Play next and More like this, and the
          ones live now can go on your homepage.
        </Text>
      </div>
      <Paper p={{ base: 'md', sm: 'lg' }}>
        <Stack gap="lg">
          {nothingSetUp ? (
            <Text size="sm" c="dimmed">
              Streaming isn&apos;t set up on this server yet (Twitch and Kick keys in .env).
            </Text>
          ) : (
            <>
              <SignIn service="twitch" status={status} available={!!configured?.twitch} onChange={() => void load()} />
              <Stack gap={6}>
                <Group gap="sm" wrap="nowrap">
                  <ServiceIcon service="kick" size={22} />
                  <div>
                    <Text fw={600}>Kick</Text>
                    <Text size="xs" c="dimmed">
                      Kick doesn&apos;t share who you follow, so add the channels you watch.
                    </Text>
                  </div>
                </Group>
                <TagsInput
                  aria-label="Kick channels"
                  placeholder={kick.length ? 'Add another channel' : 'Channel name or kick.com link'}
                  value={kick}
                  onChange={(next) => setKick([...new Set(next.map(normalizeKickChannel).filter(Boolean))].slice(0, 50))}
                  splitChars={[',', ' ']}
                  disabled={!configured?.kick}
                  clearable
                  acceptValueOnBlur
                />
                {configured && !configured.kick && (
                  <Text size="xs" c="dimmed">
                    Kick isn&apos;t set up on this server.
                  </Text>
                )}
              </Stack>
            </>
          )}

          {taste && (taste.games.length > 0 || channels.length > 0) && (
            <Stack gap={8}>
              <Group justify="space-between" align="center">
                <Text size="sm" fw={600}>
                  Your streamers play
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconRefresh size={12} />}
                  loading={refreshing}
                  onClick={() => void refresh()}
                >
                  Refresh
                </Button>
              </Group>
              {taste.games.length ? (
                <Group gap={6}>
                  {taste.games.slice(0, 12).map((g) => (
                    <Badge key={g.title} variant="light" radius="xs" tt="none" size="lg" fw={600}>
                      {g.title}
                    </Badge>
                  ))}
                </Group>
              ) : (
                <Text size="sm" c="dimmed">
                  No games yet: your channels mostly stream other things.
                </Text>
              )}
              <Text size="xs" c="dimmed">
                From {channels.length} {channels.length === 1 ? 'channel' : 'channels'}
                {channels.length > 0 && ': '}
                {channels.slice(0, 6).map((c, i) => (
                  <span key={`${c.service}-${c.name}`}>
                    {i > 0 && ', '}
                    <Anchor href={c.url} target="_blank" rel="noopener noreferrer" size="xs" inherit>
                      {c.name}
                    </Anchor>
                  </span>
                ))}
                {channels.length > 6 && ` and ${channels.length - 6} more`}. Updated twice a day.
              </Text>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
