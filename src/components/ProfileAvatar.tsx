import { Avatar, RingProgress, Text, Tooltip } from '@mantine/core';
import { useStore } from '../lib/store';
import { useXp } from '../lib/xp';

/** Your picture from the Profile page, or a placeholder until you add one. */
export function ProfileAvatar({ size = 32 }: { size?: number }) {
  const avatar = useStore((s) => s.profile.avatar);
  return <Avatar src={avatar} size={size} radius="xl" color="gold" alt="Your profile picture" />;
}

/**
 * Your picture inside a ring that fills as you earn XP towards the next level,
 * with the level number on a small badge.
 */
export function LevelAvatar({ size = 32 }: { size?: number }) {
  const xp = useXp();
  const ring = size + 10;
  const progress = Math.min(100, (xp.into / xp.needed) * 100);
  return (
    <Tooltip
      label={`Level ${xp.level}, ${xp.rank}: ${(xp.needed - xp.into).toLocaleString()} XP to level ${xp.level + 1}`}
      withArrow
    >
      <span className="level-avatar" style={{ width: ring, height: ring }}>
        <RingProgress
          size={ring}
          thickness={3}
          roundCaps
          sections={[{ value: progress, color: 'var(--mantine-primary-color-filled)' }]}
          rootColor="var(--sp-line)"
          label={<ProfileAvatar size={size} />}
          styles={{ label: { display: 'grid', placeItems: 'center' } }}
        />
        <Text component="span" className="level-badge num" aria-label={`Level ${xp.level}`}>
          {xp.level}
        </Text>
      </span>
    </Tooltip>
  );
}
