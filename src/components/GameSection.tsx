import { Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

/** A titled section of a game's stats tab. */
export function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <Title order={2}>{title}</Title>
      {note && (
        <Text size="sm" c="dimmed" mt={4}>
          {note}
        </Text>
      )}
      <div style={{ marginTop: 16 }}>{children}</div>
    </section>
  );
}
