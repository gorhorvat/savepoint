import { Alert, Anchor, Button, Card, Group, Loader, Menu, Stack, Text, Title } from '@mantine/core';
import { IconBrandSteam, IconDots, IconExternalLink, IconRefresh, IconUnlink } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ago,
  connectSteamGame,
  disconnectSteamGame,
  fetchGameConnections,
  refreshSteamGame,
  type GameConnection,
} from '../lib/gameStats';

/**
 * The frame of a stats tab whose numbers come from the linked Steam account
 * (Counter-Strike 2, Dota 2): one button to show them, then the header with
 * Refresh and a menu, and the game's own content.
 */
export function SteamGameTab<T>({
  game,
  title,
  intro,
  links,
  heading,
  children,
}: {
  game: 'cs2' | 'dota2';
  title: string;
  /** What the tab shows and where it comes from, before it's connected. */
  intro: ReactNode;
  /** Outside pages for the menu, e.g. the OpenDota profile. */
  links?: (data: T) => { label: string; href: string }[];
  heading: (data: T) => { name: string; detail: ReactNode };
  children: (conn: GameConnection<T>) => ReactNode;
}) {
  const [conn, setConn] = useState<GameConnection<T> | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGameConnections()
      .then((all) => setConn((all.find((c) => c.game === game) as GameConnection<T> | undefined) ?? null))
      .catch((e: Error) => {
        setError(e.message);
        setConn(null);
      });
  }, [game]);

  const run = async (fn: () => Promise<GameConnection<T>>) => {
    setBusy(true);
    setError(null);
    try {
      setConn(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (conn === undefined) return <Loader />;

  if (!conn) {
    return (
      <Card withBorder padding="lg">
        <Stack gap="md">
          <div>
            <Title order={3}>{title}</Title>
            <Text size="sm" c="dimmed" mt={4}>
              {intro}
            </Text>
          </div>
          <Group gap="sm">
            <Button
              loading={busy}
              leftSection={<IconBrandSteam size={18} />}
              onClick={() => void run(() => connectSteamGame<T>(game))}
            >
              Show my stats
            </Button>
          </Group>
          {error && (
            <Text size="sm" c="red">
              {error}{' '}
              {/Settings/.test(error) && (
                <Anchor component={Link} to="/settings#platforms" size="sm">
                  Open Settings
                </Anchor>
              )}
            </Text>
          )}
        </Stack>
      </Card>
    );
  }

  const head = heading(conn.data);
  return (
    <Stack gap={48}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <div style={{ minWidth: 0 }}>
          <Text className="display" fz={28} lh={1.1} truncate>
            {head.name}
          </Text>
          <Text size="sm" c="dimmed">
            {head.detail}
            {head.detail ? ' · ' : ''}updated {ago(conn.fetchedAt)}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Button
            variant="default"
            size="sm"
            loading={busy}
            onClick={() => void run(() => refreshSteamGame<T>(game))}
            leftSection={<IconRefresh size={16} />}
          >
            Refresh
          </Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <Button variant="default" size="sm" px={8} aria-label="More">
                <IconDots size={16} />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {(links?.(conn.data) ?? []).map((l) => (
                <Menu.Item
                  key={l.href}
                  component="a"
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  leftSection={<IconExternalLink size={14} />}
                >
                  {l.label}
                </Menu.Item>
              ))}
              <Menu.Item
                color="red"
                leftSection={<IconUnlink size={14} />}
                onClick={() =>
                  void disconnectSteamGame(game)
                    .then(() => setConn(null))
                    .catch((e: Error) => setError(e.message))
                }
              >
                Hide these stats
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {error && (
        <Alert color="red" variant="light" mt={-32}>
          {error}
        </Alert>
      )}
      {children(conn)}
    </Stack>
  );
}
