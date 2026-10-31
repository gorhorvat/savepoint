import { Anchor, Badge, Group, Loader, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { BarList, StatTile } from '../components/charts';
import { Section } from '../components/GameSection';
import { Heading, Line, Meter } from '../components/StatParts';
import { SteamGameTab } from '../components/SteamGameTab';
import { day, num, resultColor } from '../lib/steamGameFormat';
import { TrendChart, type TrendPoint } from '../components/TrendChart';
import { fetchGameHistory, type Cs2Data, type Cs2Snapshot, type Snapshot } from '../lib/gameStats';

const SOURCES: Record<string, string> = { matchmaking: 'Premier / MM', faceit: 'FACEIT', renown: 'Renown' };

const pct = (v: number | null | undefined) => (v == null ? '–' : `${num(v, 1)}%`);
const signed = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);

// Premier ratings carry their colour band in CS2 (grey, light blue, blue, purple, pink, red, gold).
function premierColor(r: number) {
  if (r >= 30000) return 'var(--mantine-color-yellow-5)';
  if (r >= 25000) return 'var(--mantine-color-red-5)';
  if (r >= 20000) return 'var(--mantine-color-pink-5)';
  if (r >= 15000) return 'var(--mantine-color-grape-5)';
  if (r >= 10000) return 'var(--mantine-color-blue-5)';
  if (r >= 5000) return 'var(--mantine-color-cyan-4)';
  return 'var(--mantine-color-gray-5)';
}

/** Counter-Strike 2 in My Stats, from the linked Steam account (and Leetify, when the player uses it). */
export function Cs2Stats() {
  return (
    <SteamGameTab<Cs2Data>
      game="cs2"
      title="Counter-Strike 2"
      intro={
        <>
          Your lifetime numbers, weapons, maps and play time come from your linked Steam account (its Game details must
          be public). If you use{' '}
          <Anchor href="https://leetify.com" target="_blank" rel="noreferrer" size="sm">
            Leetify
          </Anchor>
          , your Premier rating, FACEIT level, aim ratings and recent matches show too.
        </>
      }
      links={(d) => [
        { label: 'Steam profile', href: `https://steamcommunity.com/profiles/${d.steamId}/` },
        ...(d.leetify ? [{ label: 'Leetify profile', href: d.leetify.url }] : []),
      ]}
      heading={(d) => ({
        name: d.leetify?.name ?? 'Counter-Strike 2',
        detail:
          d.hours != null
            ? `${num(d.hours)} h played${d.hoursTwoWeeks ? `, ${num(d.hoursTwoWeeks, 1)} h in the last two weeks` : ''}`
            : '',
      })}
    >
      {(conn) => <Cs2Body d={conn.data} refreshedAt={conn.fetchedAt} />}
    </SteamGameTab>
  );
}

