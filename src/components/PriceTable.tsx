import { Anchor, Badge, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { MARKETPLACES, STORE_BY_ID, STORE_DELIVERS } from '../data/stores';
import { usePrices } from '../lib/api';
import { formatPrice } from '../lib/format';
import type { Game } from '../types';

export function PriceTable({ game, compact }: { game: Game; compact?: boolean }) {
  const { prices, loading, historicalLow, keyshops } = usePrices(game);

  const marketplaces = MARKETPLACES.filter((m) => m.sellsFor.some((p) => game.availableOn.includes(p)));
  const keyshopRow = keyshops && (
    <Group justify="space-between" wrap="nowrap" py={compact ? 8 : 10} style={{ borderTop: '1px solid var(--sp-line)' }}>
      <div style={{ minWidth: 0 }}>
        <Anchor href={keyshops.url} target="_blank" rel="noopener noreferrer" c="inherit" fw={600} size="sm">
          <Group gap={6} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
            Key shops
            <IconExternalLink size={13} style={{ opacity: 0.5 }} />
          </Group>
        </Anchor>
        <Text size="xs" c="dimmed">
          Lowest across G2A, Eneba, Kinguin and others, via GG.deals
          {keyshops.historicalLow ? `. Lowest ever ${formatPrice(keyshops.historicalLow)}` : ''}
        </Text>
      </div>
      <Text fw={700} className="num" style={{ flexShrink: 0 }}>
        {formatPrice(keyshops.price)}
      </Text>
    </Group>
  );

  const marketLinks = marketplaces.length > 0 && (
    <Text size="xs" c="dimmed" pt={10}>
      {keyshops ? 'Search a marketplace directly:' : 'Key marketplaces (no price feed, opens a search):'}{' '}
      {marketplaces.map((m, i) => (
        <span key={m.id}>
          {i > 0 && ', '}
          <Anchor href={m.searchUrl(game)} target="_blank" rel="noopener noreferrer" size="xs">
            {m.name}
          </Anchor>
        </span>
      ))}
    </Text>
  );

  if (!prices.length && !loading && !keyshops) {
    return (
      <Stack gap={0}>
        <Text size="sm" c="dimmed">
          None of the stores with price feeds list this game right now.
        </Text>
        {keyshopRow}
        {marketLinks}
      </Stack>
    );
  }

  const best = prices[0]?.price;

  return (
    <Stack gap={0}>
      {prices.map((p, i) => {
        const store = STORE_BY_ID[p.storeId];
        const discount = p.regular > p.price ? Math.round((1 - p.price / p.regular) * 100) : 0;
        return (
          <Group
            key={p.storeId}
            justify="space-between"
            wrap="nowrap"
            py={compact ? 8 : 10}
            style={{ borderTop: i ? '1px solid var(--sp-line)' : undefined }}
          >
            <div style={{ minWidth: 0 }}>
              <Anchor href={p.url} target="_blank" rel="noopener noreferrer" c="inherit" fw={600} size="sm">
                <Group gap={6} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
                  {store.name}
                  <IconExternalLink size={13} style={{ opacity: 0.5 }} />
                </Group>
              </Anchor>
              <Text size="xs" c="dimmed">
                {STORE_DELIVERS[p.storeId]}
              </Text>
            </div>
            <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
              {discount > 0 && (
                <Badge size="sm" color="green" variant="light" radius="xs" className="num">
                  −{discount}%
                </Badge>
              )}
              <div style={{ textAlign: 'right', minWidth: 64 }}>
                <Text fw={700} className="num" c={p.price === best ? undefined : 'dimmed'}>
                  {formatPrice(p.price)}
                </Text>
                {discount > 0 && (
                  <Text size="xs" c="dimmed" td="line-through" className="num">
                    {formatPrice(p.regular)}
                  </Text>
                )}
                {!p.live && (
                  <Tooltip label="This store has no public price feed. Check the store for current sales.">
                    <Text size="xs" c="dimmed" style={{ cursor: 'help', whiteSpace: 'nowrap' }}>
                      Full price
                    </Text>
                  </Tooltip>
                )}
              </div>
            </Group>
          </Group>
        );
      })}
      {keyshopRow}
      {loading && (
        <Group gap={8} py={8}>
          <Loader size={14} />
          <Text size="xs" c="dimmed">
            Checking live PC prices
          </Text>
        </Group>
      )}
      {!loading && !!historicalLow && (
        <Text size="xs" c="dimmed" pt={8}>
          Lowest PC price on record: {formatPrice(historicalLow)}. Prices in USD.
        </Text>
      )}
      {marketLinks}
    </Stack>
  );
}
