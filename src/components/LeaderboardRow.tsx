import { Badge, Group, Progress, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import type { LeaderboardRow as RowData } from '../lib/friends';
import { FriendAvatar } from './ProfileAvatar';

const fmt = (n: number) => Math.round(n).toLocaleString();
const MEDAL = ['#e8b931', '#b8c0cc', '#c98b4e'];

/** One place on the board; friends link to their profile, you to yours. */
export function LeaderboardRow({ r, friend }: { r: RowData; friend?: boolean }) {
  const progress = r.into != null && r.needed ? (r.into / r.needed) * 100 : 0;
  const body = (
    <>
      <Text
        className="display num"
        fw={700}
        fz={r.place <= 3 ? 22 : 18}
        w={44}
        ta="center"
        c={r.place <= 3 ? MEDAL[r.place - 1] : 'dimmed'}
        style={{ flexShrink: 0 }}
      >
        {r.place}
      </Text>
      <FriendAvatar friend={r} size={40} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <Group gap={8} wrap="nowrap">
          <Text fw={700} truncate>
            {r.username}
          </Text>
          {r.you && (
            <Badge size="xs" variant="filled" radius="xs">
              You
            </Badge>
          )}
          {r.rank && (
            <Badge size="sm" variant="light" radius="sm" tt="none">
              {r.rank}
            </Badge>
          )}
        </Group>
        <Progress value={progress} size={4} radius="xl" mt={6} maw={260} aria-hidden />
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <Text fw={700} className="num">
          Level {r.level ?? 1}
        </Text>
        <Text size="xs" c="dimmed" className="num">
          {fmt(r.xp)} XP · {fmt(r.hours)} h
        </Text>
      </div>
    </>
  );
  if (r.you || friend) {
    return (
      <Link to={r.you ? '/profile' : `/friends/${r.id}`} className={`friend-row leader-row${r.you ? ' leader-row--you' : ''}`}>
        {body}
      </Link>
    );
  }
  return <div className="friend-row leader-row">{body}</div>;
}

