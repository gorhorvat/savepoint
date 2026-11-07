import { Anchor, Button, Group, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { BadgeGrid } from '../components/Badges';
import { BADGE_GROUPS, TIER_XP, useBadges, type BadgeGroup } from '../lib/badges';
import { fetchFriends, type Friend } from '../lib/friends';
import { loadQuests, useQuests } from '../lib/quests';

/** Locked badges shown per group at first, and how many more each "Show more" adds. */
const LOCKED_SHOWN = 6;
const MORE = 24;

type Show = 'all' | 'earned' | 'locked';

/** Every badge you can earn: earned ones with their date, the rest with how to get them. */
export function BadgesPage() {
  const all = useBadges();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [extra, setExtra] = useState<Partial<Record<BadgeGroup, number>>>({});
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('all');
  useEffect(() => {
    fetchFriends()
      .then((l) => setFriends(l.friends))
      .catch(() => setFriends(null));
    // Streak badges need the quest streak.
    if (!useQuests.getState().data) void loadQuests();
  }, []);
  const friendCount = (id: string) => (friends ? friends.filter((f) => f.badges?.includes(id)).length : null);
  const earned = all.filter((b) => b.earnedAt);
  const xp = earned.reduce((sum, b) => sum + TIER_XP[b.tier], 0);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      all.filter(
        (b) =>
          (show === 'all' || (show === 'earned') === !!b.earnedAt) &&
          (!query || b.name.toLowerCase().includes(query) || b.hint.toLowerCase().includes(query)),
      ),
    [all, show, query],
  );
  const searching = !!query || show !== 'all';

  return (
    <Stack gap={40}>
      <div>
        <Title order={1}>Badges</Title>
        <Text c="dimmed" mt={6} size="lg">
          {earned.length.toLocaleString()} of {all.length.toLocaleString()} earned, worth {xp.toLocaleString()} XP.
          Badges come from what your platforms confirm, and stay once earned.
        </Text>
        <Group mt="md" gap="sm" wrap="wrap">
          <TextInput
            placeholder="Find a badge"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: '1 1 220px', maxWidth: 360 }}
            aria-label="Find a badge"
          />
          <SegmentedControl
            value={show}
            onChange={(v) => setShow(v as Show)}
            data={[
              { value: 'all', label: 'All' },
              { value: 'earned', label: 'Earned' },
              { value: 'locked', label: 'To earn' },
            ]}
          />
        </Group>
      </div>
      {!filtered.length && <Text c="dimmed">No badges match. Try another word, or show All.</Text>}
      {BADGE_GROUPS.map((group) => {
        const items = filtered
          .filter((b) => b.group === group)
          // Earned first (newest first), then the closest to done.
          .sort(
            (a, b) =>
              Number(!!b.earnedAt) - Number(!!a.earnedAt) ||
              (b.earnedAt ?? '').localeCompare(a.earnedAt ?? '') ||
              (b.have ?? 0) / (b.need || 1) - (a.have ?? 0) / (a.need || 1) ||
              a.tier - b.tier,
          );
        if (!items.length) return null;
        const earnedHere = items.filter((b) => b.earnedAt).length;
        // Earned ones and the closest few to go (more when filtering); the rest behind a button.
        const limit = (searching ? MORE : earnedHere + LOCKED_SHOWN) + (extra[group] ?? 0);
        const shown = items.slice(0, limit);
        return (
          <section key={group} aria-label={group}>
            <Group justify="space-between" align="baseline" mb="sm">
              <Title order={2}>{group}</Title>
              <Text size="sm" c="dimmed" className="num">
                {all.filter((b) => b.group === group && b.earnedAt).length.toLocaleString()} of{' '}
                {all.filter((b) => b.group === group).length.toLocaleString()}
              </Text>
            </Group>
            <BadgeGrid items={shown} friendCount={friendCount} />
            {items.length > shown.length && (
              <Button
                variant="subtle"
                size="xs"
                mt="sm"
                onClick={() => setExtra((e) => ({ ...e, [group]: (e[group] ?? 0) + MORE }))}
              >
                Show {Math.min(MORE, items.length - shown.length)} more of {items.length - shown.length}
              </Button>
            )}
          </section>
        );
      })}
      <Text size="xs" c="dimmed">
        Badge icons by Lorc, Delapouite and contributors from{' '}
        <Anchor href="https://game-icons.net" target="_blank" rel="noreferrer" size="xs">
          game-icons.net
        </Anchor>
        , under{' '}
        <Anchor href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer" size="xs">
          CC BY 3.0
        </Anchor>
        .
      </Text>
    </Stack>
  );
}
