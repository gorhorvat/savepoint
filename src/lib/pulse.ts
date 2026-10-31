// One clock for everything that polls while the app is open: the header
// badges (/api/me/pulse), the chat you're reading, the conversation and
// friends lists. The clock slows down when you stop using the app and stops
// after a while, so a tab left open doesn't keep the server and the database
// busy (both are on free plans that count time awake):
//
//   active   (input in the last 3 min)   every subscriber at its own pace
//   idle     (3 to 15 min without input)  three times slower, and requests
//                                        say so (X-Savepoint-Idle), so friends
//                                        stop seeing you as online
//   away     (15 min)                     nothing at all, until "Still here?"
//                                        is answered (src/components/StillHere)
//   hidden tab                            nothing, except the badge check every
//                                        2 minutes when browser notifications
//                                        for messages are on
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { messageAlerts, type UnreadLatest } from './messages';
import { useStore } from './store';

export interface Pulse {
  unread: number;
  latest: UnreadLatest | null;
  requests: number;
  gifts: number;
  online: number;
  at: string;
}

const IDLE_AFTER = 3 * 60_000;
const AWAY_AFTER = 15 * 60_000;
const IDLE_FACTOR = 3;
const HIDDEN_BADGES_EVERY = 120_000;
const CLOCK = 5_000;

interface Sub {
  fn: () => void;
  every: number;
  /** How often to run while the tab is hidden; not at all when missing. */
  whenHidden?: () => number | null;
  last: number;
}

const subs = new Set<Sub>();
let lastActive = Date.now();
let away = false;
let clock: ReturnType<typeof setInterval> | null = null;
const awayListeners = new Set<() => void>();

export const isIdle = () => Date.now() - lastActive > IDLE_AFTER;
export const isAway = () => away;

function setAway(next: boolean) {
  if (away === next) return;
  away = next;
  for (const l of awayListeners) l();
}

/** Runs every subscriber whose time has come. */
function tick(force = false) {
  const now = Date.now();
  const visible = document.visibilityState === 'visible';
  if (visible && !away && now - lastActive > AWAY_AFTER) setAway(true);
  for (const s of subs) {
    let every: number | null;
    if (!visible) every = s.whenHidden?.() ?? null;
    else if (away) every = null;
    else every = isIdle() ? s.every * IDLE_FACTOR : s.every;
    if (every == null) continue;
    if (force || now - s.last >= every - CLOCK / 2) {
      s.last = now;
      try {
        s.fn();
      } catch {
        // A subscriber's own problem.
      }
    }
  }
}

function touch() {
  lastActive = Date.now();
  if (away) {
    setAway(false);
    tick(true);
  }
}

function start() {
  if (clock) return;
  clock = setInterval(() => tick(), CLOCK);
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') touch();
    tick(true);
  });
}

/**
 * Runs `fn` now and then every `every` ms while the app is in use (see the
 * top of this file). Returns the unsubscribe.
 */
export function subscribe(fn: () => void, every: number, whenHidden?: () => number | null): () => void {
  start();
  const s: Sub = { fn, every, whenHidden, last: 0 };
  subs.add(s);
  if (document.visibilityState === 'visible' && !away) {
    s.last = Date.now();
    fn();
  }
  return () => {
    subs.delete(s);
  };
}

/** Hook form of subscribe: `fn` may change; the pace doesn't. */
export function useTick(fn: () => void, every: number, enabled = true) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => (enabled ? subscribe(() => ref.current(), every) : undefined), [every, enabled]);
}

/** Answer "Still here?": the app is in use again. */
export const stillHere = () => touch();

/** Whether the app has stopped polling because nobody touched it for a while. */
export function useAway(): boolean {
  return useSyncExternalStore(
    (cb) => {
      awayListeners.add(cb);
      return () => awayListeners.delete(cb);
    },
    () => away,
  );
}

// ---------------------------------------------------------------- the pulse

let pulse: Pulse | null = null;
const pulseListeners = new Set<() => void>();
let fetching: Promise<void> | null = null;

export async function fetchPulse(): Promise<Pulse> {
  const r = await fetch('/api/me/pulse', { headers: isIdle() ? { 'X-Savepoint-Idle': '1' } : undefined });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
  return body as Pulse;
}

function refreshPulse() {
  fetching ??= fetchPulse()
    .then((p) => {
      pulse = p;
      for (const l of pulseListeners) l();
    })
    .catch(() => {})
    .finally(() => {
      fetching = null;
    });
}

/** Asks for the pulse right away (after sending a message, accepting a request...). */
export const nudgePulse = () => refreshPulse();

let pulseSub: (() => void) | null = null;
let pulseUsers = 0;

/** The latest pulse, kept fresh while any component uses it. */
export function usePulse(): Pulse | null {
  useEffect(() => {
    pulseUsers += 1;
    pulseSub ??= subscribe(refreshPulse, 20_000, () =>
      messageAlerts(useStore.getState().messageAlerts).browser ? HIDDEN_BADGES_EVERY : null,
    );
    return () => {
      pulseUsers -= 1;
      if (!pulseUsers) {
        pulseSub?.();
        pulseSub = null;
      }
    };
  }, []);
  return useSyncExternalStore(
    (cb) => {
      pulseListeners.add(cb);
      return () => pulseListeners.delete(cb);
    },
    () => pulse,
  );
}
