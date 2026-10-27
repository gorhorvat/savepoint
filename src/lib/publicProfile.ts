import { useEffect, useMemo } from 'react';
import { savePublicProfile, type PublicProfile } from './friends';
import { platformTotals, useLibrary } from './library';
import { resolveGame, useStore } from './store';
import { useXp } from './xp';

const hours = (minutes: number) => Math.round(minutes / 6) / 10;

let lastSent = '';

/**
 * Keeps what friends see of you up to date: level and rank, picture,
 * favourites, top games and hours, and wishlist. Sent a few seconds after it
 * changes, and only when it did.
 */
export function usePublicProfileSync() {
  const xp = useXp();
  const lib = useLibrary();
  const profile = useStore((s) => s.profile);
  const wishlist = useStore((s) => s.wishlist);
  const customGames = useStore((s) => s.customGames);
  const overrides = useStore((s) => s.genreOverrides);
  const details = useStore((s) => s.details);

  const snapshot = useMemo<PublicProfile>(() => {
    const totals = platformTotals(lib);
    const played = lib.filter((g) => g.totalMinutes > 0);
    return {
      level: xp.level,
      rank: xp.rank,
      xp: xp.total,
      into: xp.into,
      needed: xp.needed,
      avatar: profile.avatar ?? null,
      favoriteGenres: profile.favoriteGenres,
      favoriteFranchises: profile.favoriteFranchises,
      totalHours: hours(played.reduce((n, g) => n + g.totalMinutes, 0)),
      gameCount: played.length,
      hoursByPlatform: Object.fromEntries(
        Object.entries(totals)
          .filter(([, m]) => m > 0)
          .map(([p, m]) => [p, hours(m)]),
      ),
      topGames: [...played]
        .sort((a, b) => b.totalMinutes - a.totalMinutes)
        .slice(0, 12)
        .map((g) => ({
          title: g.game.title,
          imageUrl: g.game.imageUrl,
          hours: hours(g.totalMinutes),
          platforms: [...new Set(g.plays.filter((p) => p.minutes > 0).map((p) => p.platform))],
        })),
      wishlist: wishlist
        .map((w) => resolveGame(w.gameId, customGames, overrides, details))
        .filter((g) => !!g)
        .slice(0, 60)
        .map((g) => ({ title: g.title, imageUrl: g.imageUrl, platforms: g.availableOn })),
    };
  }, [xp, lib, profile, wishlist, customGames, overrides, details]);

  useEffect(() => {
    const json = JSON.stringify(snapshot);
    if (json === lastSent) return;
    const timer = setTimeout(() => {
      savePublicProfile(snapshot)
        .then(() => {
          lastSent = json;
        })
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, [snapshot]);
}
