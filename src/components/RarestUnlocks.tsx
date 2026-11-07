import { Avatar, Badge, Group, Paper, Text, Title, UnstyledButton } from '@mantine/core';
import { IconTrophy } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { PLATFORM_BY_ID } from '../data/platforms';
import { bandOf, pctLabel, useRarestUnlocks } from '../lib/rarity';
import type { PlatformId } from '../types';
import { PlatformIcon } from './PlatformBadge';

export interface RareRow {
  name: string;
  icon: string | null;
  rarity: number;
  earnedAt?: string;
  title: string;
  platform: string;
}

/** A small band badge: "Ultra rare · 2.1%". */
export function RarityBadge({ pct, size = 'sm' }: { pct: number; size?: 'xs' | 'sm' }) {
  const band = bandOf(pct);
  if (!band) return null;
  return (
    <Badge
      size={size}
      variant="light"
      color={band.color}
      radius="xs"
      tt="none"
      className="num"
      style={{ flexShrink: 0 }}
    >
      {band.label} · {pctLabel(pct)}
    </Badge>
  );
}

/** The rarest achievements someone has earned, each opening its game. */
export function RarestUnlocks<T extends RareRow>({
  items,
  onOpen,
  title = 'Rarest unlocks',
}: {
  items: T[];
  onOpen?: (item: T) => void;
  title?: string;
}) {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <Title order={2} mb="sm">
        {title}
      </Title>
      <Paper px={{ base: 'md', sm: 'lg' }} py={4}>
        {items.map((a, i) => {
          const platform = a.platform in PLATFORM_BY_ID ? (a.platform as PlatformId) : null;
          const body = (
            <Group gap="sm" wrap="nowrap" py={10}>
              <Avatar src={a.icon} radius="sm" size={44} alt="" style={{ flexShrink: 0 }}>
                <IconTrophy size={20} />
              </Avatar>
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text fw={600} size="sm" lineClamp={1}>
                  {a.name}
                </Text>
                <Group gap={6} wrap="nowrap">
                  {platform && <PlatformIcon platform={platform} size={12} />}
                  <Text size="xs" c="dimmed" truncate>
                    {a.title}
                  </Text>
                </Group>
              </div>
              <RarityBadge pct={a.rarity} />
            </Group>
          );
          return (
            <div key={`${a.title}-${a.name}-${i}`} style={i ? { borderTop: '1px solid var(--sp-line)' } : undefined}>
              {onOpen ? (
                <UnstyledButton onClick={() => onOpen(a)} display="block" w="100%" aria-label={`${a.name}, ${a.title}`}>
                  {body}
                </UnstyledButton>
              ) : (
                body
              )}
            </div>
          );
        })}
      </Paper>
    </section>
  );
}

/** Your own rarest unlocks, on Profile. */
export function MyRarestUnlocks() {
  const items = useRarestUnlocks(5);
  const navigate = useNavigate();
  return <RarestUnlocks items={items} onOpen={(a) => navigate(`/game/${a.gameId}`)} />;
}
