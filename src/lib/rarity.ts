import { useEffect, useMemo } from 'react';
import type { PlatformId, RareUnlock, RarityInfo } from '../types';
import { achievementSources } from './achievementSources';
import { fetchAchievementList, fetchStatus, type AchievementItem } from './api';
import { isApp } from './apps';
import { resolveGame, useStore } from './store';

// Achievement rarity: the share of a game's players who have an achievement,
// as each platform reports it (Steam, PlayStation, Xbox, Epic and GOG among
// their players; RetroAchievements among players of that set). Each game's
// earned achievements are summed up by band and saved with its counts, so XP
// (lib/xp.ts) can add a bonus for rare ones and profiles can show the rarest.

export type RarityBand = 'ultra' | 'very' | 'rare' | 'uncommon' | 'common';

/** Bands as PSNProfiles uses them: each holds achievements under its % of players. */
export const BANDS: { band: RarityBand; label: string; below: number; color: string }[] = [
  { band: 'ultra', label: 'Ultra rare', below: 5, color: 'yellow' },
  { band: 'very', label: 'Very rare', below: 10, color: 'grape' },
  { band: 'rare', label: 'Rare', below: 20, color: 'blue' },
  { band: 'uncommon', label: 'Uncommon', below: 50, color: 'teal' },
  { band: 'common', label: 'Common', below: Infinity, color: 'gray' },
];

export const bandOf = (pct: number | null | undefined) =>
  pct == null || !Number.isFinite(pct) ? undefined : BANDS.find((b) => pct < b.below);

/** Extra XP for each earned achievement in the rare bands. */
export const RARITY_XP: Record<'ultra' | 'very' | 'rare', number> = { ultra: 50, very: 25, rare: 10 };

/** "2.1%", "0.3%", "<0.1%" */
export const pctLabel = (pct: number) => (pct > 0 && pct < 0.1 ? '<0.1%' : `${Math.round(pct * 10) / 10}%`);

/** Sums up how rare a game's earned achievements are. */
export function summarize(items: AchievementItem[], earned: number): RarityInfo {
  // A game nobody has data for yet reports 0% for everything: that's unknown, not ultra rare.
  const known = items.some((a) => a.rarity != null && a.rarity > 0);
  const mine = known ? items.filter((a) => a.earnedAt !== null && a.rarity != null) : [];
  const count = (band: RarityBand) => mine.filter((a) => bandOf(a.rarity)?.band === band).length;
  const rarest: RareUnlock[] = [...mine]
    .sort((a, b) => a.rarity! - b.rarity!)
    .slice(0, 3)
    .map((a) => ({ name: a.name, icon: a.icon, rarity: a.rarity!, ...(a.earnedAt && { earnedAt: a.earnedAt }) }));
  return {
    earned,
    ultra: count('ultra'),
    very: count('very'),
    rare: count('rare'),
    rarest,
    checkedAt: new Date().toISOString(),
  };
}

// Checked again after a month even without new unlocks, as rarity drifts.
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
// Lists read per run and platform. OpenXBL's free key allows 150 calls an
// hour for everything Xbox, so Xbox goes slowly and at most once an hour.
const PER_RUN: Partial<Record<PlatformId, number>> = { steam: 40, playstation: 20, xbox: 8 };
const PER_RUN_OTHER = 15;
const XBOX_GAP = 60 * 60 * 1000;
const XBOX_KEY = 'savepoint-rarity-xbox';

const lastXbox = () => {
  try {
    return Number(localStorage.getItem(XBOX_KEY)) || 0;
  } catch {
    return 0;
  }
};
const markXbox = () => {
  try {
    localStorage.setItem(XBOX_KEY, String(Date.now()));
  } catch {
    // Then Xbox may be asked again sooner; its cap per run still holds.
  }
};

interface Todo {
  gameId: string;
  platform: PlatformId;
  url: string;
  earned: number;
}

