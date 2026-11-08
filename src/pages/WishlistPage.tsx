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
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconChevronDown, IconDisc, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { PhysicalEditorModal, PlatformTag, ShopLinks } from '../components/PhysicalEditor';
import { GenreChips } from '../components/GenreChips';
import { GameSearch } from '../components/GameSearch';
import { PlatformIcon, PlatformList } from '../components/PlatformBadge';
import { PriceTable } from '../components/PriceTable';
import { StoreDirectory } from '../components/StoreDirectory';
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
import { amountForInput, currencyAffix, currencyDecimals, toUsd, useCurrency } from '../lib/currency';
import { formatLastPlayed, formatPrice, upcomingLabel } from '../lib/format';
import { normalizeTitle } from '../lib/match';
import { gotIt, useCoverGame, wantOf, type Editing } from '../lib/physicalWants';
import { compareTitles } from '../lib/sort';
import { useGameResolver, useStore } from '../lib/store';
import type { Game, PhysicalWant, WishlistItem } from '../types';

type Show = 'all' | 'digital' | 'physical';
type WishSort = 'title' | 'title-desc' | 'added' | 'release';

const WISH_SORTS: { value: WishSort; label: string }[] = [
  { value: 'title', label: 'A to Z' },
  { value: 'title-desc', label: 'Z to A' },
  { value: 'added', label: 'Recently added' },
  { value: 'release', label: 'Release date' },
];

function wishCompare(sort: WishSort) {
  const byTitle = (a: WishCard, b: WishCard) => compareTitles(a.game.title, b.game.title);
  const released = (c: WishCard) => c.game.releaseDate ?? (c.game.comingSoon ? '9999' : '');
  switch (sort) {
    case 'title-desc':
      return (a: WishCard, b: WishCard) => byTitle(b, a);
    case 'added':
      return (a: WishCard, b: WishCard) => b.addedAt.localeCompare(a.addedAt) || byTitle(a, b);
    case 'release':
      // Newest first, so upcoming games lead (undated upcoming ones first); other games without a date go last.
      return (a: WishCard, b: WishCard) => released(b).localeCompare(released(a)) || byTitle(a, b);
    default:
      return byTitle;
  }
}

/** One game on the wishlist: wanted digitally (with prices), as physical copies, or both. */
interface WishCard {
  game: Game;
  /** Whether `game` is a real game record (it isn't for an old want typed in by title). */
  linked: boolean;
  digital?: WishlistItem;
  wants: PhysicalWant[];
  addedAt: string;
}

/** Digital prices, target price and the store table. */
function DigitalPart({ item, game }: { item: WishlistItem; game: Game }) {
  const { prices, loading, keyshops, itad } = usePrices(game);
  const update = useStore((s) => s.updateWishlist);
  const [open, { toggle: toggleOpen }] = useDisclosure(false);
  const currency = useCurrency();
  const best = prices[0];
  // Prices are in dollars; the target is in the currency it was typed in.
  const target = item.targetPrice === undefined ? undefined : toUsd(item.targetPrice, item.targetCurrency);
  const hit = best && target !== undefined && best.price <= target;
  const keyshopHit = keyshops && target !== undefined && keyshops.price <= target;
  const deal = itad?.current;
  const dealHit = deal && target !== undefined && deal.price <= target;

  return (
    <>
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
            {...currencyAffix(currency)}
            min={0}
            decimalScale={currencyDecimals(currency)}
            size="xs"
            w={120}
            value={amountForInput(item.targetPrice, item.targetCurrency) ?? ''}
            onChange={(v) =>
              update(game.id, {
                targetPrice: v === '' ? undefined : Number(v),
                targetCurrency: v === '' ? undefined : currency,
              })
            }
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
    </>
  );
}

