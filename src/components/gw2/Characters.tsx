import { Badge, Group, Loader, Paper, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { fetchGw2Character, type Gw2Character, type Gw2CharacterDetails } from '../../lib/gameStats';
import { Heading, Line } from '../StatParts';
import { date, fmt } from './format';
import { Img } from './parts';

const SLOTS: [string, string[]][] = [
  ['Armor', ['Helm', 'Shoulders', 'Coat', 'Gloves', 'Leggings', 'Boots', 'HelmAquatic']],
  ['Weapons', ['WeaponA1', 'WeaponA2', 'WeaponB1', 'WeaponB2', 'WeaponAquaticA', 'WeaponAquaticB']],
  ['Trinkets', ['Backpack', 'Accessory1', 'Accessory2', 'Amulet', 'Ring1', 'Ring2', 'Relic']],
  [
    'Tools',
    ['Sickle', 'Axe', 'Pick', 'PowerCore', 'SensoryArray', 'ServiceChip', 'FishingRod', 'FishingBait', 'FishingLure'],
  ],
];
const SLOT_NAMES: Record<string, string> = {
  HelmAquatic: 'Breather',
  WeaponA1: 'Weapon set 1',
  WeaponA2: 'Weapon set 1, off hand',
  WeaponB1: 'Weapon set 2',
  WeaponB2: 'Weapon set 2, off hand',
  WeaponAquaticA: 'Aquatic weapon 1',
  WeaponAquaticB: 'Aquatic weapon 2',
  Backpack: 'Back',
  Accessory1: 'Accessory',
  Accessory2: 'Accessory',
  Ring1: 'Ring',
  Ring2: 'Ring',
  PowerCore: 'Power core',
  SensoryArray: 'Sensory array',
  ServiceChip: 'Service chip',
  FishingRod: 'Fishing rod',
  FishingBait: 'Bait',
  FishingLure: 'Lure',
};

function Details({ c }: { c: Gw2Character }) {
  const [d, setD] = useState<Gw2CharacterDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGw2Character(c.name)
      .then(setD)
      .catch((e: Error) => setError(e.message));
  }, [c.name]);

  if (error)
    return (
      <Text size="sm" c="red" py="sm">
        {error}
      </Text>
    );
  if (!d) return <Loader size="sm" my="sm" />;

  const bySlot = new Map(d.equipment.map((e) => [e.slot, e]));
  const g = c.gear;
  return (
    <Paper p="md" mt="xs" mb="md" withBorder>
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={32}>
          <div>
            <Heading>
              Build{g?.buildName ? `: ${g.buildName}` : ''}
              {g?.buildTabs && g.buildTabs > 1 ? ` (${g.buildTabs} build tabs)` : ''}
            </Heading>
            <Stack gap={8} mt={6}>
              {d.specializations.map((s) => (
                <Group key={s.id} gap={8} wrap="nowrap">
                  <Img src={s.icon} name={s.name} size={30} />
                  <Text size="sm" fw={600} w={130} truncate>
                    {s.name}
                    {s.elite && (
                      <Badge component="span" size="xs" variant="light" radius="xs" ml={6}>
                        Elite
                      </Badge>
                    )}
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    {s.traits.map((t, i) => (
                      <Img key={i} src={t?.icon} name={t?.name} size={26} style={{ borderRadius: '50%' }} />
                    ))}
                  </Group>
                </Group>
              ))}
              {!d.specializations.length && (
                <Text size="sm" c="dimmed">
                  No build (needs the builds permission).
                </Text>
              )}
            </Stack>
            {d.skills && (
              <Group gap={4} mt="md" wrap="nowrap">
                <Img src={d.skills.heal?.icon} name={d.skills.heal?.name} size={34} />
                <span style={{ width: 6 }} />
                {d.skills.utilities.map((s, i) => (
                  <Img key={i} src={s?.icon} name={s?.name} size={34} />
                ))}
                <span style={{ width: 6 }} />
                <Img src={d.skills.elite?.icon} name={d.skills.elite?.name} size={34} />
              </Group>
            )}
          </div>
          <Stack gap={4}>
            <Heading>Character</Heading>
            <Line label="Created" value={date(c.created)} />
            <Line label="Last played" value={date(c.lastPlayed)} />
            <Line label="Played" value={`${fmt(c.hours)} h`} />
            <Line label="Deaths" value={fmt(c.deaths)} />
            {g?.bags && (
              <Line label="Bags" value={`${g.bags.bags} bags · ${g.bags.used} / ${g.bags.slots} slots used`} />
            )}
            {c.crafting.map((x) => (
              <Line key={x.discipline} label={`${x.discipline}${x.active ? '' : ' (inactive)'}`} value={x.rating} />
            ))}
          </Stack>
        </SimpleGrid>
        <div>
          <Heading>
            Equipment{g?.gearName ? `: ${g.gearName}` : ''}
            {g?.gearTabs && g.gearTabs > 1 ? ` (${g.gearTabs} equipment tabs)` : ''}
          </Heading>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing={24} mt={6}>
            {SLOTS.map(([group, slots]) => {
              const items = slots.map((s) => bySlot.get(s)).filter(Boolean);
              if (!items.length) return null;
              return (
                <Stack key={group} gap={8}>
                  <Text size="xs" c="dimmed">
                    {group}
                  </Text>
                  {items.map((e) => (
                    <Group key={e!.slot} gap={8} wrap="nowrap" align="flex-start">
                      <Img
                        src={e!.icon}
                        name={e!.skin ? `${e!.name} (${e!.skin} skin)` : e!.name}
                        rarity={e!.rarity}
                        size={34}
                      />
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={500} lineClamp={1}>
                          {e!.name}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {[SLOT_NAMES[e!.slot] ?? e!.slot, e!.stats].filter(Boolean).join(' · ')}
                        </Text>
                        {e!.upgrades.length + e!.infusions.length > 0 && (
                          <Group gap={2} mt={2} wrap="nowrap">
                            {[...e!.upgrades, ...e!.infusions].map((u, i) => (
                              <Img key={i} src={u?.icon} name={u?.name} size={16} />
                            ))}
                          </Group>
                        )}
                      </div>
                    </Group>
                  ))}
                </Stack>
              );
            })}
          </SimpleGrid>
          {!d.equipment.length && (
            <Text size="sm" c="dimmed">
              No equipment (needs the builds and inventories permissions).
            </Text>
          )}
        </div>
      </Stack>
    </Paper>
  );
}

