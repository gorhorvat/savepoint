import { Button, Group, Paper, Stack, Switch, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { messageAlerts } from '../lib/messages';
import { useStore } from '../lib/store';

type Permission = NotificationPermission | 'unsupported';
const currentPermission = (): Permission => ('Notification' in window ? Notification.permission : 'unsupported');

/** Settings: how a new message from a friend gets your attention. */
export function MessageAlertsSection() {
  const alerts = messageAlerts(useStore((s) => s.messageAlerts));
  const setAlerts = useStore((s) => s.setMessageAlerts);
  const [permission, setPermission] = useState<Permission>(currentPermission);

  const ask = async () => {
    if (!('Notification' in window)) return 'unsupported';
    const p = await Notification.requestPermission();
    setPermission(p);
    return p;
  };

  const toggleBrowser = async (on: boolean) => {
    if (!on) return setAlerts({ browser: false });
    const p = permission === 'granted' ? 'granted' : await ask();
    if (p === 'granted') setAlerts({ browser: true });
  };

  return (
    <Stack gap="lg" id="messages">
      <div>
        <Title order={2}>Message alerts</Title>
        <Text c="dimmed" mt={6}>
          How a new message from a friend gets your attention. The unread count on the messages icon is always there.
        </Text>
      </div>
      <Paper p={{ base: 'md', sm: 'lg' }}>
        <Stack gap="md">
          <Switch
            checked={alerts.toast}
            onChange={(e) => setAlerts({ toast: e.currentTarget.checked })}
            label="Pop-up in Savepoint"
            description="A small note in the corner while you're using Savepoint. Click it to open the chat."
          />
          <Switch
            checked={alerts.browser && permission === 'granted'}
            disabled={permission === 'unsupported' || permission === 'denied'}
            onChange={(e) => void toggleBrowser(e.currentTarget.checked)}
            label="Browser notifications"
            description="A notification from your browser while Savepoint is open in another tab or minimised. Your browser asks once for permission."
          />
          {permission === 'unsupported' && (
            <Text size="sm" c="dimmed">
              This browser doesn&apos;t support notifications.
            </Text>
          )}
          {permission === 'denied' && (
            <Text size="sm" c="dimmed">
              Notifications are blocked for Savepoint in this browser. Allow them in the site settings (the icon left of
              the address), then reload the page.
            </Text>
          )}
          {alerts.browser && permission === 'default' && (
            <Group>
              <Text size="sm" c="dimmed">
                You turned these on in another browser. Allow them here too:
              </Text>
              <Button size="xs" variant="default" onClick={() => void ask()}>
                Allow notifications
              </Button>
            </Group>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
