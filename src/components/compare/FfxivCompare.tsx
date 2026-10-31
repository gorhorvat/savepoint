import { Badge, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { Comparison } from '../../lib/compare';
import type { FfxivCharacter, FfxivCollection, FfxivJob, FfxivSnapshot } from '../../lib/gameStats';
import { CompareSection, MINE, PairBars, Row, THEIRS } from './CompareView';
import { Heading } from '../StatParts';

type C = Comparison<FfxivCharacter, FfxivSnapshot>;

const ROLES: { role: FfxivJob['role']; label: string }[] = [
  { role: 'Tank', label: 'Tanks' },
  { role: 'Healer', label: 'Healers' },
  { role: 'Melee', label: 'Melee DPS' },
  { role: 'Ranged', label: 'Physical ranged' },
  { role: 'Caster', label: 'Magical ranged' },
  { role: 'Limited', label: 'Limited' },
  { role: 'Crafter', label: 'Hand' },
  { role: 'Gatherer', label: 'Land' },
];
const LIMITED = new Set(['BLUEMAGE', 'BEASTMASTER']);
const roleOf = (j: FfxivJob): FfxivJob['role'] => (LIMITED.has(j.key) ? 'Limited' : j.role);

/** Every job side by side, as two bars per job, grouped by role. */
function Jobs({ c }: { c: C }) {
  const cap = Math.max(c.me.data.levelCap ?? 100, c.them.data.levelCap ?? 100);
  const theirs = new Map(c.them.data.jobs.map((j) => [j.key, j]));
  const groups = ROLES.map((r) => ({
    ...r,
    jobs: c.me.data.jobs.filter((j) => roleOf(j) === r.role),
  })).filter((g) => g.jobs.length);
  const ahead = c.me.data.jobs.filter((j) => j.level > (theirs.get(j.key)?.level ?? 0)).length;
  const behind = c.me.data.jobs.filter((j) => j.level < (theirs.get(j.key)?.level ?? 0)).length;
  return (
    <CompareSection
      title="Jobs"
      note={`Higher on ${ahead}, lower on ${behind}, level with each other on ${c.me.data.jobs.length - ahead - behind}.`}
    >
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg" verticalSpacing="md">
        {groups.map((g) => (
          <Stack key={g.role} gap={6}>
            <Heading>{g.label}</Heading>
            {g.jobs.map((j) => {
              const t = theirs.get(j.key);
              const mine = j.level;
              const other = t?.level ?? 0;
              return (
                <div key={j.key}>
                  <Group justify="space-between" gap={6} wrap="nowrap" mb={2}>
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                      {j.icon && <img src={j.icon} alt="" width={18} height={18} loading="lazy" />}
                      <Text size="sm" truncate>
                        {j.name}
                      </Text>
                    </Group>
                    <Text size="sm" className="num" style={{ flexShrink: 0 }}>
                      <span style={{ color: mine >= other ? MINE : undefined, fontWeight: mine > other ? 700 : 400 }}>
                        {mine || '—'}
                      </span>
                      <Text component="span" c="dimmed" size="sm">
                        {' / '}
                      </Text>
                      <span style={{ color: other >= mine ? THEIRS : undefined, fontWeight: other > mine ? 700 : 400 }}>
                        {other || '—'}
                      </span>
                    </Text>
                  </Group>
                  <PairBars mine={mine} theirs={other} max={cap} />
                </div>
              );
            })}
          </Stack>
        ))}
      </SimpleGrid>
    </CompareSection>
  );
}

/** Mounts or minions: counts, and what one has that the other doesn't. */
function Collection({
  what,
  mine,
  theirs,
  theirName,
}: {
  what: string;
  mine: FfxivCollection;
  theirs: FfxivCollection;
  theirName: string;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!mine.public || !theirs.public) {
    return (
      <Paper p="md" radius="md">
        <Text fw={600}>{what}</Text>
        <Text size="sm" c="dimmed">
          {!mine.public ? `Yours are private on the Lodestone.` : `${theirName}'s are private on the Lodestone.`}
        </Text>
      </Paper>
    );
  }
  const myNames = new Set(mine.list.map((x) => x.name));
  const theirNames = new Set(theirs.list.map((x) => x.name));
  const onlyMine = mine.list.filter((x) => !theirNames.has(x.name));
  const onlyTheirs = theirs.list.filter((x) => !myNames.has(x.name));
  const LIMIT = 24;
  const list = (items: FfxivCollection['list'], color: string) => (
    <Group gap={4}>
      {(showAll ? items : items.slice(0, LIMIT)).map((x) => (
        <Badge
          key={x.name}
          variant="light"
          color={color}
          size="sm"
          radius="sm"
          tt="none"
          fw={500}
          leftSection={x.icon ? <img src={x.icon} alt="" width={14} height={14} loading="lazy" /> : undefined}
        >
          {x.name}
        </Badge>
      ))}
      {!showAll && items.length > LIMIT && (
        <Badge
          variant="outline"
          color="gray"
          size="sm"
          radius="sm"
          tt="none"
          fw={500}
          style={{ cursor: 'pointer' }}
          onClick={() => setShowAll(true)}
        >
          +{items.length - LIMIT} more
        </Badge>
      )}
    </Group>
  );
  return (
    <Paper p="md" radius="md">
      <Stack gap="sm">
        <Row
          label={what}
          mine={mine.count.toLocaleString()}
          theirs={theirs.count.toLocaleString()}
          who={mine.count === theirs.count ? 0 : mine.count > theirs.count ? 1 : -1}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          <Stack gap={6}>
            <Text size="sm" c="dimmed">
              Only you have ({onlyMine.length})
            </Text>
            {onlyMine.length ? (
              list(onlyMine, 'gold')
            ) : (
              <Text size="sm" c="dimmed">
                Nothing they don&apos;t.
              </Text>
            )}
          </Stack>
          <Stack gap={6}>
            <Text size="sm" c="dimmed">
              Only {theirName} has ({onlyTheirs.length})
            </Text>
            {onlyTheirs.length ? (
              list(onlyTheirs, 'blue')
            ) : (
              <Text size="sm" c="dimmed">
                Nothing you don&apos;t.
              </Text>
            )}
          </Stack>
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}

/** Gear by slot: item level and name on each side. */
function Gear({ c }: { c: C }) {
  const myGear = c.me.data.gear ?? [];
  const theirGear = c.them.data.gear ?? [];
  const theirs = new Map(theirGear.map((g) => [g.key, g]));
  const mine = new Map(myGear.map((g) => [g.key, g]));
  const keys = [...new Set([...myGear.map((g) => g.key), ...theirGear.map((g) => g.key)])];
  if (!keys.length) return null;
  const job = (ch: FfxivCharacter) => (ch.gear ?? []).find((g) => g.key === 'SOULCRYSTAL')?.name ?? null;
  return (
    <CompareSection
      title="Gear"
      note={`Average item level ${c.me.data.itemLevel ?? '—'} vs ${c.them.data.itemLevel ?? '—'}, on whatever job each of you last wore${
        job(c.me.data) || job(c.them.data)
          ? ` (${[job(c.me.data), job(c.them.data)].map((x) => x ?? '—').join(' vs ')})`
          : ''
      }.`}
    >
      <Paper p="md" radius="md">
        <Stack gap={0}>
          {keys.map((key) => {
            const a = mine.get(key);
            const b = theirs.get(key);
            const slot = a?.slot ?? b?.slot ?? key;
            const la = a?.itemLevel ?? null;
            const lb = b?.itemLevel ?? null;
            const who = la == null || lb == null || la === lb ? 0 : la > lb ? 1 : -1;
            const side = (g: typeof a, level: number | null, align: 'left' | 'right') => (
              <Group
                gap={6}
                wrap="nowrap"
                justify={align === 'left' ? 'flex-start' : 'flex-end'}
                style={{ minWidth: 0 }}
              >
                {align === 'right' && level != null && <span>{level}</span>}
                {g?.icon && <img src={g.icon} alt="" width={20} height={20} loading="lazy" style={{ flexShrink: 0 }} />}
                <Text size="xs" c="dimmed" truncate style={{ maxWidth: 160 }}>
                  {g?.name ?? '—'}
                </Text>
                {align === 'left' && level != null && <span>{level}</span>}
              </Group>
            );
            return <Row key={key} label={slot} mine={side(a, la, 'left')} theirs={side(b, lb, 'right')} who={who} />;
          })}
        </Stack>
      </Paper>
    </CompareSection>
  );
}

/** FINAL FANTASY XIV's own comparison sections: jobs, collections, gear. */
export function FfxivCompare({ c }: { c: C }) {
  const theirName = c.them.name ?? (c.them.kind === 'friend' ? c.them.user.username : 'them');
  return (
    <>
      <Jobs c={c} />
      <CompareSection title="Mounts and minions" note="What each of you has that the other doesn't.">
        <Stack gap="md">
          <Collection what="Mounts" mine={c.me.data.mounts} theirs={c.them.data.mounts} theirName={theirName} />
          <Collection what="Minions" mine={c.me.data.minions} theirs={c.them.data.minions} theirName={theirName} />
        </Stack>
      </CompareSection>
      <Gear c={c} />
    </>
  );
}
