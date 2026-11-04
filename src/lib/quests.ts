// Quests: daily, weekly and monthly goals that earn XP (server/quests.mjs).
//
// The app sends the server a small snapshot of its confirmed totals (minutes
// and achievements per game and platform, Backlog games, HowLongToBeat
// lengths) whenever they change; the server measures progress against the
// totals each period started from and adds XP for finished quests. Checks run
// in the background and fail quietly; "Check progress" syncs first.
import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import { create } from 'zustand';
import type { PlatformId } from '../types';
import { isApp } from './apps';
import { syncNow } from './autoSync';
import { runAchievementsSync } from './achievements';
import { resolveGame, useStore } from './store';
import { CONFIRMED_SOURCES } from './xp';

export type QuestPeriod = 'day' | 'week' | 'month';

export interface Quest {
  period: QuestPeriod;
  slot: number;
  key: string;
  title: string;
  tier: 'easy' | 'medium' | 'hard' | 'shared';
  xp: number;
  /** minutes, count, or percent (of a goal that differs per game). */
  unit: 'minutes' | 'count' | 'percent';
  target: number;
  progress: number;
  done: boolean;
  canReroll: boolean;
  /** Everyone's progress on the shared monthly quest, and how many have helped. */
  shared?: { total: number; people: number };
  /** For quests that only count some games: which ones. */
  games?: string[];
}

export interface QuestData {
  periods: Record<QuestPeriod, { key: string; endsAt: string }>;
  quests: Quest[];
  xp: number;
  done: number;
  streak: number;
  /** No confirmed games yet, so no quests. */
  empty?: boolean;
  /** Quests this check found done. */
  finished?: { title: string; xp: number }[];
  rerollUsed?: boolean;
}

interface Snapshot {
  platforms: string[];
  games: Record<
    string,
    { l?: string; b?: 1; h?: number; p: Partial<Record<PlatformId, { m: number; e?: number; t?: number; d?: 1 }>> }
  >;
}

/** Confirmed totals per game and platform, as the server expects them. */
export function questSnapshot(): Snapshot {
  const { entries, achievements, progress, lengths, connections, customGames, genreOverrides, details } =
    useStore.getState();
  const games: Snapshot['games'] = {};
  const counted = (id: string) => {
    const g = resolveGame(id, customGames, genreOverrides, details);
    return !!g && !isApp(g);
  };
  for (const e of entries) {
    if (!CONFIRMED_SOURCES.has(e.source) || !counted(e.gameId)) continue;
    const g = (games[e.gameId] ??= { p: {} });
    const p = (g.p[e.platform] ??= { m: 0 });
    p.m += e.minutes;
    if (e.lastPlayed && e.lastPlayed > (g.l ?? '')) g.l = e.lastPlayed;
  }
  for (const [id, per] of Object.entries(achievements)) {
    const g = games[id];
    if (!g) continue;
    for (const [platform, a] of Object.entries(per) as [PlatformId, (typeof per)[PlatformId]][]) {
      if (!a?.total) continue;
      const p = (g.p[platform] ??= { m: 0 });
      p.e = a.earned;
      p.t = a.total;
      if (a.earned >= a.total || a.platinum) p.d = 1;
    }
  }
  for (const [id, g] of Object.entries(games)) {
    if (progress[id]?.status === 'backlog') g.b = 1;
    const main = lengths[id]?.main;
    if (main) g.h = main;
  }
  const platforms = Object.entries(connections)
    .filter(([, c]) => c?.lastSync)
    .map(([p]) => p);
  return { platforms, games };
}

// ---------------------------------------------------------------- state

interface QuestState {
  data: QuestData | null;
  checking: boolean;
}

export const useQuests = create<QuestState>()(() => ({ data: null, checking: false }));

function received(data: QuestData) {
  useQuests.setState({ data });
  useStore.getState().setQuestXp(data.xp, data.done);
  for (const f of data.finished ?? []) {
    notifications.show({ color: 'green', title: 'Quest done', message: `${f.title} · +${f.xp} XP`, autoClose: 6000 });
  }
}