/** Games and platforms whose rarity is missing, out of date, or from before new unlocks. */
function findTodo(): Todo[] {
  const { entries, achievements, customGames, genreOverrides, details } = useStore.getState();
  const out: Todo[] = [];
  const now = Date.now();
  for (const gameId of new Set(entries.map((e) => e.gameId))) {
    const per = achievements[gameId];
    if (!per) continue;
    const game = resolveGame(gameId, customGames, genreOverrides, details);
    if (!game || isApp(game)) continue;
    for (const s of achievementSources(game, entries, per)) {
      const a = per[s.platform];
      if (!a?.earned) continue;
      const r = a.rarity;
      if (r && r.earned === a.earned && now - Date.parse(r.checkedAt) < MAX_AGE) continue;
      out.push({ gameId, platform: s.platform, url: s.url, earned: a.earned });
    }
  }
  // Games with the most unlocks first: they change XP the most.
  return out.sort((a, b) => b.earned - a.earned);
}

let running = false;
let again: ReturnType<typeof setTimeout> | undefined;

/**
 * Reads the achievement lists of games whose rarity is missing or out of date,
 * a few per platform at a time, and saves the summary. Runs in the background
 * and fails quietly; what's left is picked up on the next run.
 */
export async function runRaritySync(): Promise<void> {
  if (running) return;
  const todo = findTodo();
  if (!todo.length) return;
  running = true;
  clearTimeout(again);
  try {
    const status = await fetchStatus();
    if (!status.online) return;
    const xboxOk = Date.now() - lastXbox() > XBOX_GAP;
    const taken: Partial<Record<PlatformId, number>> = {};
    const batch = todo.filter((t) => {
      if (t.platform === 'xbox' && !xboxOk) return false;
      const n = taken[t.platform] ?? 0;
      if (n >= (PER_RUN[t.platform] ?? PER_RUN_OTHER)) return false;
      taken[t.platform] = n + 1;
      return true;
    });
    if (batch.some((t) => t.platform === 'xbox')) markXbox();
    let xboxFailed = false;
    let failed = 0;

    // Three at a time; saved every few games so XP moves as it goes.
    let done: { gameId: string; platform: PlatformId; info: RarityInfo }[] = [];
    const queue = [...batch];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        if (t.platform === 'xbox' && xboxFailed) continue;
        try {
          const items = await fetchAchievementList(t.url);
          done.push({ gameId: t.gameId, platform: t.platform, info: summarize(items, t.earned) });
        } catch {
          failed++;
          if (t.platform === 'xbox') xboxFailed = true; // Most likely the hourly limit.
        }
        if (done.length >= 10) {
          useStore.getState().applyRarity(done);
          done = [];
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (done.length) useStore.getState().applyRarity(done);

    // More to do (and not just failures): go on in a minute and a half.
    if (todo.length > batch.length && failed < batch.length) {
      again = setTimeout(() => void runRaritySync(), 90_000);
    }
  } catch {
    // Nice-to-have: tried again on the next change or app open.
  } finally {
    running = false;
  }
}

/** Keeps rarity up to date a few seconds after achievement counts change. */
export function useRaritySync() {
  const achievements = useStore((s) => s.achievements);
  useEffect(() => {
    const timer = setTimeout(() => void runRaritySync(), 5000);
    return () => clearTimeout(timer);
  }, [achievements]);
}

export interface RarestUnlock extends RareUnlock {
  gameId: string;
  title: string;
  imageUrl?: string;
  steamAppId?: number;
  platform: PlatformId;
}

/** Your rarest earned achievements across every game and platform, rarest first. */
export function useRarestUnlocks(limit = 5): RarestUnlock[] {
  const achievements = useStore((s) => s.achievements);
  const customGames = useStore((s) => s.customGames);
  const overrides = useStore((s) => s.genreOverrides);
  const details = useStore((s) => s.details);
  return useMemo(() => {
    const all: RarestUnlock[] = [];
    for (const [gameId, per] of Object.entries(achievements)) {
      const game = resolveGame(gameId, customGames, overrides, details);
      if (!game || isApp(game)) continue;
      for (const [platform, a] of Object.entries(per) as [PlatformId, (typeof per)[PlatformId]][]) {
        for (const r of a?.rarity?.rarest ?? []) {
          all.push({
            ...r,
            gameId,
            title: game.title,
            imageUrl: game.imageUrl,
            steamAppId: game.steamAppId,
            platform,
          });
        }
      }
    }
    return all
      .sort((a, b) => a.rarity - b.rarity || (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''))
      .slice(0, limit);
  }, [achievements, customGames, overrides, details, limit]);
}
