import { useEffect } from 'react';
import type { AchievementProgress, EntrySource, PlatformId } from '../types';
import { fetchPsnTrophies, fetchStatus, fetchSteamAchievements } from './api';
import { normalizeTitle } from './match';
import { resolveGame, useStore, type ImportedGame } from './store';

const PSN_MAX_AGE = 6 * 60 * 60 * 1000;
let running = false;

type Result = Omit<AchievementProgress, 'checkedAt'>;

/**
 * Fills in achievements (Steam) and trophies (PlayStation) in the background.
 * Steam is one request per game, so only games whose play time changed since
 * the last check are asked again; PlayStation is one request for everything.
 */
export async function runAchievementsSync({ forcePsn = false } = {}): Promise<void> {
  if (running) return;
  const { entries, connections, achievements, achievementsSync } = useStore.getState();
  // While Steam says the profile's Game details are private, ask again every 6 hours, not on every change.
  const steamPrivate =
    !!connections.steam?.achievementsPrivate &&
    Date.now() - Date.parse(connections.steam.achievementsPrivate) < PSN_MAX_AGE;
  const steamConnected = !!connections.steam && !steamPrivate;
  const steamTodo = entries.filter(
    (e) =>
      e.platform === 'steam' &&
      e.source === 'steam' &&
      e.minutes > 0 &&
      achievements[e.gameId]?.steam?.minutesAt !== e.minutes,
  );
  // A manual PlayStation sync refreshes trophies right away; otherwise every 6 hours.
  const psnDue =
    !!connections.playstation?.lastSync &&
    (forcePsn || !achievementsSync || Date.now() - Date.parse(achievementsSync) > PSN_MAX_AGE);
  if ((!steamConnected || !steamTodo.length) && !psnDue) return;

  running = true;
  try {
    const status = await fetchStatus();
    if (!status.online) return;

    if (status.steam && steamConnected && steamTodo.length) {
      const { customGames, genreOverrides, details } = useStore.getState();
      const byApp = new Map<number, { gameId: string; minutes: number }>();
      for (const e of steamTodo) {
        const appid = resolveGame(e.gameId, customGames, genreOverrides, details)?.steamAppId;
        if (appid) byApp.set(appid, { gameId: e.gameId, minutes: e.minutes });
      }
      const appids = [...byApp.keys()];
      for (let i = 0; i < appids.length; i += 40) {
        const { results, private: hidden } = await fetchSteamAchievements(appids.slice(i, i + 40));
        useStore.getState().setSteamAchievementsPrivate(!!hidden);
        if (hidden) break;
        const out: Record<string, Result> = {};
        for (const [appid, r] of Object.entries(results)) {
          const hit = byApp.get(Number(appid));
          if (hit) out[hit.gameId] = { ...r, minutesAt: hit.minutes };
        }
        useStore.getState().applyAchievements('steam', out);
      }
    }

    if (status.psn && psnDue) {
      const { titles } = await fetchPsnTrophies();
      const byTitle = new Map(titles.map((t) => [normalizeTitle(t.name), t]));
      const { entries: now, customGames, genreOverrides, details } = useStore.getState();
      const out: Record<string, Result> = {};
      for (const e of now.filter((x) => x.platform === 'playstation' && x.source === 'psn')) {
        const title = resolveGame(e.gameId, customGames, genreOverrides, details)?.title;
        const t = title && byTitle.get(normalizeTitle(title));
        if (t) {
          out[e.gameId] = {
            earned: t.earned,
            total: t.total,
            platinum: t.platinum,
            grades: t.grades,
            minutesAt: e.minutes,
          };
        }
      }
      useStore.getState().applyAchievements('playstation', out, true);
    }
  } catch {
    // Nice-to-have: the next change or app open tries again.
  } finally {
    running = false;
  }
}

/** Runs after every sync or import (when play time changes) and on app open. */
export function useAchievementsSync() {
  const entries = useStore((s) => s.entries);
  useEffect(() => {
    void runAchievementsSync();
  }, [entries]);
}

/**
 * Platforms that send achievements with their game list (Xbox with gamerscore,
 * Epic) have them saved straight after the import: matched to the imported
 * games by the platform's id, or by title.
 */
export function applyImportedAchievements(platform: PlatformId, source: EntrySource, games: ImportedGame[]) {
  const withAchievements = games.filter((g) => g.achievements);
  const byRef = new Map(withAchievements.filter((g) => g.externalId).map((g) => [g.externalId!, g.achievements!]));
  const byTitle = new Map(withAchievements.map((g) => [normalizeTitle(g.name), g.achievements!]));
  const { entries, customGames, genreOverrides, details } = useStore.getState();
  const out: Record<string, Result> = {};
  for (const e of entries.filter((x) => x.platform === platform && x.source === source)) {
    const title = resolveGame(e.gameId, customGames, genreOverrides, details)?.title;
    const a = (e.ref && byRef.get(e.ref)) || (title && byTitle.get(normalizeTitle(title)));
    if (a) out[e.gameId] = { ...a, minutesAt: e.minutes };
  }
  useStore.getState().applyAchievements(platform, out);
}

export const applyXboxAchievements = (games: ImportedGame[]) => applyImportedAchievements('xbox', 'xbox', games);
