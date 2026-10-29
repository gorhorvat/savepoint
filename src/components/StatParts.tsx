import { Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';

// Small pieces shared by the game stats tabs.

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text fw={700} size="xs" c="dimmed" tt="uppercase" mb={2}>
      {children}
    </Text>
  );
}

export function Line({ label, value, icon }: { label: ReactNode; value: ReactNode; icon?: ReactNode }) {
  return (
    <Group justify="space-between" gap={6} wrap="nowrap" mih={22}>
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        {icon}
        <Text size="sm" truncate component="div">
          {label}
        </Text>
      </Group>
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
