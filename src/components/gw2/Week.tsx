import { Badge, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import type { Gw2Account, Gw2Done, Gw2Vault } from '../../lib/gameStats';
import { Section } from '../GameSection';
import { Heading, Line, Meter } from '../StatParts';
import { fmt } from './format';

function Done({ item, bold }: { item: Gw2Done; bold?: boolean }) {
  return (
    <Group gap={6} wrap="nowrap" mih={22}>
      {item.done ? (
        <IconCheck size={15} color="var(--mantine-color-teal-5)" style={{ flexShrink: 0 }} aria-label="Done" />
      ) : (
        <span style={{ width: 15, flexShrink: 0 }} />
      )}
      <Text size="sm" c={item.done ? undefined : 'dimmed'} fw={bold ? 600 : undefined} truncate>
        {item.name}
      </Text>
    </Group>
  );
}

function Vault({ title, v, note }: { title: string; v: Gw2Vault | null; note: string }) {
  if (!v) return null;
  return (
    <div>
      <Group justify="space-between" gap="sm">
        <Heading>{title}</Heading>
        {v.complete != null && (
          <Text size="xs" c="dimmed" className="num">
            {v.current} / {v.complete}
            {v.claimed ? ' · claimed' : ''}
          </Text>
        )}
      </Group>
      <Text size="xs" c="dimmed" mb={8}>
        {note}
      </Text>
      <Stack gap={10}>
        {v.objectives.map((o, i) => (
          <div key={i}>
            <Group justify="space-between" gap="sm" wrap="nowrap">
              <Text size="sm" c={o.claimed ? 'dimmed' : undefined} lineClamp={1}>
                {o.title}
              </Text>
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Badge size="xs" variant="outline" color="gray" radius="xs">
                  {o.track}
                </Badge>
                <Text size="xs" c="dimmed" className="num">
                  {o.acclaim} AA
                </Text>
              </Group>
            </Group>
            <div style={{ marginTop: 4 }}>
              <Meter
                value={o.progress}
                max={o.complete}
                color={o.claimed ? 'var(--mantine-color-teal-5)' : undefined}
              />
            </div>
          </div>
        ))}
      </Stack>
    </div>
  );
}

const count = (list: Gw2Done[] | null) => (list ? `${list.filter((x) => x.done).length} of ${list.length} done` : '');

/** Daily and weekly progress: Wizard's Vault, raids, dungeons, world bosses and more. */
export function WeekTab({ a }: { a: Gw2Account }) {
  const w = a.weekly;
  if (!w) return <Text c="dimmed">Needs the progression permission on the API key. Refresh after adding it.</Text>;
  const vault = w.vault;
  return (
    <Stack gap={48}>
      {(vault.daily || vault.weekly || vault.special) && (
        <Section title="Wizard's Vault" note="Objectives and astral acclaim, as of the last refresh.">
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing={40}>
            <Vault title="Daily" v={vault.daily} note="Resets every day at 00:00 UTC." />
            <Vault title="Weekly" v={vault.weekly} note="Resets on Monday at 07:30 UTC." />
            <Vault title="Special" v={vault.special} note="For the current season." />
          </SimpleGrid>
        </Section>
      )}

      {w.raids && (
        <Section
          title="Raids this week"
          note={`${w.raids.flatMap((r) => r.wings.flatMap((x) => x.events)).filter((e) => e.done).length} encounters cleared. Resets on Monday at 07:30 UTC.`}
        >
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing={28} verticalSpacing={24}>
            {w.raids.flatMap((r) =>
              r.wings.map((wing) => (
                <Stack key={wing.name} gap={0}>
                  <Heading>{wing.name}</Heading>
                  {wing.events.map((e) => (
                    <Done key={e.name} item={e} bold={e.boss} />
                  ))}
                </Stack>
              )),
            )}
          </SimpleGrid>
        </Section>
      )}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} verticalSpacing={48}>
        {w.worldBosses && (
          <Section title="World bosses today" note={count(w.worldBosses)}>
            <SimpleGrid cols={2} spacing={16} verticalSpacing={0}>
              {w.worldBosses.map((b) => (
                <Done key={b.name} item={b} />
              ))}
            </SimpleGrid>
          </Section>
        )}
        {w.dungeons && (
          <Section
            title="Dungeons today"
            note={`${w.dungeons.flatMap((d) => d.paths).filter((p) => p.done).length} paths done.`}
          >
            <SimpleGrid cols={2} spacing={16} verticalSpacing={12}>
              {w.dungeons.map((d) => (
                <Stack key={d.name} gap={0}>
                  <Text size="sm" fw={600}>
                    {d.name}
                  </Text>
                  {d.paths.map((p) => (
                    <Done key={p.name} item={p} />
                  ))}
                </Stack>
              ))}
            </SimpleGrid>
          </Section>
        )}
        {w.mapChests && (
          <Section title="Map meta chests today" note={count(w.mapChests)}>
            <Stack gap={0}>
              {w.mapChests.map((m) => (
                <Done key={m.name} item={m} />
              ))}
            </Stack>
          </Section>
        )}
        <Section title="Crafting and home">
          <Stack gap={4}>
            {w.crafting && (
              <>
                <Heading>Daily crafting ({count(w.crafting)})</Heading>
                {w.crafting.map((m) => (
                  <Done key={m.name} item={m} />
                ))}
              </>
            )}
            <Heading>Home instance</Heading>
            {w.home.nodes && (
              <Line label="Gathering nodes" value={`${fmt(w.home.nodes.owned)} / ${fmt(w.home.nodes.total)}`} />
            )}
            {w.home.cats && <Line label="Cats" value={`${fmt(w.home.cats.owned)} / ${fmt(w.home.cats.total)}`} />}
          </Stack>
        </Section>
      </SimpleGrid>
    </Stack>
  );
}
