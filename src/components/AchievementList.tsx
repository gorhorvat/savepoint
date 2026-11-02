import {
  Avatar,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconLock, IconTrophy } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { PLATFORM_BY_ID } from '../data/platforms';
import { fetchAchievementList, type AchievementItem } from '../lib/api';
import type { PlatformId } from '../types';
import { PlatformIcon } from './PlatformBadge';

export interface AchievementSource {
  platform: PlatformId;
  /** The server address of this platform's list for the game. */
  url: string;
}

const SHOWN = 24;

const GRADE_COLOR: Record<string, string> = {
  bronze: '#c0804a',
  silver: '#a7b1bd',
  gold: '#e3b23c',
  platinum: '#8fd3f0',
};

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Earned first (newest first), then locked ones, most commonly earned first. */
function sorted(items: AchievementItem[]) {
  return [...items].sort((a, b) => {
    const ea = a.earnedAt !== null;
    const eb = b.earnedAt !== null;
    if (ea !== eb) return ea ? -1 : 1;
    if (ea) return (b.earnedAt ?? '').localeCompare(a.earnedAt ?? '');
    return (b.rarity ?? -1) - (a.rarity ?? -1);
  });
}

function Row({ a }: { a: AchievementItem }) {
  const earned = a.earnedAt !== null;
  const secret = a.hidden && !earned;
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start" py={8} style={{ borderTop: '1px solid var(--sp-line)' }}>
      <Avatar
        src={secret ? null : a.icon}
        radius="sm"
        size={44}
        style={{ filter: earned ? undefined : 'grayscale(1)', opacity: earned ? 1 : 0.55, flexShrink: 0 }}
        alt=""
      >
        {earned ? <IconTrophy size={20} /> : <IconLock size={18} />}
      </Avatar>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Group gap={6} wrap="nowrap" align="flex-start">
          {a.grade && GRADE_COLOR[a.grade] && (
            <IconTrophy size={14} color={GRADE_COLOR[a.grade]} aria-label={a.grade} style={{ flexShrink: 0 }} />
          )}
          <Text fw={600} size="sm" c={earned ? undefined : 'dimmed'} lineClamp={2} style={{ minWidth: 0 }}>
            {secret ? 'Hidden achievement' : a.name}
          </Text>
          {a.hardcore && (
            <Badge size="xs" variant="light" radius="xs" tt="none" style={{ flexShrink: 0 }} mt={2}>
              Hardcore
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed" lineClamp={2}>
          {secret ? 'Its details appear once you unlock it.' : a.description}
        </Text>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <Text size="xs" fw={earned ? 600 : 400} c={earned ? undefined : 'dimmed'}>
          {earned ? (a.earnedAt ? dateOf(a.earnedAt) : 'Earned') : 'Locked'}
        </Text>
        <Text size="xs" c="dimmed" className="num">
          {[a.points ? `${a.points} pts` : null, a.rarity != null ? `${a.rarity}% of players` : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </div>
    </Group>
  );
}

/** Every achievement of a game, per platform you play it on. */
export function AchievementList({ sources }: { sources: AchievementSource[] }) {
  const [platform, setPlatform] = useState<PlatformId | null>(sources[0]?.platform ?? null);
  const [lists, setLists] = useState<Record<string, AchievementItem[] | { error: string }>>({});
  const [all, setAll] = useState(false);
  const current = sources.find((s) => s.platform === platform) ?? sources[0];
  const list = current ? lists[current.url] : undefined;

  useEffect(() => {
    if (!current || lists[current.url]) return;
    let live = true;
    fetchAchievementList(current.url)
      .then((items) => live && setLists((l) => ({ ...l, [current.url]: items })))
      .catch((e: Error) => live && setLists((l) => ({ ...l, [current.url]: { error: e.message } })));
    return () => {
      live = false;
    };
  }, [current, lists]);

  const items = useMemo(() => (Array.isArray(list) ? sorted(list) : []), [list]);
  if (!current) return null;
  const earned = items.filter((a) => a.earnedAt !== null).length;

  return (
    <Paper p={{ base: 'md', sm: 'xl' }}>
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Title order={2}>Achievements</Title>
        {sources.length > 1 && (
          <SegmentedControl
            size="xs"
            value={current.platform}
            onChange={(v) => {
              setPlatform(v as PlatformId);
              setAll(false);
            }}
            data={sources.map((s) => ({
              value: s.platform,
              label: (
                <Group gap={6} wrap="nowrap">
                  <PlatformIcon platform={s.platform} size={14} />
                  <span>{PLATFORM_BY_ID[s.platform].short}</span>
                </Group>
              ),
            }))}
          />
        )}
      </Group>
      {!list ? (
        <Loader size="sm" mt="lg" />
      ) : !Array.isArray(list) ? (
        <Text size="sm" c="dimmed" mt="md">
          Couldn&apos;t load the list from {PLATFORM_BY_ID[current.platform].name}: {list.error}
        </Text>
      ) : !items.length ? (
        <Text size="sm" c="dimmed" mt="md">
          {PLATFORM_BY_ID[current.platform].name} lists no achievements for this game.
        </Text>
      ) : (
        <Stack gap={0} mt="md">
          <Group justify="space-between" mb={6}>
            <Text size="sm" c="dimmed" className="num">
              {earned} of {items.length} earned on {PLATFORM_BY_ID[current.platform].name}
            </Text>
            <Text size="sm" fw={600} className="num">
              {Math.round((earned / items.length) * 100)}%
            </Text>
          </Group>
          <Progress value={(earned / items.length) * 100} size="sm" radius="xl" mb="sm" aria-hidden />
          {(all ? items : items.slice(0, SHOWN)).map((a, i) => (
            <Row key={`${a.name}-${i}`} a={a} />
          ))}
          {items.length > SHOWN && (
            <Button variant="subtle" size="xs" mt="xs" w="fit-content" onClick={() => setAll((x) => !x)}>
              {all ? 'Show fewer' : `Show all ${items.length}`}
            </Button>
          )}
        </Stack>
      )}
    </Paper>
  );
}