function Cs2Body({ d, refreshedAt }: { d: Cs2Data; refreshedAt: string }) {
  const l = d.leetify;
  const life = d.lifetime;
  return (
    <Stack gap={48}>
      {l ? (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xl">
          <StatTile
            label="Premier"
            value={l.premier ? <span style={{ color: premierColor(l.premier) }}>{num(l.premier)}</span> : '–'}
            note={l.premier ? 'CS Rating' : 'No Premier rating yet'}
          />
          <StatTile
            label="FACEIT"
            value={l.faceit ? `Level ${l.faceit}` : '–'}
            note={l.faceitElo ? `${num(l.faceitElo)} Elo` : 'Not on FACEIT'}
          />
          <StatTile label="Leetify rating" value={signed(l.leetify)} note={`${num(l.matches)} matches on Leetify`} />
          <StatTile
            label="Win rate"
            value={pct(l.winrate)}
            note={l.wingman ? `Wingman rank ${l.wingman}` : undefined}
          />
        </SimpleGrid>
      ) : (
        <Text size="sm" c="dimmed">
          No Premier rating or recent matches: Steam doesn&apos;t share them. Sign in once at{' '}
          <Anchor href="https://leetify.com" target="_blank" rel="noreferrer" size="sm">
            leetify.com
          </Anchor>{' '}
          with this Steam account and they&apos;ll show here after the next refresh.
        </Text>
      )}

      {life && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xl">
          <StatTile label="K/D" value={life.kd ?? '–'} note={`${num(life.kills)} kills, ${num(life.deaths)} deaths`} />
          <StatTile label="Headshots" value={pct(life.headshots)} note="of all kills" />
          <StatTile label="Accuracy" value={pct(life.accuracy)} note="shots that hit" />
          <StatTile label="MVPs" value={num(life.mvps)} note={`${num(life.roundsWon)} rounds won`} />
        </SimpleGrid>
      )}

      {l && (l.ratings || l.aim) && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
          {l.ratings && (
            <Section title="Leetify ratings" note="How you compare with other players, out of 100.">
              <Stack gap="sm">
                {(
                  [
                    ['Aim', l.ratings.aim],
                    ['Positioning', l.ratings.positioning],
                    ['Utility', l.ratings.utility],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label}>
                    <Line label={label} value={num(v)} />
                    <Meter value={v ?? 0} max={100} />
                  </div>
                ))}
                <Line label="Clutch" value={pct(l.ratings.clutch)} />
                <Line label="Opening duels" value={pct(l.ratings.opening)} />
                <Line label="As CT / as T" value={`${signed(l.ratings.ct)} / ${signed(l.ratings.t)}`} />
              </Stack>
            </Section>
          )}
          {l.aim && (
            <Section title="Aim" note="From your recent Leetify matches.">
              <Stack gap={6}>
                <Line label="Head accuracy" value={pct(l.aim.headshot)} />
                <Line label="Accuracy with the enemy in sight" value={pct(l.aim.spotted)} />
                <Line label="Spray accuracy" value={pct(l.aim.spray)} />
                <Line label="Counter-strafing" value={pct(l.aim.counterStrafe)} />
                <Line label="Crosshair placement" value={l.aim.preaim != null ? `${l.aim.preaim}°` : '–'} />
                <Line label="Reaction time" value={l.aim.reaction != null ? `${l.aim.reaction} ms` : '–'} />
              </Stack>
            </Section>
          )}
        </SimpleGrid>
      )}

      {l && l.recent.length > 0 && (
        <Section title="Recent matches" note="From Leetify.">
          <Stack gap="sm">
            {l.recent.map((m) => (
              <div key={m.id} style={{ borderLeft: `3px solid ${resultColor(m.outcome)}`, paddingLeft: 10 }}>
                <Group justify="space-between" gap="sm" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} truncate>
                      {m.map}
                      {m.source && (
                        <Badge component="span" size="xs" variant="light" ml={6} radius="xs" tt="none">
                          {SOURCES[m.source] ?? m.source}
                        </Badge>
                      )}
                    </Text>
                    <Text size="xs" c="dimmed">
                      <Text span size="xs" fw={600} c={resultColor(m.outcome)}>
                        {m.outcome === 'win' ? 'Win' : m.outcome === 'loss' ? 'Loss' : 'Tie'}
                      </Text>{' '}
                      · {day(m.at)}
                      {m.rank ? ` · rank ${num(m.rank)}` : ''}
                    </Text>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <Text size="sm" className="num">
                      {m.score ? `${m.score[0]} : ${m.score[1]}` : '–'}
                    </Text>
                    <Text size="xs" c="dimmed" className="num">
                      {signed(m.rating)} rating
                    </Text>
                  </div>
                </Group>
              </div>
            ))}
          </Stack>
        </Section>
      )}

      {(d.weapons.length > 0 || d.maps.length > 0) && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
          {d.weapons.length > 0 && (
            <Section title="Weapons" note="Kills with each, and how many shots hit.">
              <BarList
                bars={d.weapons.map((w) => ({
                  label: w.name,
                  value: w.kills,
                  display: `${num(w.kills)}${w.accuracy != null ? ` · ${num(w.accuracy, 1)}%` : ''}`,
                }))}
              />
            </Section>
          )}
          {d.maps.length > 0 && (
            <Section title="Maps" note="Rounds played on each, and the share you won.">
              <BarList
                bars={d.maps.map((m) => ({
                  label: m.name,
                  value: m.rounds,
                  display: `${num(m.rounds)} rounds · ${pct(m.rounds ? (m.wins / m.rounds) * 100 : null)}`,
                }))}
              />
            </Section>
          )}
        </SimpleGrid>
      )}

      {life && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
          <Section title="Lifetime" note="Steam's totals. Valve hasn't kept every one of them up to date since CS2.">
            <Stack gap={6}>
              <Heading>Rounds and matches</Heading>
              <Line label="Rounds won / played" value={`${num(life.roundsWon)} / ${num(life.rounds)}`} />
              {life.matches > 0 && (
                <Line label="Matches won / played" value={`${num(life.matchesWon)} / ${num(life.matches)}`} />
              )}
              <Line label="Damage dealt" value={num(life.damage)} />
              <Line label="Money earned" value={`$${num(life.money)}`} />
              {life.timePlayed != null && <Line label="Time in matches" value={`${num(life.timePlayed)} h`} />}
              <Heading>Objectives</Heading>
              <Line label="Bombs planted" value={num(life.planted)} />
              <Line label="Bombs defused" value={num(life.defused)} />
              <Line label="Hostages rescued" value={num(life.hostages)} />
            </Stack>
          </Section>
          <Section title="Kills of note">
            <Stack gap={6}>
              <Line label="Knife kills" value={num(life.knifeKills)} />
              <Line label="With the enemy's weapon" value={num(life.enemyWeaponKills)} />
              <Line label="Of blinded enemies" value={num(life.blinded)} />
              <Line label="Of snipers while scoped" value={num(life.zoomedSnipers)} />
              <Line label="Dominations" value={num(life.dominations)} />
              <Line label="Revenges" value={num(life.revenges)} />
              {d.lastMatch && (
                <>
                  <Heading>Last match on Steam</Heading>
                  <Line label="Kills / deaths" value={`${num(d.lastMatch.kills)} / ${num(d.lastMatch.deaths)}`} />
                  <Line label="Rounds won" value={`${num(d.lastMatch.roundsWon)} of ${num(d.lastMatch.rounds)}`} />
                  <Line label="Damage" value={num(d.lastMatch.damage)} />
                  <Line label="MVPs" value={num(d.lastMatch.mvps)} />
                </>
              )}
            </Stack>
          </Section>
        </SimpleGrid>
      )}

      <Cs2Progress refreshedAt={refreshedAt} hasLeetify={!!l} />
    </Stack>
  );
}

const series = (days: Snapshot<Cs2Snapshot>[], key: keyof Cs2Snapshot): TrendPoint[] =>
  days.filter((s) => s.data[key] != null).map((s) => ({ day: s.day, value: s.data[key] as number }));

function Cs2Progress({ refreshedAt, hasLeetify }: { refreshedAt: string; hasLeetify: boolean }) {
  const [days, setDays] = useState<Snapshot<Cs2Snapshot>[] | null>(null);
  useEffect(() => {
    fetchGameHistory<Cs2Snapshot>('cs2')
      .then(setDays)
      .catch(() => setDays([]));
  }, [refreshedAt]);
  if (!days) return <Loader size="sm" />;
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={48}>
      {hasLeetify && (
        <Section title="Premier rating over time">
          <TrendChart points={series(days, 'premier')} />
        </Section>
      )}
      <Section title="Hours played over time">
        <TrendChart points={series(days, 'hours')} />
      </Section>
    </SimpleGrid>
  );
}
