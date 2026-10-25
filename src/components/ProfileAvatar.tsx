import { Avatar } from '@mantine/core';
import { useStore } from '../lib/store';

/** Your picture from the Profile page, or a placeholder until you add one. */
export function ProfileAvatar({ size = 32 }: { size?: number }) {
  const avatar = useStore((s) => s.profile.avatar);
  return <Avatar src={avatar} size={size} radius="xl" color="gold" alt="Your profile picture" />;
}
