import { ActionIcon, Button, Checkbox, Group, Loader, NumberInput, Paper, Select, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { PLATFORM_BY_ID } from '../data/platforms';
import { searchGames, type FoundGame } from '../lib/api';
import { parseList } from '../lib/listImport';
import { normalizeTitle } from '../lib/match';
import { useStore } from '../lib/store';
import type { Game, PlatformId } from '../types';
import { Cover } from './Cover';

type Row = {
  line: string;
  title: string;
  minutes: number;
  physical: boolean;
  lastPlayed: string | null;
  status: 'matching' | 'matched' | 'none';
  options: FoundGame[];
  pick: number;
};

const asGame = (f: FoundGame): Game => ({ id: f.title, ...f });

/** Best match on this platform: exact title first, then the search's own order. */
function rank(results: FoundGame[], title: string, platform: PlatformId): FoundGame[] {
  const want = normalizeTitle(title);
  const onPlatform = results.filter((r) => r.availableOn.includes(platform));
  const pool = onPlatform.length ? onPlatform : results;
  return [...pool].sort(
    (a, b) => Number(normalizeTitle(b.title) === want) - Number(normalizeTitle(a.title) === want),
  );
}

export function ListImport({ platform, onDone }: { platform: PlatformId; onDone: () => void }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const name = PLATFORM_BY_ID[platform].name;
  const canBePhysical = platform === 'switch' || platform === 'playstation';

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const match = async () => {
    const parsed = parseList(text).map(
      (p): Row => ({ ...p, status: 'matching', options: [], pick: 0 }),
    );
    setRows(parsed);
    // A few searches at a time, so a long list doesn't flood the stores.
    for (let i = 0; i < parsed.length; i += 3) {
      await Promise.all(
        parsed.slice(i, i + 3).map(async (r, k) => {
          const results = await searchGames(r.title).catch(() => []);
          const options = rank(results, r.title, platform).slice(0, 6);
          update(i + k, { options, status: options.length ? 'matched' : 'none', pick: 0 });
        }),
      );
    }
  };

  const ready = (rows ?? []).filter((r) => r.status === 'matched' && (r.minutes > 0 || r.physical));

  const addAll = () => {
    const state = useStore.getState();
    let played = 0;
    let shelf = 0;
    for (const r of ready) {
      const found = r.options[r.pick];
      const gameId = state.saveFound(found);
      if (r.minutes > 0) {
        state.addManualEntry({ gameId, title: found.title, platform, minutes: r.minutes, lastPlayed: r.lastPlayed });
        played++;
      }
      const owned = useStore.getState().physical.some((p) => p.gameId === gameId);
      if (r.physical && !owned) {
        state.addPhysical({
          gameId,
          title: found.title,
          platform:
            platform === 'switch'
              ? found.switchVersions?.length === 1 && found.switchVersions[0] === 'Switch 2'
                ? 'Switch 2'
                : 'Switch'
              : 'PS5',
        });
        shelf++;
      }
    }
    notifications.show({
      message: `Added ${played} ${played === 1 ? 'game' : 'games'} to ${name}${shelf ? `, ${shelf} also to your physical collection` : ''}.`,
    });
    onDone();
  };

  if (!rows) {
    return (
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          One game per line, with its play time at the end. Optionally add “last played 2026-08-12”, and “(physical)” for games you own on a cartridge or disc.
        </Text>
        <Textarea
          autosize
          minRows={6}
          maxRows={16}
          placeholder={'Super Mario Odyssey — 25 h\nThe Legend of Zelda: Tears of the Kingdom — 104 h (physical)\nCeleste — 18 h'}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={match} disabled={!parseList(text).length}>
            Match {parseList(text).length || ''} {parseList(text).length === 1 ? 'game' : 'games'}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      {rows.map((r, i) => {
        const found = r.options[r.pick];
        return (
          <Paper key={`${r.line}-${i}`} p="sm" radius="md">
            <Group gap="sm" wrap="nowrap" align="flex-start">
              {found ? <Cover game={asGame(found)} width={92} radius={5} /> : <div style={{ width: 92, flexShrink: 0 }} />}
              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                <Text size="xs" c="dimmed" truncate>
                  {r.line}
                </Text>
                {r.status === 'matching' ? (
                  <Group gap={6}>
                    <Loader size={12} />
                    <Text size="sm" c="dimmed">
                      Finding {r.title}
                    </Text>
                  </Group>
                ) : r.status === 'none' ? (
                  <Text size="sm" c="orange">
                    No game found for “{r.title}”. Edit the line and match again, or add it from search.
                  </Text>
                ) : (
                  <Select
                    size="xs"
                    aria-label={`Game for ${r.title}`}
                    data={r.options.map((o, k) => ({
                      value: String(k),
                      label: `${o.title}${o.year ? ` (${o.year})` : ''}`,
                    }))}
                    value={String(r.pick)}
                    onChange={(v) => update(i, { pick: Number(v ?? 0) })}
                    allowDeselect={false}
                  />
                )}
                <Group gap="sm" align="center">
                  <NumberInput
                    size="xs"
                    aria-label={`Hours for ${r.title}`}
                    suffix=" h"
                    min={0}
                    decimalScale={1}
                    value={r.minutes / 60}
                    onChange={(v) => update(i, { minutes: Math.round(Number(v || 0) * 60) })}
                    w={100}
                  />
                  {canBePhysical && (
                    <Checkbox
                      size="xs"
                      label="Physical copy"
                      checked={r.physical}
                      onChange={(e) => update(i, { physical: e.currentTarget.checked })}
                    />
                  )}
                </Group>
              </Stack>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Remove ${r.title}`}
                onClick={() => setRows((rs) => rs && rs.filter((_, j) => j !== i))}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          </Paper>
        );
      })}
      <Group justify="space-between">
        <Button variant="subtle" color="gray" onClick={() => setRows(null)}>
          Edit list
        </Button>
        <Group gap="sm">
          <Button variant="subtle" color="gray" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={addAll} disabled={!ready.length}>
            Add {ready.length || ''} {ready.length === 1 ? 'game' : 'games'}
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}
