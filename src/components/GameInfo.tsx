import { ActionIcon, Anchor, Group, Image, Modal, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import type { GameInfo } from '../lib/api';
import { formatPlaytime } from '../lib/format';

const TIER_COLOR: Record<string, string> = {
  Mighty: 'var(--sp-c3)',
  Strong: 'var(--sp-c1)',
  Fair: 'var(--sp-c4)',
  Weak: 'var(--sp-c2)',
};

/** 0 to 100 -> the tier colour it falls in. */
const scoreColor = (n: number) =>
  n >= 84 ? TIER_COLOR.Mighty : n >= 74 ? TIER_COLOR.Strong : n >= 65 ? TIER_COLOR.Fair : TIER_COLOR.Weak;

type Outlet = NonNullable<NonNullable<GameInfo['critic']>['outlets']>[number];

/** Individual reviews from big outlets, each linking to the review. */
function OutletScores({ outlets }: { outlets: Outlet[] }) {
  return (
    <Stack gap={4} miw={200}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.4}>
        Critics
      </Text>
      {outlets.map((o) => (
        <Group key={o.outlet} gap={8} wrap="nowrap" justify="space-between">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: scoreColor(o.normalized) }}
            />
            {o.url ? (
              <Anchor href={o.url} target="_blank" rel="noopener noreferrer" size="sm" c="inherit" truncate>
                {o.outlet}
              </Anchor>
            ) : (
              <Text size="sm" truncate>
                {o.outlet}
              </Text>
            )}
          </Group>
          <Text size="sm" fw={600} className="num" style={{ whiteSpace: 'nowrap' }}>
            {o.score}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

/** Critic score and typical length, with how far along you are. */
export function GameFacts({ info, playedMinutes }: { info: GameInfo; playedMinutes?: number }) {
  const { critic, length } = info;
  if (!critic && !length?.main) return null;
  const pct =
    length?.main && playedMinutes ? Math.min(100, Math.round((playedMinutes / 60 / length.main) * 100)) : null;
  return (
    <Group gap="xl" align="flex-start" wrap="wrap">
      {critic && (
        <div>
          <Group gap={8} align="baseline" wrap="nowrap">
            <Text className="display num" fw={700} fz={26} lh={1}>
              {critic.score}
            </Text>
            {critic.tier && (
              <Group gap={5} wrap="nowrap">
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: TIER_COLOR[critic.tier] ?? 'var(--sp-c-other)',
                  }}
                />
                <Text size="sm">{critic.tier}</Text>
              </Group>
            )}
          </Group>
          <Anchor href={critic.url} target="_blank" rel="noopener noreferrer" size="xs" c="dimmed">
            OpenCritic, {critic.reviews} critic reviews
          </Anchor>
        </div>
      )}
      {critic?.outlets && critic.outlets.length > 0 && <OutletScores outlets={critic.outlets} />}
      {length?.main && (
        <div>
          <Text className="display num" fw={700} fz={26} lh={1}>
            ~{length.main} h
          </Text>
          <Anchor href={length.url} target="_blank" rel="noopener noreferrer" size="xs" c="dimmed">
            to beat the main story{length.complete ? `, ~${length.complete} h for everything` : ''}
          </Anchor>
          {pct !== null && playedMinutes ? (
            <Text size="xs" c="dimmed" mt={2}>
              You've played {formatPlaytime(playedMinutes)}
              {pct >= 100 ? ', more than the main story usually takes.' : `, about ${pct}% of the main story.`}
            </Text>
          ) : null}
        </div>
      )}
    </Group>
  );
}

/** A scrolling strip of screenshots; click one to view it large. */
export function Screenshots({ shots, title }: { shots: { thumb: string; full: string }[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!shots.length) return null;
  const step = (d: number) => setOpen((i) => (i === null ? i : (i + d + shots.length) % shots.length));
  return (
    <Stack gap="sm">
      <ScrollArea type="auto" offsetScrollbars>
        <Group gap="sm" wrap="nowrap">
          {shots.map((s, i) => (
            <button
              key={s.thumb}
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`Open screenshot ${i + 1} of ${shots.length}`}
              style={{ padding: 0, border: 0, background: 'none', cursor: 'zoom-in', flexShrink: 0 }}
            >
              <Image src={s.thumb} alt="" w={280} h={158} radius="sm" fit="cover" loading="lazy" />
            </button>
          ))}
        </Group>
      </ScrollArea>
      <Modal
        opened={open !== null}
        onClose={() => setOpen(null)}
        size="80rem"
        centered
        title={`${title}, screenshot ${(open ?? 0) + 1} of ${shots.length}`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') step(1);
          if (e.key === 'ArrowLeft') step(-1);
        }}
      >
        {open !== null && (
          <Stack gap="sm">
            <Image src={shots[open].full} alt={`${title} screenshot ${open + 1}`} radius="sm" />
            {shots.length > 1 && (
              <Group justify="center" gap="xs">
                <Tooltip label="Previous (left arrow)">
                  <ActionIcon variant="default" onClick={() => step(-1)} aria-label="Previous screenshot">
                    <IconChevronLeft size={18} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Next (right arrow)">
                  <ActionIcon variant="default" onClick={() => step(1)} aria-label="Next screenshot">
                    <IconChevronRight size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
