import { Anchor, Button, CopyButton, Group, Stack, Text, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconExternalLink, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { addOnPlatform, type FriendProfile } from '../lib/friends';
import { PlatformIcon } from './PlatformBadge';

/**
 * Add a Savepoint friend on Steam, PlayStation and Xbox too.
 * - Steam: opens the Steam app's add-friend dialog (steam://), or their profile.
 * - PlayStation: their profile in the PlayStation App, which has Add Friend
 *   (needs your PlayStation connected; otherwise their online ID to search for).
 * - Xbox: sent straight from your Xbox connection when OpenXBL allows it,
 *   otherwise their Xbox profile page.
 */
export function AddOnPlatforms({ friend }: { friend: FriendProfile }) {
  const a = friend.accounts;
  const mine = friend.mine;
  const [busy, setBusy] = useState<'playstation' | 'xbox' | null>(null);
  if (!a || (!a.steam && !a.playstation && !a.xbox)) return null;

  const add = async (platform: 'playstation' | 'xbox') => {
    setBusy(platform);
    try {
      const r = await addOnPlatform(friend.id, platform);
      if (r.sent) {
        notifications.show({ message: `Friend request sent to ${a[platform]} on Xbox.` });
      } else {
        window.open(r.url, '_blank', 'noopener');
      }
    } catch (e) {
      notifications.show({ message: (e as Error).message, color: 'red' });
    } finally {
      setBusy(null);
    }
  };

  const name = (n: string) => (
    <CopyButton value={n}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? 'Copied' : 'Copy'}>
          <Text span size="sm" c="dimmed" style={{ cursor: 'pointer' }} onClick={copy}>
            {n}
          </Text>
        </Tooltip>
      )}
    </CopyButton>
  );

  return (
    <Stack gap="sm">
      <Title order={2}>Play together</Title>
      <Text size="sm" c="dimmed">
        Add {friend.username} on the platforms you both use.
      </Text>
      <Group gap="sm" wrap="wrap">
        {a.steam && (
          <Group gap={8} wrap="nowrap">
            <Button
              component="a"
              href={`steam://friends/add/${a.steam}`}
              variant="default"
              leftSection={<PlatformIcon platform="steam" size={16} />}
            >
              Add on Steam
            </Button>
            <Anchor
              href={`https://steamcommunity.com/profiles/${a.steam}`}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              aria-label="Steam profile"
            >
              <IconExternalLink size={15} />
            </Anchor>
          </Group>
        )}
        {a.playstation &&
          (mine?.playstation ? (
            <Button
              variant="default"
              loading={busy === 'playstation'}
              leftSection={<PlatformIcon platform="playstation" size={16} />}
              onClick={() => void add('playstation')}
            >
              Add on PlayStation
            </Button>
          ) : (
            <Group gap={6} wrap="nowrap">
              <PlatformIcon platform="playstation" size={16} />
              <Text size="sm">Search for</Text>
              {name(a.playstation)}
              <Text size="sm">in the PlayStation App</Text>
            </Group>
          ))}
        {a.xbox &&
          (mine?.xbox ? (
            <Button
              variant="default"
              loading={busy === 'xbox'}
              leftSection={<PlatformIcon platform="xbox" size={16} />}
              rightSection={<IconUserPlus size={14} />}
              onClick={() => void add('xbox')}
            >
              Add on Xbox
            </Button>
          ) : (
            <Button
              component="a"
              href={`https://www.xbox.com/en-US/play/user/${encodeURIComponent(a.xbox)}`}
              target="_blank"
              rel="noopener noreferrer"
              variant="default"
              leftSection={<PlatformIcon platform="xbox" size={16} />}
            >
              Xbox profile
            </Button>
          ))}
      </Group>
      <Text size="xs" c="dimmed">
        {[
          a.steam && 'Steam opens your Steam app.',
          a.playstation && mine?.playstation && 'PlayStation opens their profile, where you tap Add Friend.',
          a.xbox &&
            (mine?.xbox
              ? 'Xbox sends the request from your Xbox connection when it can, otherwise opens their profile.'
              : 'Connect Xbox in Settings to send the request from here.'),
        ]
          .filter(Boolean)
          .join(' ')}
      </Text>
    </Stack>
  );
}
