import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Code,
  Collapse,
  Group,
  NumberInput,
  Paper,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { GenreChips } from '../components/GenreChips';
import { GameSearch } from '../components/GameSearch';
import { PlatformIcon, PlatformList } from '../components/PlatformBadge';
import { PriceTable } from '../components/PriceTable';
import { ShareExport, type ListExport } from '../components/ShareExport';
import { PLATFORM_BY_ID } from '../data/platforms';
import { STORE_BY_ID } from '../data/stores';
import {
  fetchAccount,
  fetchSteamWishlist,
  fetchAlertSettings,
  steamProfileUrl,
  usePrices,
  useServerStatus,
  type Account,
  type AlertSettings,
} from '../lib/api';
import { formatLastPlayed, formatPrice, upcomingLabel } from '../lib/format';
import { normalizeTitle } from '../lib/match';
import { useGameResolver, useStore } from '../lib/store';
import type { Game, WishlistItem } from '../types';

function WishRow({ item, game }: { item: WishlistItem; game: Game }) {
  const { prices, loading, keyshops, itad } = usePrices(game);
  const update = useStore((s) => s.updateWishlist);
  const toggle = useStore((s) => s.toggleWishlist);
  const [open, { toggle: toggleOpen }] = useDisclosure(false);
  const best = prices[0];
  const hit = best && item.targetPrice !== undefined && best.price <= item.targetPrice;
  const keyshopHit = keyshops && item.targetPrice !== undefined && keyshops.price <= item.targetPrice;
  const deal = itad?.current;
  const dealHit = deal && item.targetPrice !== undefined && deal.price <= item.targetPrice;

  return (
    <div className="list-row">
      <Group gap="md" wrap="nowrap" align="flex-start">
        <Link to={`/game/${game.id}`} aria-hidden tabIndex={-1} style={{ flexShrink: 0 }}>
          <Cover game={game} width={120} radius={8} />
        </Link>
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              <Text component={Link} to={`/game/${game.id}`} fw={600} c="inherit" style={{ textDecoration: 'none' }}>
                {game.title}
              </Text>
              {item.source === 'steam' ? (
                <Tooltip label="On your Steam wishlist">
                  <Badge size="xs" variant="outline" color="gray" radius="xs" tt="none" style={{ flexShrink: 0 }}>
                    Steam wishlist
                  </Badge>
                </Tooltip>
              ) : (
                game.steamAppId && (
                  <Tooltip label="Steam doesn't let other apps change your wishlist. This opens the store page, where you can add it.">
                    <Anchor
                      href={`https://store.steampowered.com/app/${game.steamAppId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="xs"
                      style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                    >
                      Add on Steam
                    </Anchor>
                  </Tooltip>
                )
              )}
            </Group>
            <Tooltip label="Remove from wishlist">
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => toggle(game.id)}
                aria-label={`Remove ${game.title} from wishlist`}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <GenreChips game={game} limit={3} size="xs" />
          <PlatformList platforms={game.availableOn} switchVersions={game.switchVersions} />
          {upcomingLabel(game) && (
            <Text size="sm" fw={600} c="var(--mantine-primary-color-filled)">
              {upcomingLabel(game)}
            </Text>
          )}
        </Stack>
      </Group>

      <Group justify="space-between" align="flex-end" mt="md" wrap="wrap" gap="sm">
        <div>
          <Text size="xs" c="dimmed">
            Best price
          </Text>
          {best ? (
            <Group gap={8} align="baseline">
              <Text className="display num" fw={700} fz="xl">
                {formatPrice(best.price)}
              </Text>
              <Text size="sm" c="dimmed">
                at {STORE_BY_ID[best.storeId].name}
              </Text>
              {hit && (
                <Badge color="green" variant="light" radius="xs" tt="none">
                  At or below your target
                </Badge>
              )}
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              {loading ? 'Checking prices' : 'No store price found'}
            </Text>
          )}
          {deal && (
            <Group gap={8} align="baseline" mt={2} wrap="wrap">
              <Text size="sm" c="dimmed">
                Best PC deal{' '}
                <Anchor href={deal.url} target="_blank" rel="noopener noreferrer" fw={700} c="inherit" className="num">
                  {formatPrice(deal.price)}
                </Anchor>{' '}
                at {deal.shop}
                {deal.cut > 0 && ` (${deal.cut}% off)`}
                {itad?.lowest && (
                  <>
                    , lowest ever{' '}
                    <Anchor href={itad.url} target="_blank" rel="noopener noreferrer" c="inherit" className="num">
                      {formatPrice(itad.lowest.price)}
                    </Anchor>{' '}
                    ({new Date(itad.lowest.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })})
                  </>
                )}
              </Text>
              {dealHit && !hit && (
                <Badge color="green" variant="light" radius="xs" tt="none">
                  At or below your target
                </Badge>
              )}
            </Group>
          )}
          {keyshops && (
            <Group gap={8} align="baseline" mt={2}>
              <Text size="sm" c="dimmed">
                Key shops from{' '}
                <Anchor
                  href={keyshops.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  fw={700}
                  c="inherit"
                  className="num"
                >
                  {formatPrice(keyshops.price)}
                </Anchor>
              </Text>
              {keyshopHit && !hit && !dealHit && (
                <Badge color="green" variant="light" radius="xs" tt="none">
                  Key shops at or below your target
                </Badge>
              )}
            </Group>
          )}
        </div>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <NumberInput
            label="Target price"
            placeholder="Any"
            prefix="$"
            min={0}
            decimalScale={2}
            size="xs"
            w={110}
            value={item.targetPrice ?? ''}
            onChange={(v) => update(game.id, { targetPrice: v === '' ? undefined : Number(v) })}
          />
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            onClick={toggleOpen}
            aria-expanded={open}
            rightSection={
              <IconChevronDown
                size={14}
                style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }}
              />
            }
          >
            All stores
          </Button>
        </Group>
      </Group>
      <Collapse expanded={open}>
        <div style={{ borderTop: '1px solid var(--sp-line)', marginTop: 12, paddingTop: 4 }}>
          <PriceTable game={game} compact />
        </div>
      </Collapse>
    </div>
  );
}

function SteamSync() {
  const conn = useStore((s) => s.connections.steam);
  const sync = useStore((s) => s.syncSteamWishlist);
  const [status] = useServerStatus();
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAccount()
      .then(setAccount)
      .catch(() => {});
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchSteamWishlist();
      if (!res.games.length) {
        setError(
          "Steam returned an empty wishlist. If yours isn't empty, set your profile's Game details to Public in Steam's privacy settings.",
        );
        return;
      }
      const r = sync(res.games, steamProfileUrl(res.steamId));
      notifications.show({
        title: 'Steam wishlist synced',
        message: `${r.total} games on your Steam wishlist: ${r.added} added, ${r.removed} removed.`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.steam) {
    return (
      <Text size="sm" c="dimmed">
        To sync your Steam wishlist, add <Code>STEAM_API_KEY</Code> to <Code>.env</Code>.
      </Text>
    );
  }
  if (account === null) return null;
  if (!account.steamId) {
    return (
      <Text size="sm" c="dimmed">
        To copy your Steam wishlist here,{' '}
        <Anchor component={Link} to="/settings">
          connect Steam in Settings
        </Anchor>{' '}
        first.
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      <Button
        onClick={run}
        loading={busy}
        w="fit-content"
        leftSection={<PlatformIcon platform="steam" size={16} color="currentColor" />}
      >
        Sync Steam wishlist
      </Button>
      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {conn?.wishlistSync ? `Last synced ${formatLastPlayed(conn.wishlistSync)}. ` : ''}
        Copies your Steam wishlist into Savepoint. Games removed on Steam are removed here on the next sync. Steam
        doesn't let other apps change your wishlist, so games you add here stay in Savepoint only.
      </Text>
    </Stack>
  );
}

/** A line on whether price alerts are on, pointing to Settings. */
function PriceAlerts() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  useEffect(() => {
    fetchAlertSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);
  if (!settings) return null;
  return (
    <Text size="sm" c="dimmed">
      {settings.topic
        ? `Price alerts are on: your phone hears about it when a game hits its target price. `
        : 'Set a target price on a game to see when it gets there. For a phone notification, '}
      <Anchor component={Link} to="/settings#alerts">
        {settings.topic ? 'Alert settings' : 'turn on price alerts in Settings'}
      </Anchor>
      {settings.topic ? '' : '.'}
    </Text>
  );
}

export function WishlistPage() {
  const wishlist = useStore((s) => s.wishlist);
  const addFound = useStore((s) => s.addFoundToWishlist);
  const resolve = useGameResolver();

  const rows = wishlist
    .map((item) => ({ item, game: resolve(item.gameId) }))
    .filter((r): r is { item: WishlistItem; game: Game } => !!r.game)
    .sort((a, b) => b.item.addedAt.localeCompare(a.item.addedAt));

  const onWishlist = useMemo(() => new Set(rows.map((r) => normalizeTitle(r.game.title))), [rows]);
  const exported: ListExport = {
    title: 'My Savepoint wishlist',
    filename: 'savepoint-wishlist',
    lines: rows.map(({ item, game }) => {
      const on = game.availableOn.map((p) => PLATFORM_BY_ID[p].short).join(', ');
      const target = item.targetPrice !== undefined ? `, target ${formatPrice(item.targetPrice)}` : '';
      return `${game.title}${on ? ` (${on})` : ''}${target}`;
    }),
    columns: ['Title', 'Platforms', 'Target price (USD)', 'Note', 'Added', 'From'],
    rows: rows.map(({ item, game }) => [
      game.title,
      game.availableOn.map((p) => PLATFORM_BY_ID[p].name).join(', '),
      item.targetPrice,
      item.note,
      item.addedAt.slice(0, 10),
      item.source === 'steam' ? 'Steam wishlist' : 'Savepoint',
    ]),
  };

  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>Wishlist</Title>
        <Text c="dimmed" mt={6} size="lg">
          Set a target price and Savepoint flags the game once a store sells it for that or less, and can notify your
          phone.
        </Text>
      </div>

      <Paper p={{ base: 'md', sm: 'lg' }}>
        <Title order={2} fz="lg" mb="sm">
          Add games
        </Title>
        <GameSearch
          actionLabel="Wishlist"
          isDone={(f) => onWishlist.has(normalizeTitle(f.title))}
          onPick={(f) => {
            addFound(f);
            notifications.show({ message: `Added ${f.title} to your wishlist`, autoClose: 2200 });
          }}
        />
        <Text size="xs" c="dimmed" mt="xs">
          Nintendo doesn't let other apps read your eShop wishlist, so add Switch games here with search.
        </Text>
        <Title order={2} fz="lg" mt="xl" mb="sm">
          Steam wishlist
        </Title>
        <SteamSync />
        <Title order={2} fz="lg" mt="xl" mb="sm">
          Price alerts
        </Title>
        <PriceAlerts />
      </Paper>

      {rows.length ? (
        <Stack gap="md">
          <Group justify="space-between" gap="sm">
            <Text size="sm" c="dimmed">
              {rows.length} {rows.length === 1 ? 'game' : 'games'}
            </Text>
            <ShareExport list={exported} />
          </Group>
          {rows.map(({ item, game }) => (
            <WishRow key={game.id} item={item} game={game} />
          ))}
        </Stack>
      ) : (
        <Text c="dimmed">Your wishlist is empty. Search for a game above or sync your Steam wishlist.</Text>
      )}
    </Stack>
  );
}
