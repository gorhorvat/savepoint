import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowsShuffle, IconCheck, IconFlame, IconRefresh, IconTarget, IconUsers } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  amount,
  checkProgressNow,
  loadQuests,
  progressLabel,
  questFor,
  resetsIn,
  rerollQuest,
  useQuests,
  useQuestsFor,
  type Quest,
  type QuestPeriod,
} from '../lib/quests';

const TABS: { value: QuestPeriod; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

const TIER: Record<Quest['tier'], string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', shared: 'Everyone' };

const problem = (message: string) => notifications.show({ color: 'red', message, autoClose: 6000 });

function QuestRow({ q }: { q: Quest }) {
  const [busy, setBusy] = useState(false);
  const value = q.shared ? q.shared.total : q.progress;
  const percent = q.unit === 'percent' ? value : (value / q.target) * 100;
  const detail = q.shared
    ? `${progressLabel(q, q.shared.total)} · ${amount(q, q.progress)} from you` +
      (q.shared.people > 1 ? ` · ${q.shared.people} people helping` : '')
    : progressLabel(q);

  const swap = async () => {
    setBusy(true);
    const err = await rerollQuest(q.slot);
    setBusy(false);
    if (err) problem(err);
  };

  return (
    <div>
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }} align="flex-start">
          <ThemeIcon variant="light" radius="xl" size={30} color={q.done ? 'green' : undefined} aria-hidden>
            {q.done ? <IconCheck size={16} /> : q.shared ? <IconUsers size={16} /> : <IconTarget size={16} />}
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text fw={600} lh={1.3}>
              {q.title}
            </Text>
            <Text size="xs" c="dimmed" className="num" mt={2}>
              {q.done ? 'Done' : TIER[q.tier]} · {detail}
            </Text>
          </div>
        </Group>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {q.canReroll && (
            <Tooltip label="Swap for another quest (once a day)">
              <ActionIcon variant="subtle" color="gray" onClick={swap} loading={busy} aria-label={`Swap "${q.title}"`}>
                <IconArrowsShuffle size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <Badge variant={q.done ? 'filled' : 'light'} color={q.done ? 'green' : undefined} className="num">
            +{q.xp} XP
          </Badge>
        </Group>
      </Group>
      <Progress
        value={Math.min(100, percent)}
        size="sm"
        radius="xl"
        mt={8}
        color={q.done ? 'green' : undefined}
        aria-label={`${q.title}: ${detail}`}
      />
    </div>
  );
}

/** The Quests section on Home: tabs for daily, weekly and monthly, and "Check progress". */
export function QuestsSection() {
  const data = useQuests((s) => s.data);
  const checking = useQuests((s) => s.checking);
  const [tab, setTab] = useState<QuestPeriod>('day');

  useEffect(() => {
    if (!useQuests.getState().data) void loadQuests();
  }, []);

  const check = async () => {
    const err = await checkProgressNow();
    if (err) problem(err);
  };

  const shown = data?.quests.filter((q) => q.period === tab) ?? [];
  const count = (p: QuestPeriod) => {
    const qs = data?.quests.filter((q) => q.period === p) ?? [];
    return qs.length ? ` ${qs.filter((q) => q.done).length}/${qs.length}` : '';
  };

  return (
    <Stack gap="sm" component="section" aria-label="Quests">
      <Group justify="space-between" align="center">
        <Title order={2}>Quests</Title>
        {!data?.empty && (
          <Button
            size="xs"
            variant="default"
            leftSection={<IconRefresh size={14} />}
            loading={checking}
            onClick={check}
          >
            Check progress
          </Button>
        )}
      </Group>
      {!data ? (
        <Text size="sm" c="dimmed">
          Loading your quests…
        </Text>
      ) : data.empty ? (
        <Text size="sm" c="dimmed">
          Quests count play and achievements your platforms confirm.{' '}
          <Anchor component={Link} to="/platforms" inherit>
            Connect a platform
          </Anchor>{' '}
          to get your first ones.
        </Text>
      ) : (
        <Paper p={{ base: 'sm', sm: 'md' }}>
          <Group justify="space-between" mb="md" gap="sm" wrap="wrap">
            <SegmentedControl
              size="sm"
              value={tab}
              onChange={(v) => setTab(v as QuestPeriod)}
              data={TABS.map((t) => ({ value: t.value, label: `${t.label}${count(t.value)}` }))}
            />
            <Group gap="md">
              {data.streak > 0 && (
                <Group gap={4} c="dimmed">
                  <IconFlame size={16} aria-hidden />
                  <Text size="sm" className="num">
                    {data.streak}-day streak
                  </Text>
                </Group>
              )}
              <Text size="sm" c="dimmed">
                {resetsIn(data.periods[tab].endsAt)}
              </Text>
            </Group>
          </Group>
          <Stack gap="lg">
            {shown.map((q) => (
              <QuestRow key={`${q.period}-${q.slot}-${q.key}`} q={q} />
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

/** "Counts for today's quest" on a game's page, for quests that only count some games. */
export function QuestBadges({ gameId }: { gameId: string }) {
  const quests = useQuestsFor(gameId);
  if (!quests.length) return null;
  return (
    <Group gap={6} mt={8}>
      {quests.map((q) => (
        <Tooltip key={`${q.period}-${q.slot}`} label={`${q.title} · +${q.xp} XP`}>
          <Badge variant="light" tt="none" leftSection={<IconTarget size={12} />}>
            {questFor(q)}
          </Badge>
        </Tooltip>
      ))}
    </Group>
  );
}
