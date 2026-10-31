import { Anchor, Avatar, Badge, Group, Loader, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { BarList, StatTile } from '../components/charts';
import { Section } from '../components/GameSection';
import { Line } from '../components/StatParts';
import { SteamGameTab } from '../components/SteamGameTab';
import { day, num, resultColor } from '../lib/steamGameFormat';
import { TrendChart, type TrendPoint } from '../components/TrendChart';
import { fetchGameHistory, type DotaData, type DotaSnapshot, type Snapshot } from '../lib/gameStats';

const MEDALS = ['', 'Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'];

function medalText(m: DotaData['medal']) {
  if (!m?.name) return 'Uncalibrated';
  if (m.name === 'Immortal') return m.leaderboard ? `Immortal #${m.leaderboard}` : 'Immortal';
  return `${m.name}${m.stars ? ` ${m.stars}` : ''}`;
}

/** Rank as a number for the graph: Herald 1 is 11, Immortal is 80. */
const tierTick = (v: number) => {
  const m = Math.floor(v / 10);
  return MEDALS[m] ? `${MEDALS[m]}${m < 8 && v % 10 ? ` ${v % 10}` : ''}` : '';
};

function HeroIcon({ image, name, size = 32 }: { image: string | null; name: string; size?: number }) {
  return (
    <Avatar src={image} alt={name} radius="sm" size={size} style={{ width: size * 1.78 }}>
      {name.slice(0, 2)}
    </Avatar>
  );
}

/** Dota 2 in My Stats, from OpenDota for the linked Steam account. */
export function Dota2Stats() {
  return (
    <SteamGameTab<DotaData>
      game="dota2"
      title="Dota 2"
      intro={
        <>
          Your rank medal, wins, heroes and recent matches come from{' '}
          <Anchor href="https://www.opendota.com" target="_blank" rel="noreferrer" size="sm">
            OpenDota
          </Anchor>{' '}
          for your linked Steam account. Turn on &quot;Expose Public Match Data&quot; in Dota 2&apos;s settings
          (Options, Social) so your matches show.
        </>
      }
      links={(d) => [
        { label: 'OpenDota profile', href: d.url },
        { label: 'Steam profile', href: `https://steamcommunity.com/profiles/${d.steamId}/` },
      ]}
      heading={(d) => ({
        name: d.name ?? 'Dota 2',
        detail: `${medalText(d.medal)}${d.totals.hours != null ? ` · ${num(d.totals.hours)} h in matches` : ''}`,
      })}
    >
      {(conn) => <DotaBody d={conn.data} refreshedAt={conn.fetchedAt} />}
    </SteamGameTab>
  );
}

function DotaBody({ d, refreshedAt }: { d: DotaData; refreshedAt: string }) {
  const t = d.totals;
  const games = d.wins + d.losses;
  return (
    <Stack gap={48}>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xl">
        <StatTile label="Rank" value={medalText(d.medal)} note={d.medal ? undefined : 'Play ranked to get a medal'} />
        <StatTile
          label="Win rate"
          value={d.winRate != null ? `${num(d.winRate, 1)}%` : '–'}
          note={`${num(d.wins)} wins, ${num(d.losses)} losses`}
        />
        <StatTile label="KDA" value={num(t.kda, 2)} note="average per match" />
        <StatTile label="Matches" value={num(games)} note={t.hours != null ? `${num(t.hours)} h` : undefined} />
      </SimpleGrid>

      {games === 0 && (
        <Text size="sm" c="dimmed">
          No matches yet. Turn on &quot;Expose Public Match Data&quot; in Dota 2&apos;s settings, play a match, then
          refresh. OpenDota can take a little while to pick up new matches.
        </Text>
      )}

      {(d.heroes.length > 0 || games > 0) && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48}>
          {d.heroes.length > 0 && (
            <Section title="Heroes" note="Your most played, with win rate.">
              <BarList
                bars={d.heroes.map((h) => ({
                  label: h.name,
                  value: h.games,
                  display: `${num(h.games)} · ${h.winRate != null ? `${num(h.winRate, 1)}%` : '–'}`,
                  icon: <HeroIcon image={h.image} name={h.name} size={18} />,
                }))}
              />
            </Section>
          )}
          <Section title="Averages" note="Per match, over all your public matches.">
            <Stack gap={6}>
              <Line label="Gold per minute" value={num(t.gpm)} />
              <Line label="Experience per minute" value={num(t.xpm)} />
              <Line label="Last hits / denies" value={`${num(t.lastHits)} / ${num(t.denies)}`} />
              <Line label="Hero damage" value={num(t.heroDamage)} />
              <Line label="Tower damage" value={num(t.towerDamage)} />
              <Line label="Healing" value={num(t.healing)} />
              <Line
                label="Kills / deaths / assists, all time"
                value={`${num(t.kills)} / ${num(t.deaths)} / ${num(t.assists)}`}
              />
            </Stack>
          </Section>
        </SimpleGrid>
      )}

      {d.recent.length > 0 && (
        <Section title="Recent matches">
          <Stack gap="sm">
            {d.recent.map((m) => (
              <div
                key={m.id}
                style={{ borderLeft: `3px solid ${resultColor(m.won ? 'win' : 'loss')}`, paddingLeft: 10 }}
              >
                <Group justify="space-between" gap="sm" wrap="nowrap">
                  <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                    <HeroIcon image={m.hero.image} name={m.hero.name} />
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>
                        {m.hero.name}
                        {m.ranked && (
                          <Badge component="span" size="xs" variant="light" ml={6} radius="xs" tt="none">
                            Ranked
                          </Badge>
                        )}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        <Text span size="xs" fw={600} c={resultColor(m.won ? 'win' : 'loss')}>
                          {m.won ? 'Win' : 'Loss'}
                        </Text>{' '}
                        · {m.mode} · {day(m.at)}
                      </Text>
                    </div>
                  </Group>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <Anchor
                      href={`https://www.opendota.com/matches/${m.id}`}
                      target="_blank"
                      rel="noreferrer"
                      size="sm"
                      c="inherit"
                      className="num"
                    >
                      {m.kills} / {m.deaths} / {m.assists}
                    </Anchor>
                    <Text size="xs" c="dimmed" className="num">
                      {m.gpm != null ? `${m.gpm} GPM · ` : ''}
                      {m.lastHits != null ? `${m.lastHits} LH · ` : ''}
                      {m.minutes} min
                    </Text>
                  </div>
                </Group>
              </div>
            ))}
          </Stack>
        </Section>
      )}

      <DotaProgress refreshedAt={refreshedAt} />
    </Stack>
  );
}

const series = (days: Snapshot<DotaSnapshot>[], key: keyof DotaSnapshot): TrendPoint[] =>
  days.filter((s) => s.data[key] != null).map((s) => ({ day: s.day, value: s.data[key] as number }));

function DotaProgress({ refreshedAt }: { refreshedAt: string }) {
  const [days, setDays] = useState<Snapshot<DotaSnapshot>[] | null>(null);
  useEffect(() => {
    fetchGameHistory<DotaSnapshot>('dota2')
      .then(setDays)
      .catch(() => setDays([]));
  }, [refreshedAt]);
  if (!days) return <Loader size="sm" />;
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={48}>
      <Section title="Rank over time">
        <TrendChart points={series(days, 'rankTier')} format={tierTick} tickFormat={tierTick} />
      </Section>
      <Section title="Win rate over time">
        <TrendChart points={series(days, 'winRate')} format={(v) => `${v.toFixed(1)}%`} />
      </Section>
    </SimpleGrid>
  );
}
