import { Anchor, Badge, Grid, Group, Paper, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { Cover } from '../components/Cover';
import { GameSearch } from '../components/GameSearch';
import { PriceTable } from '../components/PriceTable';
import { CATALOG_BY_ID } from '../data/catalog';
import { STORE_DELIVERS, STORES, type StoreInfo } from '../data/stores';
import type { FoundGame } from '../lib/api';
import { useGameResolver, useStore } from '../lib/store';
import type { Game } from '../types';

const KINDS: { kind: StoreInfo['kind']; about: string }[] = [
  { kind: 'Official storefront', about: 'Sold by the platform itself.' },
  { kind: 'Authorized reseller', about: 'Keys bought directly from publishers.' },
  {
    kind: 'Key marketplace',
    about:
      'Independent sellers list keys, often for less. Check the seller’s rating and the site’s buyer protection before buying. Price lists show the lowest key-shop price from GG.deals (for games on Steam, when GGDEALS_API_KEY is set); each site also links to a search.',
  },
];

export function StoresPage() {
  const wishlist = useStore((s) => s.wishlist);
  const resolve = useGameResolver();
  const wishGames = useMemo(
    () => wishlist.map((w) => resolve(w.gameId)).filter((g): g is Game => !!g),
    [wishlist, resolve],
  );
  const [picked, setPicked] = useState<Game | null>(null);
  const game = picked ?? wishGames[0] ?? CATALOG_BY_ID['hades-ii'];

  const pickFound = (f: FoundGame) =>
    setPicked({ ...f, id: `search-${f.title}`, custom: true });

  return (
    <Stack gap={40}>
      <div>
        <Title order={1}>Stores</Title>
        <Text c="dimmed" mt={6} size="lg" maw={640}>
          Official storefronts, authorized resellers, and key marketplaces, with live prices where the store
          publishes them.
        </Text>
      </div>

      <Paper p={{ base: 'md', sm: 'xl' }}>
        <Grid gap="xl">
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Title order={2}>Compare prices</Title>
            <Text size="sm" c="dimmed" mt={4} mb="md">
              PC prices are live from CheapShark and Switch prices from the Nintendo eShop. The PlayStation Store has
              no public price feed, so it shows the typical full price.
            </Text>
            <Stack gap="sm">
              {wishGames.length > 0 && (
                <Select
                  label="From your wishlist"
                  data={wishGames.map((g) => ({ value: g.id, label: g.title }))}
                  value={wishGames.some((g) => g.id === game.id) ? game.id : null}
                  onChange={(id) => setPicked(wishGames.find((g) => g.id === id) ?? null)}
                  searchable
                  placeholder="Pick a wishlisted game"
                />
              )}
              <GameSearch actionLabel="Compare" onPick={pickFound} placeholder="Or search any game" />
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Group gap="md" wrap="nowrap" mb="md">
              <Cover game={game} width={140} radius={8} />
              <Text fw={700} size="lg">
                {game.title}
              </Text>
            </Group>
            <PriceTable key={game.id} game={game} />
          </Grid.Col>
        </Grid>
      </Paper>

      {KINDS.map(({ kind, about }) => (
        <Stack key={kind} gap="md">
          <div>
            <Title order={2}>{kind === 'Key marketplace' ? 'Key marketplaces' : `${kind}s`}</Title>
            <Text size="sm" c="dimmed" mt={4} maw={640}>
              {about}
            </Text>
          </div>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
            {STORES.filter((s) => s.kind === kind).map((s) => (
              <Paper key={s.id} p="md" radius="md">
                <Anchor href={s.url} target="_blank" rel="noopener noreferrer" c="inherit" fw={700}>
                  <Group gap={6} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
                    {s.name}
                    <IconExternalLink size={14} style={{ opacity: 0.5 }} />
                  </Group>
                </Anchor>
                <Group gap={6} mt={6}>
                  <Badge size="sm" radius="xs" tt="none" variant="outline" color="gray">
                    {STORE_DELIVERS[s.id]}
                  </Badge>
                </Group>
                <Text size="sm" mt="sm" c="dimmed" lh={1.45}>
                  {s.about}
                </Text>
              </Paper>
            ))}
          </SimpleGrid>
        </Stack>
      ))}
    </Stack>
  );
}
