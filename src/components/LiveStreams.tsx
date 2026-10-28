import { Anchor, Group, Loader, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { IconBrandKick, IconBrandTwitch, IconUsers } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { fetchGameStreams, SERVICE_NAME, type GameStreams, type LiveStream, type StreamService } from '../lib/streaming';

const SERVICE_COLOR: Record<StreamService, string> = { twitch: '#9146ff', kick: '#53fc18' };

export function ServiceIcon({ service, size = 14 }: { service: StreamService; size?: number }) {
  const Icon = service === 'twitch' ? IconBrandTwitch : IconBrandKick;
  return <Icon size={size} color={SERVICE_COLOR[service]} style={{ flexShrink: 0 }} aria-hidden />;
}

const viewers = (n?: number) =>
  n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

/** One live stream as a card: preview, channel, viewers, title. */
export function StreamCard({ s, showGame }: { s: LiveStream; showGame?: boolean }) {
  return (
    <Anchor href={s.url} target="_blank" rel="noopener noreferrer" underline="never" c="inherit" className="stream-card">
      <div className="stream-thumb">
        {s.thumbnail ? <img src={s.thumbnail} alt="" loading="lazy" /> : <ServiceIcon service={s.platform} size={36} />}
        <span className="stream-live">LIVE</span>
        {s.viewers !== undefined && (
          <span className="stream-viewers num">
            <IconUsers size={11} /> {viewers(s.viewers)}
          </span>
        )}
      </div>
      <Group gap={6} wrap="nowrap" mt={6}>
        <ServiceIcon service={s.platform} />
        <Text fw={700} size="sm" truncate>
          {s.channel}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={2} title={s.title}>
        {showGame && s.game ? `${s.game}: ` : ''}
        {s.title}
      </Text>
    </Anchor>
  );
}

/** Who's live in this game right now: the top five on Twitch and Kick. */
export function LiveStreams({ title, igdbId }: { title: string; igdbId?: number }) {
  const [data, setData] = useState<{ key: string; streams: GameStreams | null } | null>(null);
  const [tab, setTab] = useState<'all' | StreamService>('all');
  const key = `${title}|${igdbId ?? ''}`;

  useEffect(() => {
    let alive = true;
    fetchGameStreams({ title, igdbId })
      .then((streams) => alive && setData({ key, streams }))
      .catch(() => alive && setData({ key, streams: null }));
    return () => {
      alive = false;
    };
  }, [key, title, igdbId]);

  const streams = data?.key === key ? data.streams : undefined;
  if (streams === null) return null;
  const services = streams ? (Object.keys(SERVICE_NAME) as StreamService[]).filter((s) => streams[s] !== null) : [];
  if (streams && !services.length) return null; // Nothing set up on the server.

  const all = streams
    ? services
        .flatMap((s) => streams[s] ?? [])
        .sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0))
        .slice(0, 5)
    : [];
  const shown = tab === 'all' ? all : (streams?.[tab] ?? []);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Title order={2}>Live now</Title>
        {services.length > 1 && (
          <SegmentedControl
            size="xs"
            value={tab}
            onChange={(v) => setTab(v as typeof tab)}
            data={[
              { value: 'all', label: 'Top 5' },
              ...services.map((s) => ({ value: s, label: `${SERVICE_NAME[s]} (${streams?.[s]?.length ?? 0})` })),
            ]}
          />
        )}
      </Group>
      {!streams ? (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            Looking for live streams
          </Text>
        </Group>
      ) : shown.length ? (
        <div className="stream-grid">
          {shown.map((s) => (
            <StreamCard key={`${s.platform}-${s.channel}`} s={s} />
          ))}
        </div>
      ) : (
        <Text size="sm" c="dimmed">
          Nobody&apos;s streaming {title}
          {tab === 'all' ? '' : ` on ${SERVICE_NAME[tab]}`} right now.
        </Text>
      )}
    </Stack>
  );
}
