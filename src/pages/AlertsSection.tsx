import { Anchor, Button, Checkbox, Chip, Code, Group, List, Paper, Slider, Stack, Switch, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBell, IconBellOff, IconCopy, IconRefresh } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAlertSettings,
  fetchDealAlertSettings,
  newAlertTopic,
  saveDealAlertSettings,
  sendTestAlert,
  turnOffAlerts,
  type AlertSettings,
  type DealAlertSettings,
  type FreeStore,
} from '../lib/api';

const FREE_STORE_LABELS: Record<FreeStore, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG',
  itchio: 'itch.io',
  ubisoft: 'Ubisoft',
  ea: 'EA',
  battlenet: 'Battle.net',
  amazon: 'Prime Gaming',
  playstation: 'PlayStation',
  xbox: 'Xbox',
  switch: 'Switch',
  mobile: 'Android / iOS',
  drmfree: 'DRM-free',
};

/** Free games (GamerPower) and big deals (IsThereAnyDeal), sent to the same ntfy topic. */
function DealAlerts() {
  const [s, setS] = useState<DealAlertSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchDealAlertSettings()
      .then(setS)
      .catch((e: Error) => setError(e.message));
  }, []);

  const save = async (next: DealAlertSettings) => {
    setS(next);
    setSaving(true);
    setError(null);
    try {
      setS(await saveDealAlertSettings(next));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const free = (patch: Partial<DealAlertSettings['freeGames']>) => s && save({ ...s, freeGames: { ...s.freeGames, ...patch } });
  const deals = (patch: Partial<DealAlertSettings['bigDeals']>) => s && save({ ...s, bigDeals: { ...s.bigDeals, ...patch } });

  if (!s) {
    return (
      <Text size="sm" c={error ? 'red' : 'dimmed'}>
        {error ?? 'Loading…'}
      </Text>
    );
  }
  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Switch
          label="Free games"
          description="Games given away to keep, on the stores you pick. Several at once arrive as one message."
          checked={s.freeGames.enabled}
          onChange={(e) => free({ enabled: e.currentTarget.checked })}
        />
        {s.freeGames.enabled && (
          <Stack gap="xs" pl={{ base: 0, sm: 54 }}>
            <Chip.Group
              multiple
              value={s.freeGames.stores}
              onChange={(v) => free({ stores: v as FreeStore[] })}
            >
              <Group gap={6}>
                {(Object.keys(FREE_STORE_LABELS) as FreeStore[]).map((k) => (
                  <Chip key={k} value={k} size="xs" radius="sm" variant="outline">
                    {FREE_STORE_LABELS[k]}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            {!s.freeGames.stores.length && (
              <Text size="xs" c="dimmed">
                No store picked: every store counts.
              </Text>
            )}
            <Group gap="lg">
              <Checkbox size="xs" label="Free DLC too" checked={s.freeGames.dlc} onChange={(e) => free({ dlc: e.currentTarget.checked })} />
              <Checkbox
                size="xs"
                label="In-game loot too"
                checked={s.freeGames.loot}
                onChange={(e) => free({ loot: e.currentTarget.checked })}
              />
            </Group>
            <Text size="xs" c="dimmed">
              Free games from {external('https://www.gamerpower.com', 'GamerPower')}.
            </Text>
          </Stack>
        )}
      </Stack>
      <Stack gap="xs">
        <Switch
          label="Big deals"
          description="Any PC game with a big discount, not just your wishlist."
          checked={s.bigDeals.enabled}
          onChange={(e) => deals({ enabled: e.currentTarget.checked })}
        />
        {s.bigDeals.enabled && (
          <Stack gap="sm" pl={{ base: 0, sm: 54 }} maw={480}>
            <div>
              <Text size="sm">At least {s.bigDeals.minCut}% off</Text>
              <Slider
                min={30}
                max={95}
                step={5}
                value={s.bigDeals.minCut}
                onChange={(v) => setS({ ...s, bigDeals: { ...s.bigDeals, minCut: v } })}
                onChangeEnd={(v) => deals({ minCut: v })}
                label={(v) => `${v}%`}
                marks={[50, 75, 90].map((v) => ({ value: v, label: `${v}%` }))}
                mb="md"
              />
            </div>
            <Checkbox
              size="xs"
              label="Only at the game's all-time low price"
              checked={s.bigDeals.historicalLow}
              onChange={(e) => deals({ historicalLow: e.currentTarget.checked })}
            />
            <Checkbox
              size="xs"
              label="Only well-reviewed games (75% or more positive on Steam)"
              checked={s.bigDeals.wellReviewed}
              onChange={(e) => deals({ wellReviewed: e.currentTarget.checked })}
            />
            <Text size="xs" c="dimmed">
              Deals from {external('https://isthereanydeal.com', 'IsThereAnyDeal')}, US prices.
            </Text>
          </Stack>
        )}
      </Stack>
      {(saving || error) && (
        <Text size="xs" c={error ? 'red' : 'dimmed'}>
          {error ?? 'Saving…'}
        </Text>
      )}
    </Stack>
  );
}

const external = (href: string, text: string) => (
  <Anchor href={href} target="_blank" rel="noopener noreferrer">
    {text}
  </Anchor>
);

/**
 * This account's price alerts: its own ntfy topic, how to subscribe to it on a
 * phone, a test, a new topic, and turning alerts off.
 */
export function AlertsSection() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [busy, setBusy] = useState<'on' | 'new' | 'off' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => {
    fetchAlertSettings()
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
  }, []);

  const run = (which: NonNullable<typeof busy>, fn: () => Promise<void>) => async () => {
    setBusy(which);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setConfirmNew(false);
    }
  };

  const turnOn = run('on', async () => {
    const topic = await newAlertTopic();
    setSettings((s) => ({ watching: s?.watching ?? 0, topic }));
  });
  const replace = run('new', async () => {
    const topic = await newAlertTopic();
    setSettings((s) => ({ watching: s?.watching ?? 0, topic }));
    notifications.show({ message: 'New topic made. Subscribe to it in the ntfy app; the old one gets nothing now.' });
  });
  const off = run('off', async () => {
    await turnOffAlerts();
    setSettings((s) => ({ watching: s?.watching ?? 0, topic: null }));
  });
  const test = run('test', async () => {
    await sendTestAlert();
    notifications.show({ message: 'Test sent. It should reach your phone in a few seconds.' });
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(settings?.topic ?? '');
      notifications.show({ message: 'Topic copied.', autoClose: 2000 });
    } catch {
      notifications.show({ message: "Couldn't copy. Select the topic and copy it instead.", color: 'red' });
    }
  };

  const topic = settings?.topic;
  return (
    <Stack gap="lg" id="alerts">
      <div>
        <Title order={2}>Price and deal alerts</Title>
        <Text c="dimmed" mt={6} maw={640}>
          Set a target price on a{' '}
          <Anchor component={Link} to="/wishlist">
            wishlist
          </Anchor>{' '}
          game, and your phone gets a notification when it drops to that price or lower. Savepoint checks once a day,
          through the free ntfy app.
        </Text>
      </div>
      <Paper p={{ base: 'md', sm: 'lg' }} maw={640}>
        <Stack gap="sm">
          {settings === null && !error ? (
            <Text size="sm" c="dimmed">
              Loading…
            </Text>
          ) : !topic ? (
            <>
              <Text size="sm">Alerts are off.</Text>
              <Button w="fit-content" leftSection={<IconBell size={16} />} loading={busy === 'on'} onClick={turnOn}>
                Turn on price alerts
              </Button>
            </>
          ) : (
            <>
              <List size="sm" type="ordered" spacing={6}>
                <List.Item>
                  Install ntfy on your phone (
                  {external('https://play.google.com/store/apps/details?id=io.heckel.ntfy', 'Android')},{' '}
                  {external('https://apps.apple.com/app/ntfy/id1625396347', 'iPhone')}).
                </List.Item>
                <List.Item>
                  In ntfy, tap <b>+</b> and subscribe to this topic:
                  <Group gap="xs" mt={6} wrap="nowrap">
                    <Code style={{ fontSize: 14, wordBreak: 'break-all' }}>{topic}</Code>
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconCopy size={14} />}
                      onClick={copy}
                      style={{ flexShrink: 0 }}
                    >
                      Copy
                    </Button>
                  </Group>
                </List.Item>
                <List.Item>Send a test to check it arrives.</List.Item>
              </List>
              <Text size="xs" c="dimmed">
                Anyone who knows the topic can read your alerts, so keep it to yourself. If it gets out, make a new one.
              </Text>
              <Text size="sm">
                {settings?.watching
                  ? `Watching ${settings.watching} ${settings.watching === 1 ? 'game' : 'games'} with a target price.`
                  : 'No target prices yet. Set one on a wishlist game.'}
              </Text>
              <Group gap="sm">
                <Button size="xs" loading={busy === 'test'} onClick={test}>
                  Send a test
                </Button>
                {confirmNew ? (
                  <>
                    <Button size="xs" color="red" variant="light" loading={busy === 'new'} onClick={replace}>
                      Make a new topic
                    </Button>
                    <Button size="xs" variant="subtle" color="gray" onClick={() => setConfirmNew(false)}>
                      Keep this one
                    </Button>
                  </>
                ) : (
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconRefresh size={14} />}
                    onClick={() => setConfirmNew(true)}
                  >
                    New topic
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconBellOff size={14} />}
                  loading={busy === 'off'}
                  onClick={off}
                >
                  Turn off
                </Button>
              </Group>
              {confirmNew && (
                <Text size="xs" c="dimmed">
                  The phone subscribed to the current topic stops getting alerts; subscribe to the new one instead.
                </Text>
              )}
            </>
          )}
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Paper>
      {topic && (
        <Paper p={{ base: 'md', sm: 'lg' }} maw={640}>
          <Stack gap="md">
            <div>
              <Title order={3}>Free games and big deals</Title>
              <Text size="sm" c="dimmed" mt={4}>
                Sent to the same topic, checked with your price alerts. Each one arrives once.
              </Text>
            </div>
            <DealAlerts />
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
