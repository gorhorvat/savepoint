import { Badge, Button, Code, CopyButton, Group, Paper, Stack, Text, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconCopy, IconGift } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import {
  FRIENDS_CHANGED,
  fetchGifts,
  markGiftRedeemed,
  openGift,
  takeBackGift,
  type Gift,
} from '../lib/friends';
import { useStore } from '../lib/store';

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const announce = () => window.dispatchEvent(new Event(FRIENDS_CHANGED));

function ReceivedRow({ gift, onChange }: { gift: Gift; onChange: () => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notifications.show({ message: (err as Error).message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };
  const open = () =>
    act(async () => {
      setKey((await openGift(gift.id)).key);
      announce();
    });
  const redeemed = () =>
    act(async () => {
      const r = await markGiftRedeemed(gift.id);
      // It's yours now, so it comes off the wishlist.
      const id = r.gameId ?? gift.gameId;
      const { wishlist, toggleWishlist } = useStore.getState();
      if (id && wishlist.some((w) => w.gameId === id)) toggleWishlist(id);
      notifications.show({ message: `${gift.title} marked as redeemed. ${gift.from?.username} can see it.` });
      onChange();
    });

  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
        <div style={{ minWidth: 0 }}>
          <Group gap={8} wrap="nowrap">
            <Text fw={700} truncate>
              {gift.title}
            </Text>
            <Badge size="sm" variant="outline" color="gray" radius="xs" tt="none">
              {gift.platform}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            From {gift.from?.username}, {day(gift.sentAt)}
            {gift.redeemedAt ? `. Redeemed ${day(gift.redeemedAt)}` : ''}
          </Text>
          {gift.message && (
            <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
              “{gift.message}”
            </Text>
          )}
        </div>
        {!key && !gift.redeemedAt && (
          <Button size="xs" loading={busy} onClick={() => void open()} leftSection={<IconGift size={14} />}>
            {gift.openedAt ? 'Show key' : 'Open'}
          </Button>
        )}
      </Group>
      {key && (
        <Group gap="xs" wrap="wrap">
          <Code style={{ fontSize: 15, wordBreak: 'break-all' }}>{key}</Code>
          <CopyButton value={key}>
            {({ copied, copy }) => (
              <Button size="xs" variant="default" leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </CopyButton>
          {!gift.redeemedAt && (
            <Button size="xs" variant="light" color="green" loading={busy} onClick={() => void redeemed()}>
              I&apos;ve redeemed it
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}

function SentRow({ gift, onChange }: { gift: Gift; onChange: () => void }) {
  const status = gift.redeemedAt
    ? { label: `Redeemed ${day(gift.redeemedAt)}`, color: 'green' }
    : gift.openedAt
      ? { label: `Opened ${day(gift.openedAt)}`, color: 'blue' }
      : { label: 'Not opened yet', color: 'gray' };
  const takeBack = async () => {
    try {
      await takeBackGift(gift.id);
      notifications.show({ message: `Took back ${gift.title}. The key is yours again.` });
      onChange();
    } catch (err) {
      notifications.show({ message: (err as Error).message, color: 'red' });
    }
  };
  return (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <div style={{ minWidth: 0 }}>
        <Text fw={600} truncate>
          {gift.title}{' '}
          <Text span size="sm" c="dimmed" fw={400}>
            to {gift.to?.username} ({gift.platform}), {day(gift.sentAt)}
          </Text>
        </Text>
      </div>
      <Group gap="xs" wrap="nowrap">
        <Badge size="sm" variant="light" color={status.color} radius="xs" tt="none">
          {status.label}
        </Badge>
        {!gift.openedAt && (
          <Tooltip label="They haven't seen the key, so you can take it back">
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => void takeBack()}>
              Take back
            </Button>
          </Tooltip>
        )}
      </Group>
    </Group>
  );
}

/** Gifts from friends (open, copy, mark redeemed) and gifts you sent, with their status. */
export function GiftsSection() {
  const [gifts, setGifts] = useState<{ received: Gift[]; sent: Gift[]; at: number } | null>(null);
  const load = useCallback(() => {
    fetchGifts()
      .then((g) => setGifts({ ...g, at: Date.now() }))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (!gifts || (!gifts.received.length && !gifts.sent.length)) return null;
  // Redeemed gifts stay listed for a month.
  const recent = (g: Gift) => !g.redeemedAt || gifts.at - new Date(g.redeemedAt).getTime() < 30 * 86400_000;
  const received = gifts.received.filter(recent);
  const sent = gifts.sent.filter(recent);
  return (
    <Stack gap="sm" id="gifts">
      <Title order={2}>Gifts</Title>
      {received.length > 0 && (
        <Paper p={{ base: 'md', sm: 'lg' }}>
          <Stack gap="lg">
            {received.map((g) => (
              <ReceivedRow key={g.id} gift={g} onChange={load} />
            ))}
          </Stack>
        </Paper>
      )}
      {sent.length > 0 && (
        <Stack gap={6}>
          <Text size="sm" fw={600} c="dimmed">
            Sent by you
          </Text>
          <Paper p={{ base: 'md', sm: 'lg' }}>
            <Stack gap="sm">
              {sent.map((g) => (
                <SentRow key={g.id} gift={g} onChange={load} />
              ))}
            </Stack>
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}
