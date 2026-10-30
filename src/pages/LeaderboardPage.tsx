import { Group, Paper, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { IconTrophy } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LeaderboardRow as Row } from '../components/LeaderboardRow';
import { fetchLeaderboard, type Leaderboard } from '../lib/friends';

/** Friends and global leaderboards, by Savepoint XP. */
export function LeaderboardPage() {
  const [scope, setScope] = useState<'friends' | 'global'>('friends');
  const [board, setBoard] = useState<{ scope: string; data: Leaderboard } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchLeaderboard(scope)
      .then((data) => alive && setBoard({ scope, data }))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [scope]);

  const data = board?.scope === scope ? board.data : null;
  const youBelow = data?.you && !data.rows.some((r) => r.you) ? data.you : null;

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end" gap="md" wrap="nowrap" className="page-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Title order={1}>Leaderboard</Title>
          <Text c="dimmed" mt={6} size="lg">
            Ranked by Savepoint XP: trophies, achievements and confirmed play time.{' '}
            <Text component={Link} to="/profile" span inherit c="var(--mantine-primary-color-filled)">
              How XP works
            </Text>
          </Text>
        </div>
        <SegmentedControl
          value={scope}
          onChange={(v) => setScope(v as typeof scope)}
          data={[
            { value: 'friends', label: 'Friends' },
            { value: 'global', label: 'Everyone' },
          ]}
        />
      </Group>
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {!data ? (
        !error && <Text c="dimmed">Loading…</Text>
      ) : !data.rows.length ? (
        <Text c="dimmed">Nobody to rank yet.</Text>
      ) : (
        <Paper p={{ base: 'xs', sm: 'md' }}>
          <Stack gap={2}>
            {data.rows.map((r) => (
              <Row key={r.id} r={r} friend={scope === 'friends'} />
            ))}
            {youBelow && (
              <>
                <Text c="dimmed" ta="center" size="sm">
                  ⋯
                </Text>
                <Row r={youBelow} />
              </>
            )}
          </Stack>
        </Paper>
      )}
      {data && (
        <Group gap={6}>
          <IconTrophy size={14} style={{ opacity: 0.6 }} />
          <Text size="xs" c="dimmed">
            {scope === 'friends'
              ? `You and ${data.total - 1} ${data.total - 1 === 1 ? 'friend' : 'friends'}.`
              : `${data.total} ${data.total === 1 ? 'player' : 'players'} on Savepoint${data.total > 100 ? ', top 100 shown' : ''}.`}{' '}
            Levels update when each player opens Savepoint.
          </Text>
        </Group>
      )}
    </Stack>
  );
}
