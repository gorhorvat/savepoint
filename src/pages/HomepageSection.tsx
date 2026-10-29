import { ActionIcon, Button, Checkbox, Chip, Group, Paper, Stack, Switch, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import {
  DEFAULT_HOMEPAGE,
  FREE_STORE_LABELS,
  HOME_WIDGETS,
  NEWS_SITES,
  normalizeHomepage,
  type HomeFreeGames,
  type HomeWidget,
} from '../lib/homepage';
import type { FreeStore } from '../lib/api';
import { useStore } from '../lib/store';

/** Settings: which sections the homepage shows, in which order, and which news sites. */
export function HomepageSection() {
  const saved = useStore((s) => s.homepage);
  const setHomepage = useStore((s) => s.setHomepage);
  const settings = normalizeHomepage(saved);
  const { widgets, newsSources, freeGames } = settings;
  const setFree = (patch: Partial<HomeFreeGames>) =>
    setHomepage({ ...settings, freeGames: { ...freeGames, ...patch } });

  const setWidgets = (next: HomeWidget[]) => setHomepage({ ...settings, widgets: next });
  const move = (i: number, by: number) => {
    const next = [...widgets];
    const [w] = next.splice(i, 1);
    next.splice(i + by, 0, w);
    setWidgets(next);
  };
  const toggle = (i: number, on: boolean) => setWidgets(widgets.map((w, j) => (j === i ? { ...w, on } : w)));
  const newsOn = widgets.some((w) => w.id === 'news' && w.on);
  const freeOn = widgets.some((w) => w.id === 'free' && w.on);

  return (
    <Stack gap="lg" id="homepage">
      <div>
        <Title order={2}>Homepage</Title>
        <Text c="dimmed" mt={6} maw={640}>
          Pick what your homepage shows and in which order. Changes show up straight away.
        </Text>
      </div>
      <Paper p={{ base: 'md', sm: 'lg' }} maw={640}>
        <Stack gap={0}>
          {widgets.map((w, i) => {
            const info = HOME_WIDGETS[w.id];
            return (
              <Group
                key={w.id}
                justify="space-between"
                wrap="nowrap"
                gap="sm"
                py={10}
                style={{ borderTop: i ? '1px solid var(--sp-line)' : undefined }}
              >
                <Switch
                  checked={w.on}
                  onChange={(e) => toggle(i, e.currentTarget.checked)}
                  label={info.label}
                  description={info.description}
                  styles={{ label: { fontWeight: 600 } }}
                  style={{ minWidth: 0, flex: 1 }}
                />
                <Group gap={2} wrap="nowrap">
                  <Tooltip label="Move up">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={`Move ${info.label} up`}
                    >
                      <IconArrowUp size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Move down">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      disabled={i === widgets.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={`Move ${info.label} down`}
                    >
                      <IconArrowDown size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            );
          })}
        </Stack>
      </Paper>
      {freeOn && (
        <Paper p={{ base: 'md', sm: 'lg' }} maw={640}>
          <Stack gap="xs">
            <Text fw={600}>Free games</Text>
            <Text size="xs" c="dimmed">
              {freeGames.stores.length
                ? 'The homepage shows giveaways on the stores you pick.'
                : 'No store picked: the homepage shows giveaways on every store.'}
            </Text>
            <Chip.Group multiple value={freeGames.stores} onChange={(v) => setFree({ stores: v as FreeStore[] })}>
              <Group gap={6}>
                {(Object.keys(FREE_STORE_LABELS) as FreeStore[]).map((k) => (
                  <Chip key={k} value={k} size="xs" radius="sm" variant="outline">
                    {FREE_STORE_LABELS[k]}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            <Group gap="lg">
              <Checkbox
                size="xs"
                label="Free DLC too"
                checked={freeGames.dlc}
                onChange={(e) => setFree({ dlc: e.currentTarget.checked })}
              />
              <Checkbox
                size="xs"
                label="In-game loot too"
                checked={freeGames.loot}
                onChange={(e) => setFree({ loot: e.currentTarget.checked })}
              />
            </Group>
            <Text size="xs" c="dimmed">
              Pushes for new free games are a separate choice, under Alerts.
            </Text>
          </Stack>
        </Paper>
      )}
      {newsOn && (
        <Paper p={{ base: 'md', sm: 'lg' }} maw={640}>
          <Stack gap="xs">
            <Text fw={600}>News sites</Text>
            <Text size="xs" c="dimmed">
              {newsSources.length ? 'Headlines come from the sites you pick.' : 'None picked: headlines come from all of them.'}
            </Text>
            <Chip.Group multiple value={newsSources} onChange={(v) => setHomepage({ ...settings, newsSources: v })}>
              <Group gap={6}>
                {NEWS_SITES.map((s) => (
                  <Chip key={s.id} value={s.id} size="xs" radius="sm" variant="outline">
                    {s.name}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Stack>
        </Paper>
      )}
      <Button variant="subtle" color="gray" size="xs" w="fit-content" onClick={() => setHomepage(DEFAULT_HOMEPAGE)}>
        Back to the default homepage
      </Button>
    </Stack>
  );
}
