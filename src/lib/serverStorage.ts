import type { PersistStorage, StorageValue } from 'zustand/middleware';

// Zustand storage that keeps the app's state on the Savepoint server (in its
// database) instead of in the browser, so every device shares it.
//
// Saves are debounced and carry the revision they're based on. If another
// device saved in the meantime the server refuses (409) and this copy reloads
// the newer data instead of overwriting it.

export type SyncStatus = 'loading' | 'ready' | 'offline' | 'login';

let rev = 0;
let loaded = false; // No saves until the server's copy has been applied.
/** The account whose library this tab has loaded. */
let loadedUser: number | null = null;
let needsLogin = false;
let loadError: string | null = null;

/** Why the first load failed, as the server explained it (if it did). */
export function getLoadError() {
  return loadError;
}
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: StorageValue<unknown> | null = null;
let inFlight: Promise<void> | null = null;
let onConflict: () => void = () => {};
let onSaveFailed: () => void = () => {};

export function setSyncHandlers(handlers: { conflict: () => void; saveFailed: () => void }) {
  onConflict = handlers.conflict;
  onSaveFailed = handlers.saveFailed;
}

let status: SyncStatus = 'loading';
const listeners = new Set<() => void>();

export function getSyncStatus() {
  return status;
}

export function subscribeSyncStatus(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setStatus(next: SyncStatus) {
  status = next;
  listeners.forEach((cb) => cb());
}

/** Retrying the first load: back to the loading screen. */
export function markLoading() {
  if (!loaded) setStatus('loading');
}

/**
 * Called when the store has (or hasn't) loaded the server's copy. Saves are
 * allowed only after a successful load, so a server that's down can never be
 * overwritten with the empty defaults.
 */
export function hydrationDone(error: unknown) {
  if (error && needsLogin) {
    setStatus('login');
    return;
  }
  if (error) {
    if (!loaded) setStatus('offline'); // A failed refresh later on keeps the data on screen.
    return;
  }
  loaded = true;
  setStatus('ready');
  // Older versions kept everything in the browser; the server copy replaces it.
  try {
    localStorage.removeItem('savepoint');
  } catch {
    // Storage unavailable: nothing to clean up.
  }
}

export function hasPendingSave() {
  return pending !== null || inFlight !== null;
}

/** The library compresses to about a quarter of its size. */
function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

// Background jobs (covers, achievements, play times) change the library in
// bursts after a sync; waiting a few seconds turns each burst into one save.
const SAVE_DELAY_MS = 3000;

async function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (inFlight) await inFlight; // One save at a time, so revisions stay in order.
  const value = pending;
  if (!value) return;
  pending = null;
  inFlight = (async () => {
    try {
      const body = await gzip(JSON.stringify({ baseRev: rev, version: value.version, state: value.state }));
      const r = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
        body,
        // Lets the save finish while the tab closes; browsers allow it for small bodies only.
        keepalive: body.size < 60_000,
      });
      if (r.status === 401) {
        pending ??= value; // Saved once you've logged in again.
        loginExpired();
        return;
      }
      if (r.status === 409) {
        pending = null;
        onConflict();
        return;
      }
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
      rev = (await r.json()).rev;
    } catch {
      // Keep the newest unsaved copy and try again shortly.
      pending ??= value;
      onSaveFailed();
      timer = setTimeout(() => void flush(), 10_000);
    }
  })();
  await inFlight;
  inFlight = null;
}

function loginExpired() {
  needsLogin = true;
  setStatus('login');
}

/** After logging in: save anything left unsaved, then the caller reloads the data. */
export async function resumeAfterLogin() {
  needsLogin = false;
  setStatus('loading');
  await flush();
}

async function authenticate(route: string, body: object): Promise<string | null> {
  try {
    const r = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const { id } = (await r.json()) as { id: number };
      // Someone else on a tab that still holds another account's library:
      // start fresh, so none of it (or its unsaved changes) reaches the new account.
      if (loadedUser !== null && loadedUser !== id) {
        pending = null;
        location.reload();
        await new Promise(() => {}); // Wait for the reload.
      }
      return null;
    }
    return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Failed (${r.status}).`;
  } catch {
    return "Can't reach the Savepoint server.";
  }
}

export function logIn(username: string, password: string): Promise<string | null> {
  return authenticate('/api/login', { username, password });
}

export function signUp(username: string, password: string, code: string): Promise<string | null> {
  return authenticate('/api/signup', { username, password, code });
}

/**
 * After "Sign in through Steam" with a Steam account that isn't linked yet: a
 * suggested username and whether new accounts can be made, or null if that expired.
 */
export async function steamPending(): Promise<{ username: string; signupOpen: boolean } | null> {
  try {
    const r = await fetch('/api/auth/steam/pending');
    return r.ok ? ((await r.json()) as { username: string; signupOpen: boolean }) : null;
  } catch {
    return null;
  }
}

/** Links the Steam account that just signed in to an existing account, and logs in to it. */
export function linkSteamToAccount(username: string, password: string): Promise<string | null> {
  return authenticate('/api/auth/steam/link', { username, password });
}

/** Creates the account for the Steam account that just signed in. */
export function completeSteamSignup(username: string, code: string): Promise<string | null> {
  return authenticate('/api/auth/steam/complete', { username, code });
}

/** True when the server takes new accounts (an invite code is set). */
export async function signupOpen(): Promise<boolean> {
  try {
    const r = await fetch('/api/signup');
    return r.ok && ((await r.json()) as { open: boolean }).open;
  } catch {
    return false;
  }
}

export async function logOut() {
  await flush().catch(() => {});
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload(); // Drops the library from memory; the reload shows the login screen.
}

/** Save now, e.g. when the tab is being hidden. */
export function flushNow() {
  return flush();
}

/** True when another device has saved since this copy was loaded. */
export async function serverHasNewer(): Promise<boolean> {
  const r = await fetch('/api/state/rev', { cache: 'no-store' });
  if (r.status === 401) loginExpired();
  if (!r.ok) return false;
  return (await r.json()).rev !== rev;
}

export function serverStorage<S>(): PersistStorage<S> {
  return {
    async getItem() {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (r.status === 401) {
        needsLogin = true;
        throw new Error('Not logged in');
      }
      if (r.status === 404) {
        const empty = await r.json();
        rev = empty.rev ?? 0;
        loadedUser = empty.user ?? null;
        return null; // Nothing saved yet: start from the defaults.
      }
      if (!r.ok) {
        loadError = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? null;
        throw new Error(`Loading failed (${r.status})`);
      }
      loadError = null;
      const data = await r.json();
      rev = data.rev;
      loadedUser = data.user ?? null;
      return { state: data.state as S, version: data.version };
    },
    setItem(_name, value) {
      if (!loaded) return;
      pending = value as StorageValue<unknown>;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    removeItem() {},
  };
}
