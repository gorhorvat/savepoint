import { Avatar, RingProgress, Text, Tooltip } from '@mantine/core';
import type { ReactNode } from 'react';
import { useStore } from '../lib/store';
import { useXp } from '../lib/xp';

/** Your picture from the Profile page, or a placeholder until you add one. */
export function ProfileAvatar({ size = 32 }: { size?: number }) {
  const avatar = useStore((s) => s.profile.avatar);
  return <Avatar src={avatar} size={size} radius="xl" color="gold" alt="Your profile picture" />;
}

/**
 * A picture inside a ring that fills towards the next level, with the level
 * number on a small badge, and optionally an online dot.
 */
export function LevelRing({
  size,
  level,
  progress,
  online,
  children,
}: {
  size: number;
  level: number | null;
  progress: number;
  online?: boolean;
  children: ReactNode;
}) {
  // Mantine draws the ring at 45% of its box minus the thickness; make that
  // land just outside the picture. (The header's small size keeps its look.)
  const ring = size <= 40 ? size + 10 : Math.round((size / 2 + 6) / 0.45);
  return (
    <span className="level-avatar" style={{ width: ring, height: ring }}>
      <RingProgress
        size={ring}
        thickness={3}
        roundCaps
        sections={[{ value: Math.min(100, Math.max(0, progress)), color: 'var(--mantine-primary-color-filled)' }]}
        rootColor="var(--sp-line)"
        label={children}
        styles={{ label: { display: 'grid', placeItems: 'center' } }}
      />
      {level != null && (
        <Text component="span" className="level-badge num" aria-label={`Level ${level}`}>
          {level}
        </Text>
      )}
      {online !== undefined && (
        <span className={`online-dot${online ? ' is-online' : ''}`} aria-label={online ? 'Online' : 'Offline'} />
      )}
    </span>
  );
}

/** Your picture, level ring and level badge, as in the header. */
export function LevelAvatar({ size = 32 }: { size?: number }) {
  const xp = useXp();
  return (
    <Tooltip
      label={`Level ${xp.level}, ${xp.rank}: ${(xp.needed - xp.into).toLocaleString()} XP to level ${xp.level + 1}`}
      withArrow
    >
      <span>
        <LevelRing size={size} level={xp.level} progress={(xp.into / xp.needed) * 100}>
          <ProfileAvatar size={size} />
        </LevelRing>
      </span>
    </Tooltip>
  );
}

/** A friend's picture with their level ring and badge, and whether they're online. */
export function FriendAvatar({
  friend,
  size = 44,
  online,
}: {
  friend: { username: string; avatar: string | null; level: number | null; into: number | null; needed: number | null };
  size?: number;
  online?: boolean;
}) {
  const progress = friend.into != null && friend.needed ? (friend.into / friend.needed) * 100 : 0;
  return (
    <LevelRing size={size} level={friend.level} progress={progress} online={online}>
      <Avatar src={friend.avatar} size={size} radius={size} color="gold" alt={`${friend.username}'s picture`}>
        {friend.username.slice(0, 2).toUpperCase()}
      </Avatar>
    </LevelRing>
  );
}
