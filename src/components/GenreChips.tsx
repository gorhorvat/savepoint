import { Badge, Group, Tooltip } from '@mantine/core';
import { IconHeartFilled } from '@tabler/icons-react';
import { favoriteFranchise, isFavoriteGenre, useFavorites } from '../lib/favorites';
import type { Game } from '../types';

/**
 * Genres as solid chips, sub-genres as outlined ones, so the hierarchy reads at
 * a glance. Your favourite genres (Profile page) come first, in rose with a heart.
 */
export function GenreChips({ game, limit, size = 'sm' }: { game: Game; limit?: number; size?: 'xs' | 'sm' | 'md' }) {
  const favorites = useFavorites();
  const genres = game.genres.map((g) => ({ g, sub: false }));
  const subs = game.subgenres.map((g) => ({ g, sub: true }));
  let all = [...genres, ...subs]
    .map((x) => ({ ...x, fav: isFavoriteGenre(x.g, favorites) }))
    // Favourites first, so a limit never hides them.
    .sort((a, b) => Number(b.fav) - Number(a.fav));
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
      {all.map(({ g, sub, fav }) =>
        fav ? (
          <Tooltip key={`${sub}-${g}`} label="One of your favourite genres" withArrow>
            <Badge
              size={size}
              radius="xs"
              tt="none"
              fw={600}
              className="fav-chip"
              leftSection={<IconHeartFilled size={size === 'xs' ? 9 : 11} />}
            >
              {g}
            </Badge>
          </Tooltip>
        ) : (
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
        ),
      )}
      {hidden > 0 && (
        <Badge size={size} radius="xs" tt="none" variant="transparent" color="gray">
          +{hidden}
        </Badge>
      )}
    </Group>
  );
}

/** "♥ Resident Evil" when a game belongs to one of your favourite franchises. */
export function FranchiseBadge({ game, size = 'sm' }: { game: Game; size?: 'xs' | 'sm' | 'md' }) {
  const favorites = useFavorites();
  const franchise = favoriteFranchise(game, favorites);
  if (!franchise) return null;
  return (
    <Tooltip label="One of your favourite franchises" withArrow>
      <Badge
        size={size}
        radius="xs"
        tt="none"
        fw={600}
        className="fav-chip"
        leftSection={<IconHeartFilled size={size === 'xs' ? 9 : 11} />}
        style={{ flexShrink: 0 }}
      >
        {franchise}
      </Badge>
    </Tooltip>
  );
}