async function post(url: string, body: object): Promise<QuestData> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the Savepoint server.");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Failed (${r.status}).`);
  return data as QuestData;
}

let inFlight: Promise<void> | null = null;

/** Loads the quests as last checked (quick: nothing is sent). Quietly. */
export async function loadQuests(): Promise<void> {
  try {
    const r = await fetch('/api/quests');
    if (!r.ok) return;
    const data = (await r.json()) as QuestData;
    // A check that finished meanwhile is newer.
    if (!useQuests.getState().data) received({ ...data, finished: [] });
  } catch {
    // The background check fills it in.
  }
}

/** Sends the current totals and saves the answer. Throws on failure. */
export function checkQuests(): Promise<void> {
  inFlight ??= post('/api/quests/check', { snapshot: questSnapshot() })
    .then(received)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** "Check progress": syncs what's due, then checks. Resolves to a problem to show, if any. */
export async function checkProgressNow(): Promise<string | null> {
  useQuests.setState({ checking: true });
  try {
    const failed = await syncNow();
    await runAchievementsSync({ forcePsn: true });
    await inFlight;
    await checkQuests();
    return failed.length ? `Progress checked, but ${failed.join(', ')} couldn't sync. Try again in a moment.` : null;
  } catch (err) {
    return (err as Error).message;
  } finally {
    useQuests.setState({ checking: false });
  }
}

/** Swaps one of today's quests for another. Resolves to a problem to show, if any. */
export async function rerollQuest(slot: number): Promise<string | null> {
  try {
    received(await post('/api/quests/reroll', { slot }));
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Checks quests when the app opens and a few seconds after totals change
 * (a sync, new achievements, a game moved to Backlog). Quietly.
 */
export function useQuestCheck() {
  const entries = useStore((s) => s.entries);
  const achievements = useStore((s) => s.achievements);
  const progress = useStore((s) => s.progress);
  useEffect(() => {
    if (!entries.length) return;
    const t = setTimeout(() => {
      checkQuests().catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, [entries, achievements, progress]);
}

// ---------------------------------------------------------------- display

const PERIOD_WORD: Record<QuestPeriod, string> = { day: "today's", week: "this week's", month: "this month's" };

/** The unfinished quests a game counts for (quests that only count some games). */
export function useQuestsFor(gameId: string): Quest[] {
  const data = useQuests((s) => s.data);
  return (data?.quests ?? []).filter((q) => !q.done && q.games?.includes(gameId));
}

export const questFor = (q: Quest) => `Counts for ${PERIOD_WORD[q.period]} quest`;

/** Quests counted in minutes show hours once the goal is 2 hours or more. */
const inHours = (q: Quest) => q.unit === 'minutes' && q.target >= 120;

/** One amount of a quest's unit: "12 min", "1.5 h", "40%", "3". */
export function amount(q: Quest, value: number): string {
  if (q.unit === 'percent') return `${Math.min(100, value)}%`;
  if (inHours(q)) return `${(value / 60).toFixed(value >= 600 || value === 0 ? 0 : 1)} h`;
  if (q.unit === 'minutes') return `${value} min`;
  return value.toLocaleString();
}

/** "12 of 30 min", "1.5 of 6 h", "2 of 3", "40%". */
export function progressLabel(q: Quest, value = q.progress): string {
  if (q.unit === 'percent') return amount(q, value);
  const unit = amount(q, q.target);
  const number = (v: string) => v.replace(/ (h|min)$/, '');
  return q.unit === 'count' ? `${amount(q, value)} of ${unit}` : `${number(amount(q, value))} of ${unit}`;
}

/** "Resets in 5 h", "Resets in 3 days". */
export function resetsIn(endsAt: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((Date.parse(endsAt) - now) / 60000));
  if (minutes < 60) return `Resets in ${minutes} min`;
  if (minutes < 48 * 60) return `Resets in ${Math.round(minutes / 60)} h`;
  return `Resets in ${Math.round(minutes / 1440)} days`;
}
