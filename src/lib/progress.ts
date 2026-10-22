import type { PlayStatus, Progress } from '../types';
import type { LibraryGame } from './library';

export const STATUSES: { value: PlayStatus; label: string; color: string }[] = [
  { value: 'playing', label: 'Playing', color: 'blue' },
  { value: 'backlog', label: 'Backlog', color: 'gray' },
  { value: 'finished', label: 'Finished', color: 'teal' },
  { value: 'completed', label: '100%', color: 'yellow' },
  { value: 'dropped', label: 'Dropped', color: 'red' },
];
export const STATUS_BY_VALUE = Object.fromEntries(STATUSES.map((s) => [s.value, s])) as Record<
  PlayStatus,
  (typeof STATUSES)[number]
>;

const RECENT = 21 * 24 * 60 * 60 * 1000;
/** Under this many minutes a game counts as not really started. */
export const BACKLOG_MINUTES = 120;

/**
 * The status you set, or a guess when you haven't: played in the last three
 * weeks is Playing, under two hours is Backlog. `guessed` says which.
 */
export function effectiveStatus(
  item: LibraryGame,
  progress?: Progress,
  now = Date.now(),
): { status?: PlayStatus; guessed: boolean } {
  if (progress?.status) return { status: progress.status, guessed: false };
  if (item.isApp) return { guessed: true };
  if (item.lastPlayed && now - Date.parse(item.lastPlayed) < RECENT && item.totalMinutes > 0) {
    return { status: 'playing', guessed: true };
  }
  if (item.totalMinutes < BACKLOG_MINUTES) return { status: 'backlog', guessed: true };
  return { guessed: true };
}

/**
 * How much a game counts towards your taste: ratings scale it, and a game you
 * dropped counts for less than one you stuck with.
 */
export function tasteFactor(progress?: Progress): number {
  if (progress?.rating) return [0.15, 0.45, 1, 1.35, 1.7][progress.rating - 1];
  if (progress?.status === 'dropped') return 0.4;
  return 1;
}
