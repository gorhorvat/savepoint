import { Anchor, Button, Code, Group, List, Paper, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBell, IconBellOff, IconCopy, IconRefresh } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAlertSettings, newAlertTopic, sendTestAlert, turnOffAlerts, type AlertSettings } from '../lib/api';

const external = (href: string, text: string) => (
  <Anchor href={href} target="_blank" rel="noopener noreferrer">
    {text}
  </Anchor>
);

/**
 * This account's price alerts: its own ntfy topic, how to subscribe to it on a
 * phone, a test, a new topic, and turning alerts off.
 */
export function AlertsSection() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [busy, setBusy] = useState<'on' | 'new' | 'off' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => {
    fetchAlertSettings()
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
  }, []);

  const run = (which: NonNullable<typeof busy>, fn: () => Promise<void>) => async () => {
    setBusy(which);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setConfirmNew(false);
    }
  };

  const turnOn = run('on', async () => {
    const topic = await newAlertTopic();
    setSettings((s) => ({ watching: s?.watching ?? 0, topic }));
  });
  const replace = run('new', async () => {
    const topic = await newAlertTopic();
    setSettings((s) => ({ watching: s?.watching ?? 0, topic }));
    notifications.show({ message: 'New topic made. Subscribe to it in the ntfy app; the old one gets nothing now.' });
  });
  const off = run('off', async () => {
    await turnOffAlerts();
    setSettings((s) => ({ watching: s?.watching ?? 0, topic: null }));
  });
  const test = run('test', async () => {
    await sendTestAlert();
    notifications.show({ message: 'Test sent. It should reach your phone in a few seconds.' });
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(settings?.topic ?? '');
      notifications.show({ message: 'Topic copied.', autoClose: 2000 });
    } catch {
      notifications.show({ message: "Couldn't copy. Select the topic and copy it instead.", color: 'red' });
    }
  };

  const topic = settings?.topic;
  return (
    <Stack gap="lg" id="alerts">
      <div>
        <Title order={2}>Price alerts</Title>
        <Text c="dimmed" mt={6} maw={640}>
          Set a target price on a{' '}
          <Anchor component={Link} to="/wishlist">
            wishlist
          </Anchor>{' '}
          game, and your phone gets a notification when it drops to that price or lower. Savepoint checks once a day,
          through the free ntfy app.
        </Text>
      </div>
      <Paper p={{ base: 'md', sm: 'lg' }} maw={640}>
        <Stack gap="sm">
          {settings === null && !error ? (
            <Text size="sm" c="dimmed">
              Loading…
            </Text>
          ) : !topic ? (
            <>
              <Text size="sm">Alerts are off.</Text>
              <Button w="fit-content" leftSection={<IconBell size={16} />} loading={busy === 'on'} onClick={turnOn}>
                Turn on price alerts
              </Button>
            </>
          ) : (
            <>
              <List size="sm" type="ordered" spacing={6}>
                <List.Item>
                  Install ntfy on your phone (
                  {external('https://play.google.com/store/apps/details?id=io.heckel.ntfy', 'Android')},{' '}
                  {external('https://apps.apple.com/app/ntfy/id1625396347', 'iPhone')}).
                </List.Item>
                <List.Item>
                  In ntfy, tap <b>+</b> and subscribe to this topic:
                  <Group gap="xs" mt={6} wrap="nowrap">
                    <Code style={{ fontSize: 14, wordBreak: 'break-all' }}>{topic}</Code>
                    <Button size="xs" variant="default" leftSection={<IconCopy size={14} />} onClick={copy}>
                      Copy
                    </Button>
                  </Group>
                </List.Item>
                <List.Item>Send a test to check it arrives.</List.Item>
              </List>
              <Text size="xs" c="dimmed">
                Anyone who knows the topic can read your alerts, so keep it to yourself. If it gets out, make a new one.
              </Text>
              <Text size="sm">
                {settings?.watching
                  ? `Watching ${settings.watching} ${settings.watching === 1 ? 'game' : 'games'} with a target price.`
                  : 'No target prices yet. Set one on a wishlist game.'}
              </Text>
              <Group gap="sm">
                <Button size="xs" loading={busy === 'test'} onClick={test}>
                  Send a test
                </Button>
                {confirmNew ? (
                  <>
                    <Button size="xs" color="red" variant="light" loading={busy === 'new'} onClick={replace}>
                      Make a new topic
                    </Button>
                    <Button size="xs" variant="subtle" color="gray" onClick={() => setConfirmNew(false)}>
                      Keep this one
                    </Button>
                  </>
                ) : (
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconRefresh size={14} />}
                    onClick={() => setConfirmNew(true)}
                  >
                    New topic
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconBellOff size={14} />}
                  loading={busy === 'off'}
                  onClick={off}
                >
                  Turn off
                </Button>
              </Group>
              {confirmNew && (
                <Text size="xs" c="dimmed">
                  The phone subscribed to the current topic stops getting alerts; subscribe to the new one instead.
                </Text>
              )}
            </>
          )}
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
