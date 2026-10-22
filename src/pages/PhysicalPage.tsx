import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { GameSearch } from '../components/GameSearch';
import { PhysicalPlatformIcon } from '../components/PhysicalPlatformIcon';
import { CONDITIONS, DIGITAL, PHYSICAL_PLATFORMS } from '../data/physical';
import type { FoundGame } from '../lib/api';
import { formatPrice } from '../lib/format';
import { useGameResolver, useStore } from '../lib/store';
import type { Condition, Game, PhysicalItem, PhysicalPlatform, PhysicalWant } from '../types';

function PlatformTag({ platform }: { platform: PhysicalPlatform }) {
  return (
    <Group gap={6} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
      <PhysicalPlatformIcon platform={platform} />
      <Text span size="sm" fw={500}>
        {platform}
      </Text>
    </Group>
  );
}

/** Best guess at the physical platform from where a game is sold. */
function defaultPlatform(f: FoundGame): PhysicalPlatform | null {
  if (f.availableOn.includes('switch')) return f.switchVersions?.includes('Switch') ? 'Switch' : 'Switch 2';
  if (f.availableOn.includes('playstation')) return 'PS5';
  return null;
}

type FormValues = {
  gameId?: string;
  title: string;
  platform: PhysicalPlatform | null;
  condition?: Condition | null;
  edition?: string;
  price?: number | string;
  acquiredAt?: string;
  notes?: string;
};

/** Add or edit form for both collection items and wants. */
function PhysicalForm({
  mode,
  initial,
  onSave,
  onCancel,
}: {
  mode: 'item' | 'want';
  initial?: FormValues;
  onSave: (v: FormValues) => void;
  onCancel: () => void;
}) {
  const saveFound = useStore((s) => s.saveFound);
  const [v, setV] = useState<FormValues>(initial ?? { title: '', platform: null });
  const set = (patch: Partial<FormValues>) => setV((prev) => ({ ...prev, ...patch }));
  const [searching, setSearching] = useState(!initial?.title);

  const pick = (f: FoundGame) => {
    set({ gameId: saveFound(f), title: f.title, platform: v.platform ?? defaultPlatform(f) });
    setSearching(false);
  };

  return (
    <Stack gap="sm">
      {searching ? (
        <>
          <GameSearch actionLabel="Select" onPick={pick} placeholder="Search for the game" autoFocus />
          <Anchor component="button" size="sm" onClick={() => setSearching(false)} w="fit-content">
            Not listed? Type the title instead
          </Anchor>
        </>
      ) : (
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            label="Title"
            value={v.title}
            onChange={(e) => set({ title: e.currentTarget.value, gameId: undefined })}
            style={{ flex: 1 }}
            required
          />
          <Button variant="subtle" color="gray" onClick={() => setSearching(true)}>
            Search instead
          </Button>
        </Group>
      )}
      <Group grow align="flex-start">
        <Select
          label="Platform"
          data={PHYSICAL_PLATFORMS}
          value={v.platform}
          onChange={(p) => set({ platform: p as PhysicalPlatform | null })}
          allowDeselect={false}
          required
        />
        {mode === 'item' ? (
          <Select
            label="Condition"
            data={CONDITIONS}
            value={v.condition ?? null}
            onChange={(c) => set({ condition: c as Condition | null })}
            clearable
            placeholder="Optional"
          />
        ) : (
          <NumberInput
            label="Most you'd pay"
            prefix="$"
            min={0}
            decimalScale={2}
            value={v.price ?? ''}
            onChange={(p) => set({ price: p })}
            placeholder="Optional"
          />
        )}
      </Group>
      <TextInput
        label="Edition"
        placeholder="e.g. Collector's Edition, Steelbook"
        value={v.edition ?? ''}
        onChange={(e) => set({ edition: e.currentTarget.value })}
      />
      {mode === 'item' && (
        <Group grow>
          <NumberInput
            label="Price paid"
            prefix="$"
            min={0}
            decimalScale={2}
            value={v.price ?? ''}
            onChange={(p) => set({ price: p })}
            placeholder="Optional"
          />
          <TextInput
            label="Got it on"
            type="date"
            value={v.acquiredAt ?? ''}
            onChange={(e) => set({ acquiredAt: e.currentTarget.value })}
          />
        </Group>
      )}
      <Textarea
        label="Notes"
        autosize
        minRows={2}
        value={v.notes ?? ''}
        onChange={(e) => set({ notes: e.currentTarget.value })}
      />
      <Group justify="flex-end" mt="xs">
        <Button variant="subtle" color="gray" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!v.title.trim() || !v.platform} onClick={() => onSave(v)}>
          {mode === 'item' ? 'Save to collection' : 'Save to wants'}
        </Button>
      </Group>
    </Stack>
  );
}

