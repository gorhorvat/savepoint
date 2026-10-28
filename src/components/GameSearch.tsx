import { Button, Chip, Group, Loader, Paper, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCheck, IconHeart, IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { searchGames, type FoundGame } from '../lib/api';
import { formatPrice } from '../lib/format';
import type { Game, PlatformId } from '../types';
import { Cover } from './Cover';
import { PlatformIcon, PlatformList } from './PlatformBadge';

const asGame = (f: FoundGame): Game => ({ id: f.title, ...f });

/**
 * Search every PC (Steam, Epic) and Nintendo Switch / Switch 2 game.
 * `actionLabel` names what the button does; `isDone` marks games already handled.
 */
export function GameSearch({
  onPick,
  actionLabel,
  isDone,
  placeholder = 'Search Steam, Epic and Nintendo Switch games',
  autoFocus,
  platform,
  allPlatforms,
}: {
  autoFocus?: boolean;
  /** Include older consoles (SNES, PS2...) that no store sells any more. */
  allPlatforms?: boolean;
  /** Only show games on this platform (and hide the platform filter). */
  platform?: PlatformId;
  onPick: (game: FoundGame) => void;
  actionLabel: string;
  isDone?: (game: FoundGame) => boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query.trim(), 350);
  const [state, setState] = useState<{ q: string; results: FoundGame[]; error?: string } | null>(null);

  useEffect(() => {
    if (debounced.length < 2) return;
    const controller = new AbortController();
    searchGames(debounced, controller.signal, allPlatforms)
      .then((results) => setState({ q: debounced, results }))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setState({ q: debounced, results: [], error: err.message });
      });
    return () => controller.abort();
  }, [debounced, allPlatforms]);

  const [only, setOnly] = useState<PlatformId | 'all'>('all');
  const searching = debounced.length >= 2 && state?.q !== debounced;
  const found = debounced.length >= 2 && state?.q === debounced ? state.results : [];
  const all = platform ? found.filter((f) => f.availableOn.includes(platform)) : found;
  const counts = (['steam', 'epic', 'switch'] as const).map((p) => [p, all.filter((f) => f.availableOn.includes(p)).length] as const);
  const results = only === 'all' ? all : all.filter((f) => f.availableOn.includes(only));

  return (
    <Stack gap="xs">
      <TextInput
        aria-label={placeholder}
        placeholder={placeholder}
        leftSection={<IconSearch size={16} />}
        rightSection={searching ? <Loader size={14} /> : null}
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setOnly('all');
        }}
        data-autofocus={autoFocus || undefined}
      />
      {state?.error && state.q === debounced && (
        <Text size="sm" c="red">
          {state.error}
        </Text>
      )}
      {debounced.length >= 2 && !searching && !results.length && !state?.error && (
        <Text size="sm" c="dimmed">
          No games found for “{debounced}”.
        </Text>
      )}
      {all.length > 0 && !platform && !allPlatforms && (
        <Chip.Group value={only} onChange={(v) => setOnly(v as PlatformId | 'all')}>
          <Group gap={6}>
            <Chip value="all" size="xs" radius="sm" variant="outline">
              All {all.length}
            </Chip>
            {counts.map(([p, n]) => (
              <Chip key={p} value={p} size="xs" radius="sm" variant="outline" disabled={!n}>
                <Group gap={4} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
                  <PlatformIcon platform={p} size={12} label />
                  {n}
                </Group>
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      )}
      {results.length > 0 && (
        <Paper p={4} radius="md">
          <ScrollArea.Autosize mah={440} type="auto" offsetScrollbars>
          <Stack gap={0}>
            {results.map((f, i) => {
              const done = isDone?.(f) ?? false;
              return (
                <Group
                  key={`${f.title}-${i}`}
                  gap="sm"
                  wrap="nowrap"
                  p={8}
                  style={{ borderTop: i ? '1px solid var(--sp-line)' : undefined }}
                >
                  <Cover game={asGame(f)} width={92} radius={5} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600} size="sm" lineClamp={2}>
                      {f.title}
                    </Text>
                    <Group gap={8} mt={4} wrap="wrap">
                      {allPlatforms && f.physicalPlatforms?.length ? (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {f.physicalPlatforms.join(' · ')}
                        </Text>
                      ) : (
                        <PlatformList platforms={f.availableOn} switchVersions={f.switchVersions} size={14} />
                      )}
                      <Text size="xs" c="dimmed">
                        {[f.year, f.eshop ? `eShop ${formatPrice(f.eshop.price)}` : null].filter(Boolean).join(', ')}
                      </Text>
                    </Group>
                  </div>
                  <Button
                    size="xs"
                    variant={done ? 'subtle' : 'light'}
                    color={done ? 'gray' : undefined}
                    disabled={done}
                    leftSection={done ? <IconCheck size={14} /> : actionLabel === 'Wishlist' ? <IconHeart size={14} /> : null}
                    onClick={() => onPick(f)}
                  >
                    {done ? 'Added' : actionLabel}
                  </Button>
                </Group>
              );
            })}
          </Stack>
          </ScrollArea.Autosize>
        </Paper>
      )}
    </Stack>
  );
}
