import { useEffect } from 'react';
import type { AchievementProgress, EntrySource, PlatformId, PlayEntry, PsnListSet, TrophyGrades } from '../types';
import { fetchPsnTrophies, fetchStatus, fetchSteamAchievements, type PsnTrophyTitle } from './api';
import { normalizeTitle } from './match';
import { resolveGame, useStore, type ImportedGame } from './store';

const PSN_MAX_AGE = 6 * 60 * 60 * 1000;
let running = false;

type Result = Omit<AchievementProgress, 'checkedAt'>;

/** "PS4,PSVITA" -> "PS4/Vita" */
const consoleLabel = (platform: string) =>
  platform
    .split(',')
    .filter(Boolean)
    .map((p) => (p === 'PSVITA' ? 'Vita' : p))
    .join('/') || 'PlayStation';

/** Several trophy lists of one version of a game, counted together. */
function combine(lists: PsnTrophyTitle[]): PsnListSet & { platinum: boolean; grades?: TrophyGrades } {
  const graded = lists.filter((t) => t.grades);
  return {
    label: [...new Set(lists.map((t) => consoleLabel(t.platform)))].join(' + '),
    ids: lists.map((t) => t.id),
    earned: lists.reduce((n, t) => n + t.earned, 0),
    total: lists.reduce((n, t) => n + t.total, 0),
    platinum: lists.some((t) => t.platinum),
    grades: graded.length
      ? {
          bronze: graded.reduce((n, t) => n + (t.grades?.bronze ?? 0), 0),
          silver: graded.reduce((n, t) => n + (t.grades?.silver ?? 0), 0),
          gold: graded.reduce((n, t) => n + (t.grades?.gold ?? 0), 0),
          platinum: graded.reduce((n, t) => n + (t.grades?.platinum ?? 0), 0),
        }
      : undefined,
  };
}

/**
 * Each game's trophy lists, found by the PlayStation title id of each version
 * played (a version can have several lists, like the three games of the Crash
 * N. Sane Trilogy), or by name when that finds nothing. When the PS4 and PS5
 * versions each have a list, the counts come from the one with more trophies
 * earned; the game page can show the other.
 */
function matchTrophies(
  entries: PlayEntry[],
  titles: PsnTrophyTitle[],
  lists: Record<string, string[]>,
  titleOf: (gameId: string) => string | undefined,
): Record<string, Result> {
  const byId = new Map(titles.map((t) => [t.id, t]));
  const byName = new Map<string, PsnTrophyTitle>();
  for (const t of titles) {
    const key = normalizeTitle(t.name);
    const had = byName.get(key);
    if (!had || t.earned > had.earned) byName.set(key, t);
  }
  const byGame = new Map<string, PlayEntry[]>();
  for (const e of entries) byGame.set(e.gameId, [...(byGame.get(e.gameId) ?? []), e]);

  const out: Record<string, Result> = {};
  for (const [gameId, es] of byGame) {
    const sets: ReturnType<typeof combine>[] = [];
    for (const ref of es.flatMap((e) => e.refs ?? [e.ref])) {
      const found = (ref ? (lists[ref] ?? []) : []).map((id) => byId.get(id)).filter((t) => !!t);
      if (found.length && !sets.some((s) => s.ids.join() === found.map((t) => t.id).join())) sets.push(combine(found));
    }
    if (!sets.length) {
      const title = titleOf(gameId);
      const t = title && byName.get(normalizeTitle(title));
      if (t) sets.push(combine([t]));
    }
    if (!sets.length) continue;
    sets.sort((a, b) => b.earned - a.earned);
    const best = sets[0];
    out[gameId] = {
      earned: best.earned,
      total: best.total,
      platinum: best.platinum,
      grades: best.grades,
      minutesAt: es.reduce((n, e) => n + e.minutes, 0),
      psnLists: sets.map(({ label, ids, earned, total }) => ({ label, ids, earned, total })),
    };
  }
  return out;
}

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
      const psnEntries = useStore.getState().entries.filter((x) => x.platform === 'playstation' && x.source === 'psn');
      const titleIds = [...new Set(psnEntries.flatMap((e) => e.refs ?? [e.ref]).filter((r) => !!r))] as string[];
      const { titles, lists = {} } = await fetchPsnTrophies(titleIds.slice(0, 600));
      const { customGames, genreOverrides, details } = useStore.getState();
      const out = matchTrophies(
        psnEntries,
        titles,
        lists,
        (id) => resolveGame(id, customGames, genreOverrides, details)?.title,
      );
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
