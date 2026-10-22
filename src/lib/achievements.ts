import { useEffect } from 'react';
import type { AchievementProgress } from '../types';
import { fetchPsnTrophies, fetchStatus, fetchSteamAchievements } from './api';
import { normalizeTitle } from './match';
import { resolveGame, useStore } from './store';

const PSN_MAX_AGE = 6 * 60 * 60 * 1000;
let running = false;

type Result = Omit<AchievementProgress, 'checkedAt'>;

/**
 * Fills in achievements (Steam) and trophies (PlayStation) in the background.
 * Steam is one request per game, so only games whose play time changed since
 * the last check are asked again; PlayStation is one request for everything.
 */
export async function runAchievementsSync(): Promise<void> {
  if (running) return;
  const { entries, connections, achievements, achievementsSync } = useStore.getState();
  const steamProfile = connections.steam?.account;
  const steamTodo = entries.filter(
    (e) =>
      e.platform === 'steam' &&
      e.source === 'steam' &&
      e.minutes > 0 &&
      achievements[e.gameId]?.steam?.minutesAt !== e.minutes,
  );
  const psnDue =
    !!connections.playstation?.lastSync &&
    (!achievementsSync || Date.now() - Date.parse(achievementsSync) > PSN_MAX_AGE);
  if ((!steamProfile || !steamTodo.length) && !psnDue) return;

  running = true;
  try {
    const status = await fetchStatus();
    if (!status.online) return;

    if (status.steam && steamProfile && steamTodo.length) {
      const { customGames, genreOverrides, details } = useStore.getState();
      const byApp = new Map<number, { gameId: string; minutes: number }>();
      for (const e of steamTodo) {
        const appid = resolveGame(e.gameId, customGames, genreOverrides, details)?.steamAppId;
        if (appid) byApp.set(appid, { gameId: e.gameId, minutes: e.minutes });
      }
      const appids = [...byApp.keys()];
      for (let i = 0; i < appids.length; i += 40) {
        const { results } = await fetchSteamAchievements(steamProfile, appids.slice(i, i + 40));
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
        if (t) out[e.gameId] = { earned: t.earned, total: t.total, platinum: t.platinum, minutesAt: e.minutes };
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
