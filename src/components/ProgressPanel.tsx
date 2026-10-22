import { Chip, Group, Rating, Stack, Text, TextInput } from '@mantine/core';
import type { LibraryGame } from '../lib/library';
import { effectiveStatus, STATUS_BY_VALUE, STATUSES } from '../lib/progress';
import { localDay, useStore } from '../lib/store';
import type { PlayStatus } from '../types';

/** Status, star rating and finish date for a game in your library. */
export function ProgressPanel({ item }: { item: LibraryGame }) {
  const setProgress = useStore((s) => s.setProgress);
  const p = item.progress ?? {};
  const { status, guessed } = effectiveStatus(item, item.progress);
  const done = p.status === 'finished' || p.status === 'completed';

  const choose = (value: string) => {
    const next = (value || undefined) as PlayStatus | undefined;
    const finishing = next === 'finished' || next === 'completed';
    setProgress(item.game.id, {
      status: next,
      // Finishing stamps today unless a date is already set; other statuses clear it.
      finishedAt: finishing ? (p.finishedAt ?? localDay()) : undefined,
    });
  };

  return (
    <Stack gap="xs">
      <Chip.Group value={p.status ?? ''} onChange={(v) => choose(v as string)}>
        <Group gap={6} wrap="wrap">
          {STATUSES.map((s) => (
            <Chip
              key={s.value}
              value={s.value}
              size="xs"
              radius="sm"
              color={s.color}
              onClick={() => p.status === s.value && choose('')}
            >
              {s.label}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      {guessed && status && (
        <Text size="xs" c="dimmed">
          Looks like {STATUS_BY_VALUE[status].label.toLowerCase()} from your play time. Pick a status to set it.
        </Text>
      )}
      <Group gap="lg" align="center">
        <Group gap={8} align="center">
          <Text size="sm" c="dimmed">
            Your rating
          </Text>
          <Rating
            value={p.rating ?? 0}
            onChange={(r) => setProgress(item.game.id, { rating: r || undefined })}
            aria-label={`Rate ${item.game.title}`}
          />
        </Group>
        {done && (
          <TextInput
            type="date"
            size="xs"
            label="Finished on"
            value={p.finishedAt ?? ''}
            onChange={(e) => setProgress(item.game.id, { finishedAt: e.currentTarget.value || undefined })}
            w={150}
          />
        )}
      </Group>
      {p.rating && (
        <Text size="xs" c="dimmed">
          Ratings shape Play next: games you rate highly count for more than their hours alone.
        </Text>
      )}
    </Stack>
  );
}
