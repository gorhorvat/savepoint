import { Button, Modal, Stack, Text, Title } from '@mantine/core';
import { stillHere, useAway } from '../lib/pulse';

/**
 * Shown after 15 minutes without input: the app has stopped checking for
 * messages, requests and friends online. One click picks it all up again.
 */
export function StillHere() {
  const away = useAway();
  return (
    <Modal
      opened={away}
      onClose={stillHere}
      withCloseButton={false}
      centered
      radius="lg"
      overlayProps={{ backgroundOpacity: 0.55, blur: 2 }}
    >
      <Stack gap="md" align="center" ta="center" py="sm">
        <Title order={3}>Still here?</Title>
        <Text c="dimmed" size="sm" maw={340}>
          Savepoint paused checking for new messages and friends online while you were away, to go easy on the server.
          Everything you had open is still here.
        </Text>
        <Button onClick={stillHere} size="md" radius="xl">
          I&apos;m back
        </Button>
      </Stack>
    </Modal>
  );
}
