import { Anchor, Group, Paper, Select, Stack, TagsInput, Text, Title } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { CURRENCIES, formatMoney, useCurrency, useRatesDate } from '../lib/currency';
import { useStore } from '../lib/store';
import { normalizeVendor, searchesDirectly, SHOP_SUGGESTIONS, vendorSearchUrl } from '../lib/vendors';
import { AlertsSection } from './AlertsSection';
import { HomepageSection } from './HomepageSection';
import { MessageAlertsSection } from './MessageAlertsSection';

function CurrencySection() {
  const code = useCurrency();
  const setCurrency = useStore((s) => s.setCurrency);
  const { date, codes } = useRatesDate();
  const options = CURRENCIES.filter((c) => c.code === code || !codes || codes.includes(c.code)).map((c) => ({
    value: c.code,
    label: `${c.name} (${c.code})`,
  }));

  return (
    <Stack gap="lg" id="currency">
      <div>
        <Title order={2}>Currency</Title>
        <Text c="dimmed" mt={6}>
          Prices everywhere in Savepoint are shown in this currency, and prices you type in (like what you paid for a
          physical game) are in it too. Stores share their prices in US dollars, so those are converted with the
          day&apos;s European Central Bank rates and can be a little off from what a shop charges you.
        </Text>
      </div>
      <Paper p={{ base: 'md', sm: 'lg' }}>
        <Stack gap="xs">
          <Select
            label="Show prices in"
            data={options}
            value={code}
            onChange={(c) => c && setCurrency(c)}
            allowDeselect={false}
            searchable
            maw={360}
          />
          <Text size="sm" c="dimmed">
            {code === 'USD'
              ? 'A $19.99 game shows as $19.99.'
              : date
                ? `A $19.99 game shows as ${formatMoney(19.99)} (rates from ${new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}).`
                : "Exchange rates haven't loaded yet, so prices show in US dollars for now."}
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}

function ShopsSection() {
  const vendors = useStore((s) => s.vendors);
  const setVendors = useStore((s) => s.setVendors);
  const example = 'Bayonetta 3 Switch';

  return (
    <Stack gap="lg" id="shops">
      <div>
        <Title order={2}>Shops for physical games</Title>
        <Text c="dimmed" mt={6}>
          Each game you&apos;re looking for, and each physical game you gift a friend, gets a search link for every shop
          here. Type a shop&apos;s web address, like amazon.de or vinted.hr.
        </Text>
      </div>
      <Paper p={{ base: 'md', sm: 'lg' }}>
        <Stack gap="md">
          <TagsInput
            label="Your shops"
            placeholder={vendors.length ? 'Add another shop' : 'e.g. amazon.de'}
            data={SHOP_SUGGESTIONS.filter((s) => !vendors.includes(s))}
            value={vendors}
            onChange={(next) => setVendors([...new Set(next.map(normalizeVendor).filter(Boolean))])}
            splitChars={[',', ' ']}
            clearable
            acceptValueOnBlur
          />
          {vendors.length > 0 && (
            <Stack gap={6}>
              <Text size="sm" c="dimmed">
                How the links work, for example searching &ldquo;{example}&rdquo;:
              </Text>
              {vendors.map((v) => (
                <Group key={v} gap="xs" wrap="nowrap">
                  <Anchor href={vendorSearchUrl(v, example)} target="_blank" rel="noopener noreferrer" size="sm">
                    <Group gap={4} wrap="nowrap" component="span">
                      {v}
                      <IconExternalLink size={13} />
                    </Group>
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    {searchesDirectly(v) ? 'searches the shop' : 'searches the shop through Google'}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

export function SettingsPage() {
  return (
    <Stack gap={48}>
      <div>
        <Title order={1}>Settings</Title>
        <Text c="dimmed" mt={6} size="lg">
          Your homepage, currency, shops for physical games, and alerts. Platforms and streaming have their own pages in
          your profile menu.
        </Text>
      </div>
      <HomepageSection />
      <CurrencySection />
      <ShopsSection />
      <AlertsSection />
      <MessageAlertsSection />
    </Stack>
  );
}
