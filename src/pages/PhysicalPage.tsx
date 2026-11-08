import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { FranchiseBadge } from '../components/GenreChips';
import { PhysicalPlatformIcon } from '../components/PhysicalPlatformIcon';
import { PhysicalEditorModal, PlatformTag } from '../components/PhysicalEditor';
import { CONDITIONS, PHYSICAL_PLATFORM_GROUPS, PHYSICAL_PLATFORMS } from '../data/physical';
import { formatPrice } from '../lib/format';
import { toUsd, useCurrency } from '../lib/currency';
import { useCoverGame, type Editing } from '../lib/physicalWants';
import { useStore } from '../lib/store';
import type { Game, PhysicalItem, PhysicalPlatform } from '../types';

function matchesFilter(x: { title: string; platform: PhysicalPlatform }, platform: string | null, query: string) {
  return (!platform || x.platform === platform) && x.title.toLowerCase().includes(query.trim().toLowerCase());
}

function ItemCard({ item, game, actions }: { item: PhysicalItem; game: Game; actions: React.ReactNode }) {
  useCurrency();
  return (
    <div className="tile">
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
        <FranchiseBadge game={game} size="xs" />
        <Group gap="sm" wrap="wrap">
          <PlatformTag platform={item.platform} />
          {item.condition && (
            <Badge size="sm" variant="outline" color="gray" radius="xs" tt="none">
              {CONDITIONS.find((c) => c.value === item.condition)?.label}
            </Badge>
          )}
          {item.pricePaid !== undefined && (
            <Text size="sm" c="dimmed" className="num">
              {formatPrice(item.pricePaid, item.currency)}
            </Text>
          )}
        </Group>
        {item.notes && (
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
            {item.notes}
          </Text>
        )}
      </Stack>
    </div>
  );
}

/** Physical games you own. Copies you want are on the Wishlist. */
export function PhysicalPage() {
  const physical = useStore((s) => s.physical);
  const wantCount = useStore((s) => s.physicalWants.length);
  const removePhysical = useStore((s) => s.removePhysical);
  const coverGame = useCoverGame();
  const [editing, setEditing] = useState<Editing>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const items = useMemo(
    () => physical.filter((x) => matchesFilter(x, platform, query)).sort((a, b) => a.title.localeCompare(b.title)),
    [physical, platform, query],
  );
  useCurrency();
  const spent = physical.reduce((n, p) => n + (p.pricePaid ? toUsd(p.pricePaid, p.currency) : 0), 0);
  const platformCounts = PHYSICAL_PLATFORMS.map(
    (p) => [p, physical.filter((x) => x.platform === p).length] as const,
  ).filter(([, n]) => n > 0);

  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>My Shelf</Title>
        <Text c="dimmed" mt={6} size="lg">
          The physical games you own.{' '}
          {wantCount > 0 ? (
            <>
              Copies you’re looking for are on your{' '}
              <Anchor component={Link} to="/wishlist?show=physical" inherit>
                wishlist
              </Anchor>
              .
            </>
          ) : (
            <>
              To keep track of copies you’re looking for, add them to your{' '}
              <Anchor component={Link} to="/wishlist?show=physical" inherit>
                wishlist
              </Anchor>
              .
            </>
          )}
        </Text>
      </div>

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
          data={PHYSICAL_PLATFORM_GROUPS.map((g) => ({
            group: g.group,
            items: g.items.filter((p) => physical.some((x) => x.platform === p)),
          })).filter((g) => g.items.length)}
          searchable
          value={platform}
          onChange={setPlatform}
          clearable
          style={{ flex: '0 1 200px' }}
        />
        <Button leftSection={<IconPlus size={18} />} onClick={() => setEditing({ kind: 'new-item' })}>
          Add a game
        </Button>
      </Group>

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
              actions={
                <>
                  <Tooltip label="Edit">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => setEditing({ kind: 'edit-item', id: p.id })}
                      aria-label={`Edit ${p.title}`}
                    >
                      <IconPencil size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Remove from your shelf">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => removePhysical(p.id)}
                      aria-label={`Remove ${p.title}`}
                    >
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

      <PhysicalEditorModal editing={editing} onClose={() => setEditing(null)} />
    </Stack>
  );
}
