import { Anchor, Button, Group, Modal, Select, Stack, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconExternalLink, IconGift, IconKey, IconShoppingCart } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PLATFORM_BY_ID } from '../data/platforms';
import { GIFT_PLATFORMS, sendGift, type GiftPlatform, type ProfileGame, type ProfileWant } from '../lib/friends';
import { useStore } from '../lib/store';
import { vendorSearchUrl } from '../lib/vendors';
import type { Game, PlatformId } from '../types';
import { PriceTable } from './PriceTable';

const FALLBACK_PLATFORM: Partial<Record<PlatformId, GiftPlatform>> = {
  steam: 'Steam',
  epic: 'Epic Games',
  playstation: 'PlayStation',
  xbox: 'Xbox',
  switch: 'Nintendo',
};

/** A friend's wishlist game as a game record the price table understands. */
function friendWishGame(g: ProfileGame): Game {
  return {
    id: `gift:${g.gameId ?? g.title}`,
    title: g.title,
    imageUrl: g.imageUrl,
    steamAppId: g.steamAppId,
    nsuid: g.nsuid,
    genres: [],
    subgenres: [],
    tags: [],
    availableOn: (g.platforms ?? []).filter((p): p is PlatformId => p in PLATFORM_BY_ID),
  };
}

function SendKey({ friend, game, onSent }: { friend: { id: number; username: string }; game: ProfileGame; onSent: () => void }) {
  const first = (game.platforms ?? []).map((p) => FALLBACK_PLATFORM[p as PlatformId]).find(Boolean) ?? null;
  const [platform, setPlatform] = useState<GiftPlatform | null>(first);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platform) return;
    setBusy(true);
    setError(null);
    try {
      await sendGift({ to: friend.id, title: game.title, platform, key, message: message || undefined, gameId: game.gameId });
      notifications.show({ message: `Gift sent to ${friend.username}.` });
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Bought a key already? Send it here. Only {friend.username} can see it, and you&apos;ll see when they open and
          redeem it.
        </Text>
        <Select
          label="Platform"
          data={[...GIFT_PLATFORMS]}
          value={platform}
          onChange={(v) => setPlatform(v as GiftPlatform | null)}
          allowDeselect={false}
          required
        />
        <TextInput
          label="Key"
          placeholder="XXXXX-XXXXX-XXXXX"
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          autoComplete="off"
          spellCheck={false}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          required
        />
        <Textarea
          label="Message"
          placeholder="Optional"
          autosize
          minRows={2}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
        />
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={busy} disabled={!platform || !key.trim()} leftSection={<IconGift size={16} />}>
            Send
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Gift a game from a friend's wishlist: where to buy it, or send a key you have. */
export function GiftWishModal({
  friend,
  game,
  onClose,
}: {
  friend: { id: number; username: string };
  game: ProfileGame | null;
  onClose: () => void;
}) {
  return (
    <Modal opened={!!game} onClose={onClose} title={game ? `Gift ${game.title}` : ''} size="lg">
      {game && (
        <Tabs defaultValue="buy">
          <Tabs.List mb="md">
            <Tabs.Tab value="buy" leftSection={<IconShoppingCart size={15} />}>
              Best deals
            </Tabs.Tab>
            <Tabs.Tab value="key" leftSection={<IconKey size={15} />}>
              Gift a key
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="buy">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Cheapest places to buy it now, key shops included. Buy a key, then send it with Gift a key.
              </Text>
              <PriceTable game={friendWishGame(game)} compact />
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="key">
            <SendKey friend={friend} game={game} onSent={onClose} />
          </Tabs.Panel>
        </Tabs>
      )}
    </Modal>
  );
}

/** Gift a physical copy a friend is looking for: search links in your own shops. */
export function GiftWantModal({ want, onClose }: { want: ProfileWant | null; onClose: () => void }) {
  const vendors = useStore((s) => s.vendors);
  const query = want ? `${want.title} ${want.platform}` : '';
  return (
    <Modal opened={!!want} onClose={onClose} title={want ? `Gift ${want.title} (${want.platform})` : ''}>
      {want && (
        <Stack gap="sm">
          {want.edition && (
            <Text size="sm">
              They&apos;re after the <b>{want.edition}</b>.
            </Text>
          )}
          {vendors.length ? (
            <>
              <Text size="sm" c="dimmed">
                Search your shops for it:
              </Text>
              <Stack gap={6}>
                {vendors.map((v) => (
                  <Anchor key={v} href={vendorSearchUrl(v, query)} target="_blank" rel="noopener noreferrer" size="sm">
                    <Group gap={6} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
                      {v}
                      <IconExternalLink size={13} style={{ opacity: 0.6 }} />
                    </Group>
                  </Anchor>
                ))}
              </Stack>
            </>
          ) : (
            <Text size="sm" c="dimmed">
              Add the shops you buy from in{' '}
              <Anchor component={Link} to="/settings#shops" onClick={onClose}>
                Settings
              </Anchor>{' '}
              to get search links here.
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  );
}
