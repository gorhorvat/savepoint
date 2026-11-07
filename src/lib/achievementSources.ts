import type { AchievementProgress, Game, PlatformId, PlayEntry } from '../types';

export interface AchievementSource {
  platform: PlatformId;
  /** The server address of this platform's list for the game. */
  url: string;
  /** Versions with lists of their own (PS4 and PS5), the one counted first. */
  versions?: { label: string; url: string }[];
}

/**
 * The achievement list address of each platform you play a game on, for
 * platforms that have achievements for it. Used by the game page and the
 * rarity sync, so both read the same lists.
 */
export function achievementSources(
  game: Game,
  entries: PlayEntry[],
  achievements: Partial<Record<PlatformId, AchievementProgress>> | undefined,
): AchievementSource[] {
  const out: AchievementSource[] = [];
  for (const e of entries.filter((x) => x.gameId === game.id)) {
    if (!achievements?.[e.platform]?.total || out.some((s) => s.platform === e.platform)) continue;
    const ref = e.ref ? encodeURIComponent(e.ref) : null;
    // PlayStation: the lists of each version (PS4, PS5) the counts were matched to.
    const sets = e.source === 'psn' ? (achievements[e.platform]?.psnLists ?? []) : [];
    if (sets.length) {
      const versions = sets.map((s) => ({
        label: s.label,
        url: `/api/psn/trophies/list?ids=${s.ids.map(encodeURIComponent).join(',')}`,
      }));
      out.push({ platform: e.platform, url: versions[0].url, ...(versions.length > 1 && { versions }) });
      continue;
    }
    const url =
      e.source === 'steam' && game.steamAppId
        ? `/api/steam/achievements/list?appid=${game.steamAppId}`
        : e.source === 'psn'
          ? `/api/psn/trophies/list?title=${encodeURIComponent(game.title)}`
          : ref && e.source === 'xbox'
            ? `/api/xbox/achievements/list?ref=${ref}`
            : ref && (e.source === 'epic' || e.source === 'gog' || e.source === 'retro')
              ? `/api/${e.source}/achievements?ref=${ref}`
              : null;
    if (url) out.push({ platform: e.platform, url });
  }
  return out;
}
