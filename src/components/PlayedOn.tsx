import { Group, Text } from '@mantine/core';
import type { PlatformPlay } from '../lib/library';
import type { PlatformId } from '../types';
import { PlatformIcon } from './PlatformBadge';

/** The platforms a game was played on, most recently played first. */
function playedOn(plays: PlatformPlay[]): PlatformId[] {
  const sorted = plays
    .filter((p) => p.minutes > 0 || p.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? '') || b.minutes - a.minutes);
  return [...new Set(sorted.map((p) => p.platform))];
}

/** A shelf tile's second line: the platform logos, then the text ("12 h, today"). */
export function PlayedOnLine({ plays, children }: { plays: PlatformPlay[]; children: string }) {
  const platforms = playedOn(plays);
  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      {platforms.length > 0 && (
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {platforms.map((p) => (
            <PlatformIcon key={p} platform={p} size={13} label />
          ))}
        </Group>
      )}
      <Text size="sm" c="dimmed" truncate>
        {children}
      </Text>
    </Group>
  );
}
