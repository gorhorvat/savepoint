import { Anchor, Group, Paper, Stack, TagsInput, Text, Title } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { useStore } from '../lib/store';
import { normalizeVendor, searchesDirectly, SHOP_SUGGESTIONS, vendorSearchUrl } from '../lib/vendors';
import { AlertsSection } from './AlertsSection';
import { PlatformsSection } from './PlatformsSection';

function ShopsSection() {
  const vendors = useStore((s) => s.vendors);
  const setVendors = useStore((s) => s.setVendors);
  const example = 'Bayonetta 3 Switch';

  return (
    <Stack gap="lg" id="shops">
      <div>
        <Title order={2}>Shops for physical wants</Title>
        <Text c="dimmed" mt={6} maw={640}>
          Each game you&apos;re looking for gets a search link for every shop here. Type a shop&apos;s web address, like
          amazon.de or vinted.hr.
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
          Shops for your physical wants, price alerts, and the platforms your play time comes from.
        </Text>
      </div>
      <ShopsSection />
      <AlertsSection />
      <PlatformsSection />
    </Stack>
  );
}
