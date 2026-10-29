import { Group, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import type { FfxivCharacter } from '../../lib/gameStats';
import { StatTile } from '../charts';
import { Section } from '../GameSection';
import { Line, Meter } from '../StatParts';
import { Crest } from './Crest';

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());

/** The character's Free Company, from its Lodestone page. */
export function FreeCompanyTab({ ch }: { ch: FfxivCharacter }) {
  const fc = ch.freeCompanyPage;
  if (!ch.freeCompany) return <Text c="dimmed">This character isn&apos;t in a Free Company.</Text>;
  if (!fc) return <Text c="dimmed">Refresh to read {ch.freeCompany.name}&apos;s Lodestone page.</Text>;
  return (
    <Stack gap={48}>
      <Group gap="md" wrap="nowrap" align="flex-start">
        <Crest layers={fc.crest.length ? fc.crest : ch.freeCompany.crest} size={64} />
        <div style={{ minWidth: 0 }}>
          <Text className="display" fz={26} lh={1.15}>
            {fc.name}
            {fc.tag && (
              <Text span c="dimmed" fz={18}>
                {' '}
                {fc.tag}
              </Text>
            )}
          </Text>
          {fc.slogan && (
            <Text size="sm" c="dimmed" mt={4} maw={720} style={{ whiteSpace: 'pre-line' }}>
              {fc.slogan}
            </Text>
          )}
        </div>
      </Group>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatTile label="Rank" value={fmt(fc.rank)} />
        <StatTile label="Active members" value={fmt(fc.members)} />
        <StatTile
          label="Weekly ranking"
          value={fc.ranking.weekly ? `#${fmt(fc.ranking.weekly)}` : '—'}
          note="Previous week"
        />
        <StatTile
          label="Monthly ranking"
          value={fc.ranking.monthly ? `#${fmt(fc.ranking.monthly)}` : '—'}
          note="Previous month"
        />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} verticalSpacing={48}>
        <Section title="About">
          <Stack gap={4}>
            <Line
              label="Formed"
              value={fc.formed ? new Date(fc.formed).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'}
            />
            <Line label="World" value={fc.world ?? '—'} />
            <Line
              label="Grand Company"
              value={
                fc.grandCompany
                  ? `${fc.grandCompany.name}${fc.grandCompany.rank ? ` (${fc.grandCompany.rank})` : ''}`
                  : '—'
              }
            />
            <Line label="Active" value={fc.active ?? '—'} />
            <Line label="Recruitment" value={fc.recruiting ?? '—'} />
            <Line label="Estate" value={fc.estate?.name ?? 'None'} />
            {fc.estate?.plot && (
              <Text size="xs" c="dimmed">
                {fc.estate.plot}
              </Text>
            )}
          </Stack>
          {fc.focus.length > 0 && (
            <>
              <Text fw={700} size="xs" c="dimmed" tt="uppercase" mt="lg" mb={6}>
                Focus
              </Text>
              <Group gap={8}>
                {fc.focus.map((f) => (
                  <Tooltip key={f.name} label={`${f.name}${f.on ? '' : ' (not a focus)'}`}>
                    {f.icon ? (
                      <img src={f.icon} alt={f.name} width={32} height={32} style={{ opacity: f.on ? 1 : 0.3 }} />
                    ) : (
                      <Text size="sm" c={f.on ? undefined : 'dimmed'}>
                        {f.name}
                      </Text>
                    )}
                  </Tooltip>
                ))}
              </Group>
            </>
          )}
        </Section>
        {fc.reputation.length > 0 && (
          <Section title="Reputation" note="Standing with each Grand Company.">
            <Stack gap={12}>
              {fc.reputation.map((r) => (
                <div key={r.name}>
                  <Line label={r.name} value={r.rank ?? '—'} />
                  {r.progress != null && <Meter value={r.progress} max={100} />}
                </div>
              ))}
            </Stack>
          </Section>
        )}
      </SimpleGrid>
    </Stack>
  );
}
