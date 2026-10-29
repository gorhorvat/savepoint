import { Avatar, Group, Text, Tooltip } from '@mantine/core';
import type { ReactNode } from 'react';
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

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text fw={700} size="xs" c="dimmed" tt="uppercase" mb={2}>
      {children}
    </Text>
  );
}

export function Line({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <Group justify="space-between" gap={6} wrap="nowrap" mih={22}>
      <Text size="sm" truncate component="div">
        {label}
      </Text>
      <Text size="sm" className="num" style={{ flexShrink: 0 }}>
        {value}
      </Text>
    </Group>
  );
}

/** A thin progress bar. */
export function Meter({ value, max, color }: { value: number; max: number; color?: string }) {
  return (
    <div className="strip-track" style={{ height: 6 }}>
      <div
        style={{
          width: `${Math.min(100, Math.max(value > 0 ? 1.5 : 0, (value / Math.max(1, max)) * 100))}%`,
          height: '100%',
          borderRadius: '0 3px 3px 0',
          background: color ?? 'var(--mantine-primary-color-filled)',
        }}
      />
    </div>
  );
}
