import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import { applyXboxAchievements } from './achievements';
import { fetchAccount, fetchStatus, fetchSteamWishlist, importPsn, importSteam, importXbox, steamProfileUrl } from './api';
import { useStore } from './store';

const MAX_AGE = 6 * 60 * 60 * 1000;
const stale = (iso?: string) => !iso || Date.now() - Date.parse(iso) > MAX_AGE;

let started = false;
let firstSteamImport: Promise<number> | null = null;

/**
 * The first import of a linked Steam account (made through "Create account with
 * Steam", or linked to an existing account), once per account: it is remembered,
 * so removing the imported games later isn't undone. A failure (Game details
 * still private, Steam down) is retried the next time the app opens.
 * Resolves to the number of games imported. Shared, so it never runs twice at once.
 */
export function importLinkedSteamOnce(): Promise<number> {
  firstSteamImport ??= (async () => {
    const res = await importSteam();
    const r = useStore.getState().importLibrary('steam', 'steam', res.games, steamProfileUrl(res.steamId));
    useStore.setState({ steamAutoImported: new Date().toISOString() });
    return r.added;
  })().catch((err) => {
    // Failed: the next attempt starts over. (A success stays, so a second caller gets its result.)
    firstSteamImport = null;
    throw err;
  });
  return firstSteamImport;
}

/** True when Steam is linked to this account but its library was never imported. */
async function steamNeverImported(): Promise<boolean> {
  const { connections, steamAutoImported } = useStore.getState();
  if (connections.steam || steamAutoImported) return false;
  return !!(await fetchAccount().catch(() => null))?.steamId;
}

/**
 * When the app opens, re-syncs every connected source whose last sync is
 * more than 6 hours old: Steam, PlayStation and Xbox libraries, Steam wishlist.
 * Runs once per page load, silently; the manual sync buttons still work.
 */
export async function autoSync(): Promise<void> {
  if (started) return;
  started = true;
  const { connections } = useStore.getState();
  const jobs: { name: string; run: () => Promise<void> }[] = [];
  const status = await fetchStatus();
  if (!status.online) return;

  if (status.steam && (await steamNeverImported())) {
    jobs.push({
      name: 'Steam library',
      run: async () => {
        await importLinkedSteamOnce();
      },
    });
  } else if (status.steam && connections.steam?.lastSync && stale(connections.steam.lastSync)) {
    jobs.push({
      name: 'Steam library',
      run: async () => {
        const res = await importSteam();
        useStore.getState().importLibrary('steam', 'steam', res.games, steamProfileUrl(res.steamId));
      },
    });
  }
  if (status.psn && connections.playstation?.lastSync && stale(connections.playstation.lastSync)) {
    jobs.push({
      name: 'PlayStation library',
      run: async () => {
        const res = await importPsn();
        useStore.getState().importLibrary('playstation', 'psn', res.games);
      },
    });
  }
  if (status.xbox && connections.xbox?.lastSync && stale(connections.xbox.lastSync)) {
    jobs.push({
      name: 'Xbox library',
      run: async () => {
        const res = await importXbox();
        useStore.getState().importLibrary('xbox', 'xbox', res.games);
        applyXboxAchievements(res.games);
      },
    });
  }
  if (status.steam && connections.steam?.wishlistSync && stale(connections.steam.wishlistSync)) {
    jobs.push({
      name: 'Steam wishlist',
      run: async () => {
        const res = await fetchSteamWishlist();
        // An empty answer usually means the wishlist went private; don't wipe ours.
        if (res.games.length) useStore.getState().syncSteamWishlist(res.games, steamProfileUrl(res.steamId));
      },
    });
  }
  if (!jobs.length) return;

  const results = await Promise.allSettled(jobs.map((j) => j.run()));
  // Only successes are announced: a failed source keeps its saved data and is
  // retried quietly next time. The manual sync buttons still report failures.
  const done = jobs.filter((_, i) => results[i].status === 'fulfilled').map((j) => j.name);
  if (done.length) notifications.show({ message: `Synced ${done.join(', ')}.`, autoClose: 3000 });
}

export function useAutoSync() {
  useEffect(() => {
    void autoSync();
  }, []);
}
