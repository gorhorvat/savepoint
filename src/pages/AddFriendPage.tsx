import { Button, Stack, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { sendFriendRequest } from '../lib/friends';

/** Opened from someone's friend link: sends them a friend request. */
export function AddFriendPage() {
  const { code = '' } = useParams();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const sent = useRef(false); // Development mode runs effects twice.

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    sendFriendRequest({ code })
      .then((r) =>
        setResult({
          ok: true,
          text:
            r.status === 'accepted'
              ? `You and ${r.friend.username} are friends now.`
              : `Friend request sent to ${r.friend.username}. You'll be friends once they accept.`,
        }),
      )
      .catch((e: Error) => setResult({ ok: false, text: e.message }));
  }, [code]);

  return (
    <Stack gap="md" maw={520}>
      <Title order={1}>Friend link</Title>
      <Text c={result && !result.ok ? 'red' : undefined}>{result?.text ?? 'Sending a friend request…'}</Text>
      <Button component={Link} to="/friends" w="fit-content">
        Go to Friends
      </Button>
    </Stack>
  );
}