function CharacterRow({ c }: { c: Gw2Character }) {
  const [open, setOpen] = useState(false);
  const crafting = c.crafting
    .filter((x) => x.active)
    .map((x) => `${x.discipline} ${x.rating}`)
    .join(', ');
  return (
    <div>
      <UnstyledButton onClick={() => setOpen((o) => !o)} w="100%" aria-expanded={open}>
        <Group justify="space-between" gap="sm" wrap="nowrap">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <Img src={c.icon} size={26} />
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} truncate>
                {c.name}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {[c.race, c.profession].filter(Boolean).join(' ')}
                {crafting ? ` · ${crafting}` : ''}
              </Text>
            </div>
          </Group>
          <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
            <div style={{ textAlign: 'right' }}>
              <Text size="sm" className="num">
                Level {c.level ?? '—'}
              </Text>
              <Text size="xs" c="dimmed" className="num">
                {fmt(c.hours)} h · {fmt(c.deaths)} deaths
              </Text>
            </div>
            {open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} style={{ opacity: 0.5 }} />}
          </Group>
        </Group>
      </UnstyledButton>
      {open && <Details c={c} />}
    </div>
  );
}

/** Every character; open one for its gear, build, bags and crafting. */
export function CharactersTab({ characters }: { characters: Gw2Character[] | null }) {
  if (characters === null) return <Text c="dimmed">Needs the characters permission on the API key.</Text>;
  if (!characters.length) return <Text c="dimmed">No characters yet.</Text>;
  const sorted = [...characters].sort((x, y) => y.hours - x.hours);
  return (
    <Stack gap={12}>
      <Text size="sm" c="dimmed">
        {characters.length} characters, {fmt(characters.reduce((n, c) => n + c.hours, 0))} hours. Open one for its gear
        and build.
      </Text>
      {sorted.map((c) => (
        <CharacterRow key={c.name} c={c} />
      ))}
    </Stack>
  );
}
