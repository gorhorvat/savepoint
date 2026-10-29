import { Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import type { Gw2Account } from '../../lib/gameStats';
import { BarList, StatTile } from '../charts';
import { Section } from '../GameSection';
import { Line } from '../StatParts';
import { coinText, fmt, goldText } from './format';
import { Coins, Img } from './parts';

/** What the account is worth on the trading post, and the whole wallet. */
export function WealthTab({ a }: { a: Gw2Account }) {
  const v = a.value;
  const coins = a.wallet?.find((w) => w.id === 1)?.value ?? null;
  return (
    <Stack gap={48}>
      {v ? (
        <>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <StatTile label="Sold to buy orders" value={goldText(v.buy)} note="Everything sold instantly, after fees" />
            <StatTile
              label="Listed for sale"
              value={goldText(v.sell)}
              note="Everything listed at the lowest price, after fees"
            />
            <StatTile label="Wallet coins" value={coins != null ? goldText(coins) : '—'} note="Included in both" />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} verticalSpacing={48}>
            <Section title="Where the value is" note="Listed value of tradeable items in each place, after fees.">
              <BarList
                bars={v.parts
                  .filter((p) => p.sell > 0)
                  .sort((x, y) => y.sell - x.sell)
                  .map((p) => ({ label: p.label, value: p.sell, display: coinText(p.sell) }))}
              />
            </Section>
            <Section title="Trading post" note="Your open listings and orders.">
              <Stack gap={4}>
                <Line
                  label={`Selling (${v.tp.selling.count} listings)`}
                  value={<Coins copper={v.tp.selling.value} />}
                />
                <Line label={`Buying (${v.tp.buying.count} orders)`} value={<Coins copper={v.tp.buying.value} />} />
                <Text size="xs" c="dimmed" mt={6}>
                  Prices update every few minutes. Account-bound items, the legendary armory and items no one trades
                  count as nothing.
                </Text>
              </Stack>
            </Section>
          </SimpleGrid>
          {v.top.length > 0 && (
            <Section title="Most valuable items" note="By listed value, summed over every stack on the account.">
              <div style={{ overflowX: 'auto' }}>
                <Table verticalSpacing={6} horizontalSpacing="sm" miw={560}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Item</Table.Th>
                      <Table.Th ta="right">Count</Table.Th>
                      <Table.Th ta="right">Sold to buy orders</Table.Th>
                      <Table.Th ta="right">Listed</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {v.top.map((t) => (
                      <Table.Tr key={t.id}>
                        <Table.Td>
                          <Group gap={8} wrap="nowrap">
                            <Img src={t.icon} rarity={t.rarity} size={26} />
                            <Text size="sm">{t.name}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right" className="num">
                          {fmt(t.count)}
                        </Table.Td>
                        <Table.Td ta="right">
                          <Coins copper={t.buy} />
                        </Table.Td>
                        <Table.Td ta="right">
                          <Coins copper={t.sell} />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            </Section>
          )}
        </>
      ) : (
        <Text c="dimmed">The account value needs the inventories and tradingpost permissions on the API key.</Text>
      )}

      <Section title="Wallet" note={a.wallet ? `${a.wallet.length} currencies.` : undefined}>
        {a.wallet ? (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing={28} verticalSpacing={4}>
            {a.wallet.map((w) => (
              <Line
                key={w.id}
                icon={<Img src={w.icon} size={18} />}
                label={w.name}
                value={w.id === 1 ? <Coins copper={w.value} /> : fmt(w.value)}
              />
            ))}
          </SimpleGrid>
        ) : (
          <Text c="dimmed">Needs the wallet permission on the API key.</Text>
        )}
      </Section>
    </Stack>
  );
}