/** A physical copy you want: console, edition, most you'd pay, and where to look. */
function WantLine({ want, onEdit, onGotIt }: { want: PhysicalWant; onEdit: () => void; onGotIt: () => void }) {
  const removeWant = useStore((s) => s.removeWant);
  useCurrency();
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs" className="wish-want">
      <Stack gap={4} style={{ minWidth: 0 }}>
        <Group gap="sm" wrap="wrap">
          <PlatformTag platform={want.platform} />
          {want.edition && (
            <Text size="sm" c="dimmed">
              {want.edition}
            </Text>
          )}
          {want.maxPrice !== undefined && (
            <Text size="sm" c="dimmed" className="num">
              Up to {formatPrice(want.maxPrice, want.currency)}
            </Text>
          )}
        </Group>
        <ShopLinks want={want} />
        {want.notes && (
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
            {want.notes}
          </Text>
        )}
      </Stack>
      <Group gap={0} wrap="nowrap">
        <Tooltip label="Got it: add to your shelf">
          <ActionIcon
            variant="light"
            color="green"
            onClick={onGotIt}
            aria-label={`Got ${want.title} on ${want.platform}`}
          >
            <IconCheck size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Edit">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onEdit}
            aria-label={`Edit ${want.title} on ${want.platform}`}
          >
            <IconPencil size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Don't want this copy">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => removeWant(want.id)}
            aria-label={`Remove ${want.title} on ${want.platform} from wishlist`}
          >
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

function WishCardView({ card, show, open }: { card: WishCard; show: Show; open: (e: Editing) => void }) {
  const { game, linked, digital, wants } = card;
  const toggle = useStore((s) => s.toggleWishlist);
  const removeWant = useStore((s) => s.removeWant);
  const showDigital = !!digital && show !== 'physical';
  const showPhysical = wants.length > 0 && show !== 'digital';
  const both = showDigital && showPhysical;

  const removeAll = () => {
    if (digital) toggle(game.id);
    for (const w of wants) removeWant(w.id);
  };
  const title = linked ? (
    <Text component={Link} to={`/game/${game.id}`} fw={600} c="inherit" style={{ textDecoration: 'none' }}>
      {game.title}
    </Text>
  ) : (
    <Text fw={600}>{game.title}</Text>
  );

  return (
    <div className="list-row">
      <Group gap="md" wrap="nowrap" align="flex-start">
        {linked ? (
          <Link to={`/game/${game.id}`} aria-hidden tabIndex={-1} style={{ flexShrink: 0 }}>
            <Cover game={game} width={120} radius={8} />
          </Link>
        ) : (
          <div style={{ flexShrink: 0 }}>
            <Cover game={game} width={120} radius={8} />
          </div>
        )}
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
            <Group gap={8} wrap="wrap" style={{ minWidth: 0 }}>
              {title}
              {showPhysical && (
                <Badge
                  size="xs"
                  variant="light"
                  radius="xs"
                  tt="none"
                  leftSection={<IconDisc size={11} />}
                  style={{ flexShrink: 0 }}
                >
                  {wants.length > 1 ? `${wants.length} physical copies` : 'Physical copy'}
                </Badge>
              )}
              {showDigital && digital?.source === 'steam' && (
                <Tooltip label="On your Steam wishlist">
                  <Badge size="xs" variant="outline" color="gray" radius="xs" tt="none" style={{ flexShrink: 0 }}>
                    Steam wishlist
                  </Badge>
                </Tooltip>
              )}
              {showDigital && digital?.source !== 'steam' && game.steamAppId && (
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
              )}
            </Group>
            <Tooltip label="Remove from wishlist">
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={removeAll}
                aria-label={`Remove ${game.title} from wishlist`}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
          {linked && <GenreChips game={game} limit={3} size="xs" />}
          {showDigital && <PlatformList platforms={game.availableOn} switchVersions={game.switchVersions} />}
          {linked && upcomingLabel(game) && (
            <Text size="sm" fw={600} c="var(--mantine-primary-color-filled)">
              {upcomingLabel(game)}
            </Text>
          )}
        </Stack>
      </Group>

      {showDigital && digital && (
        <div className={both ? 'wish-part' : undefined}>
          {both && (
            <Group justify="space-between" gap="xs" mt="md">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                Digital
              </Text>
              <Anchor component="button" size="xs" c="dimmed" onClick={() => toggle(game.id)}>
                Don't want it digitally
              </Anchor>
            </Group>
          )}
          <DigitalPart item={digital} game={game} />
        </div>
      )}

      {showPhysical && (
        <div className="wish-part">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" mt="md" mb={6}>
            {wants.length > 1 ? 'Physical copies' : 'Physical copy'}
          </Text>
          <Stack gap="sm">
            {wants.map((w) => (
              <WantLine
                key={w.id}
                want={w}
                onEdit={() => open({ kind: 'edit-want', id: w.id })}
                onGotIt={() => open(gotIt(w))}
              />
            ))}
          </Stack>
        </div>
      )}

      {show === 'all' && linked && (
        <Group gap="xs" mt="sm">
          {!digital && game.availableOn.length > 0 && (
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconPlus size={14} />}
              onClick={() => toggle(game.id)}
            >
              Want it digitally too
            </Button>
          )}
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<IconPlus size={14} />}
            onClick={() => open({ kind: 'new-want', initial: wantOf(game) })}
          >
            {wants.length ? 'Another physical copy' : 'Want a physical copy'}
          </Button>
        </Group>
      )}
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
        <Anchor component={Link} to="/platforms">
          connect Steam on the Platforms page
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

const SHOW_LABEL: Record<Show, string> = { all: 'All', digital: 'Digital', physical: 'Physical' };

export function WishlistPage() {
  const wishlist = useStore((s) => s.wishlist);
  const wants = useStore((s) => s.physicalWants);
  const addFound = useStore((s) => s.addFoundToWishlist);
  const resolve = useGameResolver();
  const coverGame = useCoverGame();
  const currency = useCurrency();
  const [editing, setEditing] = useState<Editing>(null);
  const [params, setParams] = useSearchParams();
  const showParam = params.get('show');
  const show: Show = showParam === 'digital' || showParam === 'physical' ? showParam : 'all';
  const [sortValue, setSort] = useLocalStorage<string>({ key: 'savepoint-sort-wishlist', defaultValue: 'title' });
  const sort: WishSort = WISH_SORTS.some((s) => s.value === sortValue) ? (sortValue as WishSort) : 'title';

  // One card per game: its digital wishlist entry and the physical copies wanted.
  const cards = useMemo(() => {
    const byId = new Map<string, WishCard>();
    const byTitle = new Map<string, WishCard>();
    const add = (card: WishCard) => {
      byId.set(card.game.id, card);
      byTitle.set(normalizeTitle(card.game.title), card);
      return card;
    };
    for (const item of wishlist) {
      const game = resolve(item.gameId);
      if (game) add({ game, linked: true, digital: item, wants: [], addedAt: item.addedAt });
    }
    for (const w of wants) {
      const game = w.gameId ? resolve(w.gameId) : undefined;
      const card =
        (game && byId.get(game.id)) ??
        byTitle.get(normalizeTitle(game?.title ?? w.title)) ??
        add({ game: game ?? coverGame(undefined, w.title), linked: !!game, wants: [], addedAt: w.addedAt });
      card.wants.push(w);
      if (w.addedAt > card.addedAt) card.addedAt = w.addedAt;
    }
    return [...byId.values()].sort(wishCompare(sort));
  }, [wishlist, wants, resolve, coverGame, sort]);

  const counts: Record<Show, number> = {
    all: cards.length,
    digital: cards.filter((c) => c.digital).length,
    physical: cards.filter((c) => c.wants.length).length,
  };
  const shown = cards.filter((c) => (show === 'digital' ? c.digital : show === 'physical' ? c.wants.length : true));

  const onWishlist = useMemo(
    () => new Set(cards.filter((c) => c.digital).map((c) => normalizeTitle(c.game.title))),
    [cards],
  );
  const lines = shown.flatMap(({ game, digital, wants: copies }) => [
    ...(digital && show !== 'physical' ? [{ game, digital, want: undefined }] : []),
    ...(show !== 'digital' ? copies.map((want) => ({ game, digital: undefined, want })) : []),
  ]);
  const exported: ListExport = {
    title: 'My Savepoint wishlist',
    filename: 'savepoint-wishlist',
    lines: lines.map(({ game, digital, want }) => {
      if (want) {
        const max = want.maxPrice !== undefined ? `, up to ${formatPrice(want.maxPrice, want.currency)}` : '';
        return `${want.title} (physical, ${want.platform}${want.edition ? `, ${want.edition}` : ''})${max}`;
      }
      const on = game.availableOn.map((p) => PLATFORM_BY_ID[p].short).join(', ');
      const target =
        digital?.targetPrice !== undefined
          ? `, target ${formatPrice(digital.targetPrice, digital.targetCurrency)}`
          : '';
      return `${game.title}${on ? ` (${on})` : ''}${target}`;
    }),
    columns: [
      'Title',
      'Copy',
      'Platforms',
      `Target or most you'd pay (${currency})`,
      'Edition',
      'Note',
      'Added',
      'From',
    ],
    rows: lines.map(({ game, digital, want }) =>
      want
        ? [
            want.title,
            'Physical',
            want.platform,
            amountForInput(want.maxPrice, want.currency),
            want.edition,
            want.notes,
            want.addedAt.slice(0, 10),
            'Savepoint',
          ]
        : [
            game.title,
            'Digital',
            game.availableOn.map((p) => PLATFORM_BY_ID[p].name).join(', '),
            amountForInput(digital?.targetPrice, digital?.targetCurrency),
            undefined,
            digital?.note,
            digital?.addedAt.slice(0, 10),
            digital?.source === 'steam' ? 'Steam wishlist' : 'Savepoint',
          ],
    ),
  };

  return (
    <Stack gap="xl">
      <div>
        <Title order={1}>My Wishlist</Title>
        <Text c="dimmed" mt={6} size="lg">
          Every game you want, digital or on a shelf. Set a target price and Savepoint flags the game once a store sells
          it for that or less, and can notify your phone.
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
        <Group gap="xs" mt="xs" justify="space-between" wrap="wrap">
          <Text size="xs" c="dimmed">
            Nintendo doesn't let other apps read your eShop wishlist, so add Switch games here with search.
          </Text>
          <Button
            variant="light"
            size="xs"
            leftSection={<IconDisc size={14} />}
            onClick={() => setEditing({ kind: 'new-want' })}
          >
            Want a physical copy
          </Button>
        </Group>
        <Title order={2} fz="lg" mt="xl" mb="sm">
          Steam wishlist
        </Title>
        <SteamSync />
        <Title order={2} fz="lg" mt="xl" mb="sm">
          Price alerts
        </Title>
        <PriceAlerts />
      </Paper>

      {cards.length ? (
        <Stack gap="md">
          <Group justify="space-between" gap="sm" wrap="wrap">
            <SegmentedControl
              size="xs"
              value={show}
              onChange={(v) => {
                const next = new URLSearchParams(params);
                if (v === 'all') next.delete('show');
                else next.set('show', v);
                setParams(next, { replace: true });
              }}
              data={(['all', 'digital', 'physical'] as const).map((v) => ({
                value: v,
                label: `${SHOW_LABEL[v]} (${counts[v]})`,
              }))}
              aria-label="Show"
            />
            <Group gap="sm" wrap="nowrap">
              <Select
                aria-label="Sort"
                size="xs"
                data={WISH_SORTS}
                value={sort}
                onChange={(v) => setSort(v ?? 'title')}
                allowDeselect={false}
                w={150}
              />
              <ShareExport list={exported} />
            </Group>
          </Group>
          {shown.map((card) => (
            <WishCardView key={card.game.id} card={card} show={show} open={setEditing} />
          ))}
          {!shown.length && (
            <Text c="dimmed">
              {show === 'physical'
                ? 'No physical copies on your wishlist. Use “Want a physical copy” on a game, or the button above.'
                : 'No games to buy digitally on your wishlist.'}
            </Text>
          )}
        </Stack>
      ) : (
        <Text c="dimmed">
          Your wishlist is empty. Search for a game above, sync your Steam wishlist, or add a physical copy you want.
        </Text>
      )}

      <StoreDirectory />
      <PhysicalEditorModal editing={editing} onClose={() => setEditing(null)} />
    </Stack>
  );
}