function matchesFilter(x: { title: string; platform: PhysicalPlatform }, platform: string | null, query: string) {
  return (!platform || x.platform === platform) && x.title.toLowerCase().includes(query.trim().toLowerCase());
}

const toNumber = (n?: number | string) => (n === '' || n === undefined ? undefined : Number(n));

/** A game record to show the cover from: the linked game, or a title-only stand-in. */
function useCoverGame() {
  const resolve = useGameResolver();
  return (gameId: string | undefined, title: string): Game =>
    (gameId && resolve(gameId)) || { id: title, title, genres: [], subgenres: [], tags: [], availableOn: [] };
}

function ItemCard({
  item,
  game,
  footer,
  actions,
}: {
  item: { title: string; platform: PhysicalPlatform; edition?: string; notes?: string; gameId?: string };
  game: Game;
  footer: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <Paper p="sm" radius="md">
      <Stack gap={8}>
        {item.gameId ? (
          <Link to={`/game/${item.gameId}`} aria-hidden tabIndex={-1}>
            <Cover game={game} width="100%" radius={8} />
          </Link>
        ) : (
          <Cover game={game} width="100%" radius={8} />
        )}
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap={4}>
          <div style={{ minWidth: 0 }}>
            <Text fw={600} lh={1.25}>
              {item.title}
            </Text>
            {item.edition && (
              <Text size="xs" c="dimmed">
                {item.edition}
              </Text>
            )}
          </div>
          <Group gap={0} wrap="nowrap">
            {actions}
          </Group>
        </Group>
        <Group gap="sm" wrap="wrap">
          <PlatformTag platform={item.platform} />
          {footer}
        </Group>
        {item.notes && (
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
            {item.notes}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

type Editing =
  | { kind: 'new-item'; initial?: FormValues; fromWant?: string }
  | { kind: 'edit-item'; id: string }
  | { kind: 'new-want' }
  | { kind: 'edit-want'; id: string }
  | null;

export function PhysicalPage() {
  const physical = useStore((s) => s.physical);
  const wants = useStore((s) => s.physicalWants);
  const { addPhysical, updatePhysical, removePhysical, addWant, updateWant, removeWant } = useStore.getState();
  const coverGame = useCoverGame();
  const [tab, setTab] = useState<string | null>('collection');
  const [platform, setPlatform] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing>(null);

  const items = useMemo(
    () => physical.filter((x) => matchesFilter(x, platform, query)).sort((a, b) => a.title.localeCompare(b.title)),
    [physical, platform, query],
  );
  const wanted = useMemo(
    () => wants.filter((x) => matchesFilter(x, platform, query)).sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
    [wants, platform, query],
  );
  const spent = physical.reduce((n, p) => n + (p.pricePaid ?? 0), 0);
  const platformCounts = PHYSICAL_PLATFORMS.map((p) => [p, physical.filter((x) => x.platform === p).length] as const).filter(
    ([, n]) => n > 0,
  );

  // Typed-in titles still get a game record, so a cover can be looked up by title.
  const linkGame = (v: FormValues) => {
    if (v.gameId) return v.gameId;
    const digital = v.platform ? DIGITAL[v.platform] : undefined;
    return useStore.getState().saveFound({
      title: v.title.trim(),
      availableOn: digital ? [digital] : [],
      genres: [],
      subgenres: [],
      tags: [],
    });
  };

  const saveItem = (v: FormValues) => {
    const data = {
      gameId: linkGame(v),
      title: v.title.trim(),
      platform: v.platform!,
      condition: v.condition ?? undefined,
      edition: v.edition?.trim() || undefined,
      pricePaid: toNumber(v.price),
      acquiredAt: v.acquiredAt || undefined,
      notes: v.notes?.trim() || undefined,
    };
    if (editing?.kind === 'edit-item') updatePhysical(editing.id, data);
    else {
      addPhysical(data);
      if (editing?.kind === 'new-item' && editing.fromWant) removeWant(editing.fromWant);
      notifications.show({ message: `Added ${data.title} to your collection`, autoClose: 2200 });
    }
    setEditing(null);
  };

  const saveWant = (v: FormValues) => {
    const data = {
      gameId: linkGame(v),
      title: v.title.trim(),
      platform: v.platform!,
      maxPrice: toNumber(v.price),
      edition: v.edition?.trim() || undefined,
      notes: v.notes?.trim() || undefined,
    };
    if (editing?.kind === 'edit-want') updateWant(editing.id, data);
    else {
      addWant(data);
      notifications.show({ message: `Added ${data.title} to your wants`, autoClose: 2200 });
    }
    setEditing(null);
  };

  const editingItem = editing?.kind === 'edit-item' ? physical.find((p) => p.id === editing.id) : undefined;
  const editingWant = editing?.kind === 'edit-want' ? wants.find((w) => w.id === editing.id) : undefined;
  const itemInitial = (p: PhysicalItem): FormValues => ({
    gameId: p.gameId,
    title: p.title,
    platform: p.platform,
    condition: p.condition,
    edition: p.edition,
    price: p.pricePaid,
    acquiredAt: p.acquiredAt,
    notes: p.notes,
  });
  const wantInitial = (w: PhysicalWant): FormValues => ({
    gameId: w.gameId,
    title: w.title,
    platform: w.platform,
    edition: w.edition,
    price: w.maxPrice,
    notes: w.notes,
  });
  const ebay = (w: PhysicalWant) =>
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${w.title} ${w.platform}`)}`;

  const isItemForm = editing?.kind === 'new-item' || editing?.kind === 'edit-item';

  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>Physical games</Title>
        <Text c="dimmed" mt={6} size="lg">
          Your shelf, and the copies you’re still hunting for.
        </Text>
      </div>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="collection">Collection ({physical.length})</Tabs.Tab>
          <Tabs.Tab value="wants">Wants ({wants.length})</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      <Group gap="sm" wrap="wrap" align="flex-end">
        <TextInput
          aria-label="Filter by title"
          placeholder="Filter by title"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          style={{ flex: '1 1 200px' }}
        />
        <Select
          aria-label="Filter by platform"
          placeholder="All platforms"
          data={PHYSICAL_PLATFORMS}
          value={platform}
          onChange={setPlatform}
          clearable
          style={{ flex: '0 1 200px' }}
        />
        <Button
          leftSection={<IconPlus size={18} />}
          onClick={() => setEditing(tab === 'wants' ? { kind: 'new-want' } : { kind: 'new-item' })}
        >
          {tab === 'wants' ? 'Add a want' : 'Add a game'}
        </Button>
      </Group>

      {tab === 'collection' ? (
        <Stack gap="md">
          {physical.length > 0 && (
            <Group gap="lg" wrap="wrap">
              <Text size="sm" c="dimmed">
                {physical.length} {physical.length === 1 ? 'game' : 'games'}
                {spent > 0 && `, ${formatPrice(spent)} spent`}
              </Text>
              {platformCounts.map(([p, n]) => (
                <Group key={p} gap={6} wrap="nowrap">
                  <PhysicalPlatformIcon platform={p} size={14} />
                  <Text size="sm" c="dimmed" className="num">
                    {n}
                  </Text>
                </Group>
              ))}
            </Group>
          )}
          <div className="card-grid card-grid--physical">
            {items.map((p) => (
              <ItemCard
                key={p.id}
                item={p}
                game={coverGame(p.gameId, p.title)}
                footer={
                  <>
                    {p.condition && (
                      <Badge size="sm" variant="outline" color="gray" radius="xs" tt="none">
                        {CONDITIONS.find((c) => c.value === p.condition)?.label}
                      </Badge>
                    )}
                    {p.pricePaid !== undefined && (
                      <Text size="sm" c="dimmed" className="num">
                        {formatPrice(p.pricePaid)}
                      </Text>
                    )}
                  </>
                }
                actions={
                  <>
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" color="gray" onClick={() => setEditing({ kind: 'edit-item', id: p.id })} aria-label={`Edit ${p.title}`}>
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Remove from collection">
                      <ActionIcon variant="subtle" color="gray" onClick={() => removePhysical(p.id)} aria-label={`Remove ${p.title}`}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </>
                }
              />
            ))}
          </div>
          {!physical.length && (
            <Text c="dimmed">No physical games yet. Add the ones on your shelf to keep track of them.</Text>
          )}
          {physical.length > 0 && !items.length && <Text c="dimmed">No games match these filters.</Text>}
        </Stack>
      ) : (
        <Stack gap="md">
          <div className="card-grid card-grid--physical">
            {wanted.map((w) => (
              <ItemCard
                key={w.id}
                item={w}
                game={coverGame(w.gameId, w.title)}
                footer={
                  <>
                    {w.maxPrice !== undefined && (
                      <Text size="sm" c="dimmed" className="num">
                        Up to {formatPrice(w.maxPrice)}
                      </Text>
                    )}
                    <Anchor href={ebay(w)} target="_blank" rel="noopener noreferrer" size="sm">
                      Find on eBay
                    </Anchor>
                  </>
                }
                actions={
                  <>
                    <Tooltip label="Got it: move to collection">
                      <ActionIcon
                        variant="light"
                        color="green"
                        aria-label={`Move ${w.title} to collection`}
                        onClick={() =>
                          setEditing({
                            kind: 'new-item',
                            fromWant: w.id,
                            initial: { gameId: w.gameId, title: w.title, platform: w.platform, edition: w.edition },
                          })
                        }
                      >
                        <IconCheck size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" color="gray" onClick={() => setEditing({ kind: 'edit-want', id: w.id })} aria-label={`Edit ${w.title}`}>
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Remove from wants">
                      <ActionIcon variant="subtle" color="gray" onClick={() => removeWant(w.id)} aria-label={`Remove ${w.title}`}>
                        <IconX size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </>
                }
              />
            ))}
          </div>
          {!wants.length && (
            <Text c="dimmed">Nothing on your wants list. Add physical copies you’re looking for.</Text>
          )}
          {wants.length > 0 && !wanted.length && <Text c="dimmed">No wants match these filters.</Text>}
        </Stack>
      )}

      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={
          editing?.kind === 'edit-item'
            ? 'Edit physical game'
            : editing?.kind === 'edit-want'
              ? 'Edit want'
              : editing?.kind === 'new-want'
                ? 'Add a want'
                : editing?.kind === 'new-item' && editing.fromWant
                  ? 'Move to collection'
                  : 'Add a physical game'
        }
        size="lg"
        fullScreen={typeof window !== 'undefined' && window.innerWidth < 576}
      >
        {editing && (
          <PhysicalForm
            key={JSON.stringify(editing)}
            mode={isItemForm ? 'item' : 'want'}
            initial={
              editingItem
                ? itemInitial(editingItem)
                : editingWant
                  ? wantInitial(editingWant)
                  : editing.kind === 'new-item'
                    ? editing.initial
                    : undefined
            }
            onSave={isItemForm ? saveItem : saveWant}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </Stack>
  );
}
