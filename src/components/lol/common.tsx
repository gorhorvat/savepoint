import { Avatar, Tooltip } from '@mantine/core';
import type { LolThing } from '../../lib/gameStats';

export function Champ({ image, size = 28, label }: { image: string | null; size?: number; label?: string }) {
  const a = <Avatar src={image} size={size} radius="sm" style={{ flexShrink: 0 }} alt={label ?? ''} />;
  return label ? <Tooltip label={label}>{a}</Tooltip> : a;
}

/** A small square picture (item, spell, rune) with its name on hover; an empty slot when null. */
export function Icon({
  thing,
  size = 22,
  round = false,
}: {
  thing: LolThing | null | undefined;
  size?: number;
  round?: boolean;
}) {
  if (!thing?.image) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: round ? '50%' : 4,
          background: 'var(--sp-raised)',
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <Tooltip label={thing.name}>
      <img
        src={thing.image}
        alt={thing.name}
        width={size}
        height={size}
        loading="lazy"
        style={{ borderRadius: round ? '50%' : 4, flexShrink: 0, display: 'block' }}
      />
    </Tooltip>
  );
}

export { Heading, Line, Meter } from '../StatParts';
