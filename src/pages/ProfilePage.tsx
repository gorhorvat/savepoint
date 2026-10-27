import {
  Avatar,
  Button,
  FileButton,
  Group,
  MultiSelect,
  Paper,
  Progress,
  Stack,
  TagsInput,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLogout, IconPhoto, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchTaxonomy, type Taxonomy } from '../lib/api';
import { favoriteFranchise, favoriteGenresOf, makeFavorites, seriesInLibrary } from '../lib/favorites';
import { useLibrary } from '../lib/library';
import { logOut } from '../lib/serverStorage';
import { useStore } from '../lib/store';
import { nextRank, useXp, XP } from '../lib/xp';

/** Center-crops and shrinks a picture to a small JPEG, so it stays light to save and sync. */
async function toAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  canvas
    .getContext('2d')!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** The logged-in VerBuddy username. */
function useUsername(): string | null {
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setUser(s?.user ?? null))
      .catch(() => {});
  }, []);
  return user;
}

function PictureSection() {
  const avatar = useStore((s) => s.profile.avatar);
  const update = useStore((s) => s.updateProfile);
  const user = useUsername();

  const pick = async (file: File | null) => {
    if (!file) return;
    try {
      update({ avatar: await toAvatar(file) });
    } catch {
      notifications.show({ message: "That picture couldn't be opened. Try a JPEG or PNG.", color: 'red' });
    }
  };

  return (
    <Paper p={{ base: 'md', sm: 'lg' }}>
      <Group gap="lg" wrap="wrap">
        <Avatar src={avatar} size={96} radius={96} color="gold" alt="Your profile picture">
          {user?.slice(0, 2).toUpperCase()}
        </Avatar>
        <Stack gap="xs">
          {user && (
            <Text fw={600} size="lg">
              {user}
            </Text>
          )}
          <Group gap="xs">
            <FileButton onChange={pick} accept="image/*">
              {(props) => (
                <Button {...props} variant="default" size="xs" leftSection={<IconPhoto size={15} />}>
                  {avatar ? 'Change picture' : 'Add a picture'}
                </Button>
              )}
            </FileButton>
            {avatar && (
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                leftSection={<IconTrash size={15} />}
                onClick={() => update({ avatar: undefined })}
              >
                Remove
              </Button>
            )}
          </Group>
        </Stack>
      </Group>
    </Paper>
  );
}

function FavoritesSection() {
  const profile = useStore((s) => s.profile);
  const update = useStore((s) => s.updateProfile);
  const lib = useLibrary();
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  useEffect(() => {
    fetchTaxonomy()
      .then(setTaxonomy)
      .catch(() => {});
  }, []);

  // Everything Savepoint knows plus whatever your own games are tagged with.
  const genreOptions = useMemo(() => {
    const genres = new Set([...(taxonomy?.genres ?? []), ...lib.flatMap((l) => l.game.genres)]);
    const subs = new Set(
      [...(taxonomy?.subgenres ?? []), ...lib.flatMap((l) => l.game.subgenres)].filter((s) => !genres.has(s)),
    );
    const sorted = (xs: Set<string>) => [...xs].sort((a, b) => a.localeCompare(b));
    // Keep chosen names selectable even if no list has them any more.
    const extra = profile.favoriteGenres.filter((g) => !genres.has(g) && !subs.has(g));
    return [
      { group: 'Genres', items: sorted(genres) },
      { group: 'Sub-genres', items: [...sorted(subs), ...extra] },
    ];
  }, [taxonomy, lib, profile.favoriteGenres]);

  const series = useMemo(() => seriesInLibrary(lib.map((l) => l.game.title)), [lib]);
  const favorites = useMemo(
    () => makeFavorites(profile.favoriteGenres, profile.favoriteFranchises),
    [profile.favoriteGenres, profile.favoriteFranchises],
  );
  const genreMatches = lib.filter((l) => favoriteGenresOf(l.game, favorites).length).length;
  const perFranchise = profile.favoriteFranchises.map((name) => ({
    name,
    n: lib.filter((l) => favoriteFranchise(l.game, favorites) === name).length,
  }));

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Favourites</Title>
        <Text c="dimmed" mt={6} maw={680}>
          Games in your favourite genres and franchises come first in Play next and &ldquo;More like this&rdquo;, and
          they&apos;re marked in rose with a heart wherever they appear.
        </Text>
      </div>
      <Paper p={{ base: 'md', sm: 'lg' }}>
        <Stack gap="xl">
          <Stack gap={6}>
            <MultiSelect
              label="Favourite genres"
              placeholder={profile.favoriteGenres.length ? 'Add another' : 'e.g. Survival horror'}
              data={genreOptions}
              value={profile.favoriteGenres}
              onChange={(favoriteGenres) => update({ favoriteGenres })}
              searchable
              clearable
              hidePickedOptions
              selectFirstOptionOnChange
              nothingFoundMessage="No genre with that name"
            />
            {profile.favoriteGenres.length > 0 && (
              <Text size="xs" c="dimmed">
                {genreMatches} {genreMatches === 1 ? 'game' : 'games'} in your library{' '}
                {genreMatches === 1 ? 'is' : 'are'} in these genres.
              </Text>
            )}
          </Stack>
          <Stack gap={6}>
            <TagsInput
              label="Favourite franchises"
              description="Matched by name in game titles, so “Resident Evil” covers Resident Evil 4, Village and the rest."
              placeholder={profile.favoriteFranchises.length ? 'Add another' : 'e.g. Resident Evil'}
              data={series.filter((s) => !profile.favoriteFranchises.includes(s))}
              value={profile.favoriteFranchises}
              onChange={(next) =>
                update({ favoriteFranchises: [...new Set(next.map((x) => x.trim()).filter(Boolean))] })
              }
              clearable
              acceptValueOnBlur
            />
            {perFranchise.length > 0 && (
              <Text size="xs" c="dimmed">
                In your library: {perFranchise.map((f) => `${f.name} ${f.n}`).join(' · ')}
              </Text>
            )}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}

