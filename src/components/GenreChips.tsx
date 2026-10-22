import { Badge, Group } from '@mantine/core';
import type { Game } from '../types';

/** Genres as solid chips, sub-genres as outlined ones, so the hierarchy reads at a glance. */
export function GenreChips({ game, limit, size = 'sm' }: { game: Game; limit?: number; size?: 'xs' | 'sm' | 'md' }) {
  const genres = game.genres.map((g) => ({ g, sub: false }));
  const subs = game.subgenres.map((g) => ({ g, sub: true }));
  let all = [...genres, ...subs];
  const hidden = limit && all.length > limit ? all.length - limit : 0;
  if (limit) all = all.slice(0, limit);
  if (!all.length) {
    return (
      <Badge size={size} variant="outline" color="gray" radius="xs" tt="none">
        {game.custom && !game.genreSource ? 'Looking up genres' : 'No genres yet'}
      </Badge>
    );
  }
  return (
    <Group gap={4} wrap="wrap">
      {all.map(({ g, sub }) => (
        <Badge
          key={`${sub}-${g}`}
          size={size}
          radius="xs"
          tt="none"
          fw={500}
          variant={sub ? 'outline' : 'light'}
          color={sub ? 'gray' : 'cartridge'}
          style={sub ? { borderColor: 'var(--sp-muted)', color: 'var(--sp-ink)' } : undefined}
        >
          {g}
        </Badge>
      ))}
      {hidden > 0 && (
        <Badge size={size} radius="xs" tt="none" variant="transparent" color="gray">
          +{hidden}
        </Badge>
      )}
    </Group>
  );
}
