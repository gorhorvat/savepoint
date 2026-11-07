import { Badge, Button, Group, Paper, Progress, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import ICON_SET from '../data/badgeIcons.json';
import {
  BADGE_BY_ID,
  earnedBadges,
  TIER_NAME,
  TIER_XP,
  useBadges,
  type BadgeDef,
  type BadgeStatus,
} from '../lib/badges';

const ICONS = ICON_SET.icons as Record<string, string>;

/** Bronze, silver, gold, platinum, like trophy grades. */
const TIER_COLOR = { 1: '#c0804a', 2: '#a7b1bd', 3: '#e3b23c', 4: '#8fd3f0' } as const;

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** A game-icons.net icon, drawn in the current text colour. */
function GameIcon({ name, size }: { name: string; size: number }) {
  const body = ICONS[name];
  if (!body) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${ICON_SET.size} ${ICON_SET.size}`}
      aria-hidden
      // Static paths from the bundled icon set (scripts/badge-icons.mjs), not user input.
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

/** A badge's round icon, in its tier's colour; grey with a lock while locked. */
export function BadgeIcon({ badge, earned, size = 56 }: { badge: BadgeDef; earned: boolean; size?: number }) {
  const color = TIER_COLOR[badge.tier];
  return (
    <div
      aria-hidden
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        border: `2px solid ${earned ? color : 'var(--sp-line)'}`,
        background: earned
          ? `radial-gradient(circle at 50% 35%, color-mix(in srgb, ${color} 34%, transparent), color-mix(in srgb, ${color} 10%, transparent) 70%)`
          : 'transparent',
        boxShadow: earned && badge.tier === 4 ? `0 0 12px color-mix(in srgb, ${color} 45%, transparent)` : undefined,
        color: earned ? color : 'var(--mantine-color-dimmed)',
        opacity: earned ? 1 : 0.6,
      }}
    >
      <GameIcon name={badge.icon} size={Math.round(size * 0.58)} />
      {!earned && (
        <IconLock
          size={size * 0.28}
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            background: 'var(--mantine-color-body)',
            borderRadius: '50%',
            padding: 2,
          }}
        />
      )}
    </div>
  );
}

/** A row of earned badges (newest first), each named in a tooltip. */
export function BadgeRow({ items }: { items: { id: string; earnedAt: string }[] }) {
  const known = items.filter((b) => BADGE_BY_ID.has(b.id));
  if (!known.length) return null;
  return (
    <Group gap="md" align="flex-start">
      {known.map((b) => {
        const def = BADGE_BY_ID.get(b.id)!;
        return (
          <Tooltip key={b.id} label={`${def.name} · ${def.hint} · ${dateOf(b.earnedAt)}`} withArrow multiline maw={260}>
            <Stack gap={4} align="center" w={72} tabIndex={0} aria-label={`${def.name}, earned ${dateOf(b.earnedAt)}`}>
              <BadgeIcon badge={def} earned size={52} />
              <Text size="xs" fw={600} ta="center" lineClamp={2} lh={1.2}>
                {def.name}
              </Text>
            </Stack>
          </Tooltip>
        );
      })}
    </Group>
  );
}

/** Your latest badges on Profile, with a link to all of them. */
export function BadgesSection() {
  const all = useBadges();
  const earned = earnedBadges(all);
  return (
    <section aria-label="Badges">
      <Group justify="space-between" align="baseline" mb="sm">
        <Title order={2}>Badges</Title>
        <Button component={Link} to="/badges" variant="subtle" size="xs">
          All badges ({earned.length.toLocaleString()} of {all.length.toLocaleString()})
        </Button>
      </Group>
      {earned.length ? (
        <BadgeRow items={earned.slice(0, 8).map((b) => ({ id: b.id, earnedAt: b.earnedAt! }))} />
      ) : (
        <Text c="dimmed">No badges yet. Open All badges to see what earns them.</Text>
      )}
    </section>
  );
}

/** One badge on the Badges page: tier and XP, earned date or how far along you are. */
export function BadgeCard({ b, friends }: { b: BadgeStatus; friends: number | null }) {
  const earned = !!b.earnedAt;
  return (
    <Paper p="md">
      <Group gap="md" wrap="nowrap" align="flex-start">
        <BadgeIcon badge={b} earned={earned} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap" justify="space-between" align="flex-start">
            <Text fw={700} style={{ minWidth: 0 }}>
              {b.name}
            </Text>
            <Badge
              size="xs"
              radius="xs"
              variant="light"
              tt="none"
              className="num"
              style={{
                flexShrink: 0,
                color: TIER_COLOR[b.tier],
                background: 'transparent',
                border: `1px solid ${TIER_COLOR[b.tier]}`,
              }}
            >
              {TIER_NAME[b.tier]} · {TIER_XP[b.tier]} XP
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {b.hint}
          </Text>
          {earned ? (
            <Text size="sm" fw={600} mt={6}>
              Earned {dateOf(b.earnedAt!)}
            </Text>
          ) : b.have != null && b.need != null && b.need > 1 ? (
            <Stack gap={4} mt={8}>
              <Progress value={(b.have / b.need) * 100} size="sm" radius="xl" aria-hidden />
              <Text size="xs" c="dimmed" className="num">
                {b.have.toLocaleString()} of {b.need.toLocaleString()}
              </Text>
            </Stack>
          ) : null}
          {friends != null && friends > 0 && (
            <Text size="xs" c="dimmed" mt={4}>
              {friends === 1 ? '1 friend has it' : `${friends} friends have it`}
            </Text>
          )}
        </div>
      </Group>
    </Paper>
  );
}

export function BadgeGrid({
  items,
  friendCount,
}: {
  items: BadgeStatus[];
  friendCount: (id: string) => number | null;
}) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
      {items.map((b) => (
        <BadgeCard key={b.id} b={b} friends={friendCount(b.id)} />
      ))}
    </SimpleGrid>
  );
}
