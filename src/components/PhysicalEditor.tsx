// Physical copies: the form for a copy you own or want, shop search links, and
// the modal that adds, edits and moves them ("Got it" turns a want into a copy
// on your shelf). Used by the Shelf (your collection) and the Wishlist (wants).
import {
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDisc } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CONDITIONS, DIGITAL, PHYSICAL_PLATFORM_GROUPS } from '../data/physical';
import type { FoundGame } from '../lib/api';
import { defaultPlatform, wantOf, type Editing, type FormValues } from '../lib/physicalWants';
import { useStore } from '../lib/store';
import { vendorSearchUrl } from '../lib/vendors';
import type { Condition, Game, PhysicalItem, PhysicalPlatform, PhysicalWant } from '../types';
import { GameSearch } from './GameSearch';
import { PhysicalPlatformIcon } from './PhysicalPlatformIcon';

/** Search links for a want in the shops picked in Settings. */
export function ShopLinks({ want }: { want: { title: string; platform: PhysicalPlatform } }) {
  const vendors = useStore((s) => s.vendors);
  if (!vendors.length) {
    return (
      <Anchor component={Link} to="/settings" size="sm" c="dimmed">
        Pick shops to search in Settings
      </Anchor>
    );
  }
  const query = `${want.title} ${want.platform}`;
  return (
    <Group gap={4} wrap="wrap" align="baseline">
      <Text span size="sm" c="dimmed">
        Find on
      </Text>
      {vendors.map((v, i) => (
        <Text span size="sm" key={v}>
          <Anchor href={vendorSearchUrl(v, query)} target="_blank" rel="noopener noreferrer" inherit>
            {v}
          </Anchor>
          {i < vendors.length - 1 && (
            <Text span c="dimmed">
              {' · '}
            </Text>
          )}
        </Text>
      ))}
    </Group>
  );
}

export function PlatformTag({ platform }: { platform: PhysicalPlatform }) {
  return (
    <Group gap={6} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
      <PhysicalPlatformIcon platform={platform} />
      <Text span size="sm" fw={500}>
        {platform}
      </Text>
    </Group>
  );
}

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
  const [releasedOn, setReleasedOn] = useState<PhysicalPlatform[]>([]);

  const pick = (f: FoundGame) => {
    set({ gameId: saveFound(f), title: f.title, platform: v.platform ?? defaultPlatform(f) });
    setReleasedOn(f.physicalPlatforms ?? []);
    setSearching(false);
  };

  return (
    <Stack gap="sm">
      {searching ? (
        <>
          <GameSearch
            actionLabel="Select"
            onPick={pick}
            placeholder="Search any game, older consoles included"
            autoFocus
            allPlatforms
          />
          <Anchor component="button" size="sm" onClick={() => setSearching(false)} w="fit-content">
            Not listed? Type the title instead
          </Anchor>
        </>
      ) : (
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            label="Title"
            value={v.title}
            onChange={(e) => {
              set({ title: e.currentTarget.value, gameId: undefined });
              setReleasedOn([]);
            }}
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
          data={PHYSICAL_PLATFORM_GROUPS}
          value={v.platform}
          onChange={(p) => set({ platform: p as PhysicalPlatform | null })}
          allowDeselect={false}
          searchable
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
      {!searching && releasedOn.length > 1 && (
        <Group gap={6} wrap="wrap" mt={-4}>
          <Text size="xs" c="dimmed">
            Released on
          </Text>
          {releasedOn.map((p) => (
            <Badge
              key={p}
              component="button"
              type="button"
              size="sm"
              radius="xs"
              tt="none"
              variant={v.platform === p ? 'filled' : 'outline'}
              color={v.platform === p ? undefined : 'gray'}
              style={{ cursor: 'pointer' }}
              onClick={() => set({ platform: p })}
            >
              {p}
            </Badge>
          ))}
        </Group>
      )}
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
          {mode === 'item' ? 'Save to your shelf' : 'Save to wishlist'}
        </Button>
      </Group>
    </Stack>
  );
}

const toNumber = (n?: number | string) => (n === '' || n === undefined ? undefined : Number(n));

/**
 * The add / edit modal for physical copies and wants: open while `editing` is
 * set; `onClose` clears it (after saving too).
 */
export function PhysicalEditorModal({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const physical = useStore((s) => s.physical);
  const wants = useStore((s) => s.physicalWants);

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
    const { addPhysical, updatePhysical, removeWant } = useStore.getState();
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
      notifications.show({ message: `Added ${data.title} to your shelf`, autoClose: 2200 });
    }
    onClose();
  };

  const saveWant = (v: FormValues) => {
    const { addWant, updateWant } = useStore.getState();
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
      notifications.show({ message: `Added a physical copy of ${data.title} to your wishlist`, autoClose: 2200 });
    }
    onClose();
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
  const isItemForm = editing?.kind === 'new-item' || editing?.kind === 'edit-item';
  const title =
    editing?.kind === 'edit-item'
      ? 'Edit physical game'
      : editing?.kind === 'edit-want'
        ? 'Edit physical copy you want'
        : editing?.kind === 'new-want'
          ? 'Want a physical copy'
          : editing?.kind === 'new-item' && editing.fromWant
            ? 'Got it: add to your shelf'
            : 'Add a physical game';

  return (
    <Modal
      opened={!!editing}
      onClose={() => onClose()}
      title={title}
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
                : editing.kind === 'new-item' || editing.kind === 'new-want'
                  ? editing.initial
                  : undefined
          }
          onSave={isItemForm ? saveItem : saveWant}
          onCancel={() => onClose()}
        />
      )}
    </Modal>
  );
}

/**
 * On a game page: want a physical copy of this game (or see the ones you
 * already want on the wishlist).
 */
export function PhysicalWantButton({ game }: { game: Game }) {
  const wanted = useStore((s) => s.physicalWants.filter((w) => w.gameId === game.id).length);
  const [editing, setEditing] = useState<Editing>(null);
  if (wanted) {
    return (
      <Button component={Link} to="/wishlist?show=physical" variant="light" leftSection={<IconDisc size={18} />}>
        {wanted > 1 ? `${wanted} physical copies wanted` : 'Physical copy wanted'}
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="default"
        leftSection={<IconDisc size={18} />}
        onClick={() => setEditing({ kind: 'new-want', initial: wantOf(game) })}
      >
        Want a physical copy
      </Button>
      <PhysicalEditorModal editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}
