import { ActionIcon, Button, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHeart, IconHeartFilled } from '@tabler/icons-react';
import { useStore } from '../lib/store';
import type { Game } from '../types';

export function WishlistButton({ game, iconOnly }: { game: Game; iconOnly?: boolean }) {
  const on = useStore((s) => s.wishlist.some((w) => w.gameId === game.id));
  const toggle = useStore((s) => s.toggleWishlist);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const added = toggle(game.id);
    notifications.show({
      message: added ? `Added ${game.title} to your wishlist` : `Removed ${game.title} from your wishlist`,
      autoClose: 2200,
    });
  };

  if (iconOnly) {
    const label = on ? 'Remove from wishlist' : 'Add to wishlist';
    return (
      <Tooltip label={label}>
        <ActionIcon
          variant={on ? 'light' : 'subtle'}
          color={on ? 'red' : 'gray'}
          onClick={onClick}
          aria-label={`${label}: ${game.title}`}
          aria-pressed={on}
          size="lg"
        >
          {on ? <IconHeartFilled size={18} /> : <IconHeart size={18} />}
        </ActionIcon>
      </Tooltip>
    );
  }
  return (
    <Button
      variant={on ? 'light' : 'filled'}
      color={on ? 'red' : undefined}
      leftSection={on ? <IconHeartFilled size={18} /> : <IconHeart size={18} />}
      onClick={onClick}
      aria-pressed={on}
    >
      {on ? 'On your wishlist' : 'Add to wishlist'}
    </Button>
  );
}