const fmt = (n: number) => Math.round(n).toLocaleString();

/** Level, rank and where your XP comes from. */
function LevelSection() {
  const xp = useXp();
  const t = xp.trophies;
  const graded = t.bronze + t.silver + t.gold;
  const rows: { label: string; detail: string; xp: number }[] = [
    {
      label: 'PlayStation trophies',
      detail: graded
        ? `${fmt(t.platinum)} platinum, ${fmt(t.gold)} gold, ${fmt(t.silver)} silver, ${fmt(t.bronze)} bronze` +
          (t.ungraded ? `, ${fmt(t.ungraded)} not graded yet` : '')
        : `${fmt(t.platinum)} platinum and ${fmt(t.ungraded)} other trophies (exact grades arrive with the next PlayStation sync)`,
      xp: t.xp,
    },
    {
      label: 'Steam achievements',
      detail: `${fmt(xp.steam.achievements)} achievements, ${fmt(xp.steam.perfectGames)} ${
        xp.steam.perfectGames === 1 ? 'game' : 'games'
      } completed`,
      xp: xp.steam.xp,
    },
    ...(xp.xbox.achievements
      ? [
          {
            label: 'Xbox achievements',
            detail: `${fmt(xp.xbox.achievements)} achievements, ${fmt(xp.xbox.gamerscore)} gamerscore`,
            xp: xp.xbox.xp,
          },
        ]
      : []),
    {
      label: 'Play time',
      detail: `${fmt(xp.hours.confirmed)} hours confirmed by Steam, PlayStation and Xbox`,
      xp: xp.hours.xp,
    },
  ];

  return (
    <section aria-label="Level">
      <Group gap="xl" align="flex-end" wrap="wrap">
        <div>
          <Text c="dimmed" fw={600}>
            Level
          </Text>
          <Text className="display num" fz={88} lh={0.9} c="var(--mantine-primary-color-filled)">
            {xp.level}
          </Text>
        </div>
        <Stack gap={6} style={{ flex: '1 1 260px' }} mb={6}>
          <Group justify="space-between" align="baseline">
            <Text fw={800} fz={28} style={{ fontStretch: '78%' }}>
              {xp.rank}
            </Text>
            <Text size="sm" c="dimmed" className="num">
              {fmt(xp.total)} XP
            </Text>
          </Group>
          <Progress value={(xp.into / xp.needed) * 100} size="md" radius="xl" aria-label="Progress to the next level" />
          <Text size="sm" c="dimmed" className="num">
            {fmt(xp.needed - xp.into)} XP to level {xp.level + 1}
            {nextRank(xp.level) && `, ${nextRank(xp.level)!.name} at level ${nextRank(xp.level)!.level}`}
          </Text>
        </Stack>
      </Group>

      <Stack gap={4} mt="xl">
        {rows.map((r) => (
          <Group key={r.label} justify="space-between" wrap="nowrap" gap="md" className="xp-row">
            <div style={{ minWidth: 0 }}>
              <Text fw={600}>{r.label}</Text>
              <Text size="sm" c="dimmed">
                {r.detail}
              </Text>
            </div>
            <Text fw={700} className="num" style={{ flexShrink: 0 }}>
              {fmt(r.xp)} XP
            </Text>
          </Group>
        ))}
      </Stack>
      <Text size="sm" c="dimmed" mt="md" maw={680}>
        XP only counts what Steam, PlayStation and Xbox confirm: trophies earn Sony&apos;s points (bronze {XP.bronze},
        silver {XP.silver}, gold {XP.gold}, platinum {XP.platinum}), Steam achievements {XP.steamAchievement} each plus{' '}
        {XP.steamPerfect} for completing a game, Xbox achievements their gamerscore, and {XP.perHour} per hour played.
        {xp.hours.unconfirmed >= 1 &&
          ` The ${fmt(xp.hours.unconfirmed)} hours you added by hand (Switch, Epic) don't count, and neither do apps.`}
      </Text>
    </section>
  );
}

export function ProfilePage() {
  return (
    <Stack gap={48}>
      <div>
        <Title order={1}>Profile</Title>
        <Text c="dimmed" mt={6} size="lg">
          Your picture, your level, and what you love playing.
        </Text>
      </div>
      <PictureSection />
      <LevelSection />
      <FavoritesSection />
      <Button
        variant="subtle"
        color="gray"
        leftSection={<IconLogout size={16} />}
        onClick={() => void logOut()}
        w="fit-content"
      >
        Log out
      </Button>
    </Stack>
  );
}
