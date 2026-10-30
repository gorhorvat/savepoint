import { Anchor, Badge, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { STORE_DELIVERS, STORES, type StoreInfo } from '../data/stores';

const KINDS: { kind: StoreInfo['kind']; title: string; about: string }[] = [
  { kind: 'Official storefront', title: 'Official storefronts', about: 'Sold by the platform itself.' },
  { kind: 'Authorized reseller', title: 'Authorized resellers', about: 'Keys bought directly from publishers.' },
  {
    kind: 'Key marketplace',
    title: 'Key marketplaces',
    about:
      'Independent sellers list keys, often for less. Check the seller’s rating and the site’s buyer protection before buying. Price lists show the lowest key-shop price from GG.deals (for games on Steam, when GGDEALS_API_KEY is set); each site also links to a search.',
  },
];

/** Where to buy: official storefronts, authorized resellers and key marketplaces (on the wishlist). */
export function StoreDirectory() {
  return (
    <Stack gap="xl" id="stores">
      {KINDS.map(({ kind, title, about }) => (
        <Stack key={kind} gap="md">
          <div>
            <Title order={2}>{title}</Title>
            <Text size="sm" c="dimmed" mt={4}>
              {about}
            </Text>
          </div>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
            {STORES.filter((s) => s.kind === kind).map((s) => (
              <div key={s.id} className="tile">
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
              </div>
            ))}
          </SimpleGrid>
        </Stack>
      ))}
    </Stack>
  );
}
