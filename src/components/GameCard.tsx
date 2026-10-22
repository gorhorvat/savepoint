import { Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Game } from '../types';
import { Cover } from './Cover';
import { GenreChips } from './GenreChips';
import { PlatformList } from './PlatformBadge';
import { WishlistButton } from './WishlistButton';

/** Compact tile for games you haven't played: cover, genres, where it's available. */
export function GameCard({ game, note, actions }: { game: Game; note?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack gap={8}>
      <Link to={`/game/${game.id}`} aria-label={game.title} style={{ display: 'block' }}>
        <Cover game={game} width="100%" radius={10} />
      </Link>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap={4}>
        <div style={{ minWidth: 0 }}>
          <Text
            component={Link}
            to={`/game/${game.id}`}
            fw={600}
            lh={1.25}
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            {game.title}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {[game.developer, game.year].filter(Boolean).join(', ')}
          </Text>
        </div>
        <Group gap={0} wrap="nowrap">
          {actions}
          <WishlistButton game={game} iconOnly />
        </Group>
      </Group>
      {note}
      <GenreChips game={game} limit={4} size="xs" />
      <PlatformList platforms={game.availableOn} switchVersions={game.switchVersions} />
    </Stack>
  );
}
