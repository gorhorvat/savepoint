import { Group, SimpleGrid, Stack, Text } from '@mantine/core';
import type { FfxivCharacter, FfxivGear } from '../../lib/gameStats';
import { StatTile } from '../charts';
import { Section } from '../GameSection';
import { Line } from '../StatParts';

const LEFT = ['MAINHAND', 'HEAD', 'BODY', 'HANDS', 'LEGS', 'FEET'];
const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

function Piece({ g }: { g: FfxivGear }) {
  return (
    <Group gap={10} wrap="nowrap" align="flex-start">
      {g.icon ? (
        <img src={g.icon} alt="" width={40} height={40} loading="lazy" style={{ borderRadius: 6, flexShrink: 0 }} />
      ) : (
        <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--sp-raised)', flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0 }}>
        <Text size="xs" c="dimmed">
          {g.slot}
          {g.itemLevel ? ` · item level ${g.itemLevel}` : ''}
        </Text>
        <Text size="sm" fw={600} lineClamp={1}>
          {g.name}
        </Text>
        {(g.glamour || g.dye) && (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {[g.glamour && `Glamour: ${g.glamour}`, g.dye && `Dye: ${g.dye}`].filter(Boolean).join(' · ')}
          </Text>
        )}
        {g.materia.length > 0 && (
          <Text size="xs" c="dimmed" lineClamp={2}>
            {g.materia.join(', ')}
          </Text>
        )}
        {g.crafter && (
          <Text size="xs" c="dimmed">
            Crafted by {g.crafter}
          </Text>
        )}
      </div>
    </Group>
  );
}

/** The gear the character last logged out in, and its attributes. */
export function GearTab({ ch }: { ch: FfxivCharacter }) {
  const gear = ch.gear ?? [];
  const attrs = ch.attributes;
  if (!gear.length && !attrs?.list.length) {
    return <Text c="dimmed">Refresh to read the character&apos;s gear from the Lodestone.</Text>;
  }
  const groups = [...new Set((attrs?.list ?? []).map((x) => x.group))];
  const job = gear.find((g) => g.key === 'SOULCRYSTAL')?.name.replace(/^Soul of the /, '') ?? null;
  return (
    <Stack gap={48}>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatTile label="Average item level" value={fmt(ch.itemLevel)} note={job ? `as ${job}` : undefined} />
        <StatTile label="HP" value={fmt(attrs?.hp)} />
        <StatTile label={attrs?.resource?.name ?? 'MP'} value={fmt(attrs?.resource?.value)} />
        <StatTile label="Current job level" value={fmt(ch.activeJob.level)} />
      </SimpleGrid>
      <Section title="Gear" note="As the character last logged out. Item names and stats from the Lodestone.">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={40} verticalSpacing={18}>
          <Stack gap={18}>
            {gear
              .filter((g) => LEFT.includes(g.key))
              .map((g) => (
                <Piece key={g.key} g={g} />
              ))}
          </Stack>
          <Stack gap={18}>
            {gear
              .filter((g) => !LEFT.includes(g.key))
              .map((g) => (
                <Piece key={g.key} g={g} />
              ))}
          </Stack>
        </SimpleGrid>
      </Section>
      {attrs && attrs.list.length > 0 && (
        <Section title="Attributes">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={20}>
            {groups.map((group) => (
              <Stack key={group} gap={0}>
                <Text fw={700} size="xs" c="dimmed" tt="uppercase" mb={2}>
                  {group}
                </Text>
                {attrs.list
                  .filter((x) => x.group === group)
                  .map((x) => (
                    <Line key={x.name} label={x.name} value={fmt(x.value)} />
                  ))}
              </Stack>
            ))}
          </SimpleGrid>
        </Section>
      )}
    </Stack>
  );
}
