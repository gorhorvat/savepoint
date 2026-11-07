import { Button, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { BadgeGrid } from '../components/Badges';
import { BADGE_GROUPS, useBadges, type BadgeGroup } from '../lib/badges';
import { fetchFriends, type Friend } from '../lib/friends';
import { loadQuests, useQuests } from '../lib/quests';

/** Locked badges shown per group before "Show more". */
const LOCKED_SHOWN = 6;

/** Every badge you can earn: earned ones with their date, the rest with how to get them. */
export function BadgesPage() {
  const all = useBadges();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [open, setOpen] = useState<Partial<Record<BadgeGroup, boolean>>>({});
  useEffect(() => {
    fetchFriends()
      .then((l) => setFriends(l.friends))
      .catch(() => setFriends(null));
    // Streak badges need the quest streak.
    if (!useQuests.getState().data) void loadQuests();
  }, []);
  const friendCount = (id: string) => (friends ? friends.filter((f) => f.badges?.includes(id)).length : null);
  const earned = all.filter((b) => b.earnedAt).length;

  return (
    <Stack gap={40}>
      <div>
        <Title order={1}>Badges</Title>
        <Text c="dimmed" mt={6} size="lg">
          {earned} of {all.length} earned. Badges come from what your platforms confirm, and stay once earned.
        </Text>
      </div>
      {BADGE_GROUPS.map((group) => {
        const items = all
          .filter((b) => b.group === group)
          // Earned first, then the closest to done.
          .sort(
            (a, b) =>
              Number(!!b.earnedAt) - Number(!!a.earnedAt) ||
              (b.have ?? 0) / (b.need || 1) - (a.have ?? 0) / (a.need || 1),
          );
        if (!items.length) return null;
        // Earned ones and the closest few to go; the rest behind a button.
        const shown = open[group] ? items : items.slice(0, items.filter((b) => b.earnedAt).length + LOCKED_SHOWN);
        return (
          <section key={group} aria-label={group}>
            <Title order={2} mb="sm">
              {group}
            </Title>
            <BadgeGrid items={shown} friendCount={friendCount} />
            {items.length > shown.length && (
              <Button variant="subtle" size="xs" mt="sm" onClick={() => setOpen((o) => ({ ...o, [group]: true }))}>
                Show {items.length - shown.length} more
              </Button>
            )}
          </section>
        );
      })}
    </Stack>
  );
}
