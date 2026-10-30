import { Button, Modal, Select, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSend } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchFriends, type FriendCard } from '../lib/friends';
import { sendMessage, shareable } from '../lib/messages';
import type { Game } from '../types';

/** "Send to a friend": a game card, with an optional note, into a chat. */
export function ShareGameButton({ game, fit }: { game: Game; fit?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="default" leftSection={<IconSend size={16} />} onClick={() => setOpen(true)}>
        Send to a friend
      </Button>
      {open && <ShareGameModal game={game} fit={fit} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareGameModal({ game, fit, onClose }: { game: Game; fit?: number; onClose: () => void }) {
  const navigate = useNavigate();
  const [friends, setFriends] = useState<FriendCard[] | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchFriends()
      .then((f) => setFriends(f.friends))
      .catch(() => setFriends([]));
  }, []);

  const send = async () => {
    if (!to) return;
    setBusy(true);
    try {
      await sendMessage(Number(to), note.trim(), shareable(game, fit));
      const name = friends?.find((f) => String(f.id) === to)?.username ?? 'your friend';
      notifications.show({ message: `Sent ${game.title} to ${name}` });
      onClose();
      navigate(`/messages/${to}`);
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={`Send ${game.title} to a friend`}>
      {friends && !friends.length ? (
        <Text size="sm" c="dimmed">
          Add a friend first, then you can send them games.
        </Text>
      ) : (
        <Stack gap="sm">
          <Select
            label="Friend"
            placeholder={friends ? 'Pick a friend' : 'Loading…'}
            data={(friends ?? []).map((f) => ({ value: String(f.id), label: f.username }))}
            value={to}
            onChange={setTo}
            searchable
            data-autofocus
          />
          <Textarea
            label="Note"
            placeholder="Optional"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            autosize
            minRows={2}
            maxLength={2000}
          />
          <Button onClick={() => void send()} loading={busy} disabled={!to} w="fit-content">
            Send
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
