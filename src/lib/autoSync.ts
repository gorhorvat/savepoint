import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import { fetchStatus, fetchSteamWishlist, importPsn, importSteam } from './api';
import { useStore } from './store';

const MAX_AGE = 6 * 60 * 60 * 1000;
const stale = (iso?: string) => !iso || Date.now() - Date.parse(iso) > MAX_AGE;

let started = false;

/**
 * When the app opens, re-syncs every connected source whose last sync is
 * more than 6 hours old: Steam library, PlayStation library, Steam wishlist.
 * Runs once per page load, silently; the manual sync buttons still work.
 */
export async function autoSync(): Promise<void> {
  if (started) return;
  started = true;
  const { connections } = useStore.getState();
  const steamProfile = connections.steam?.account;
  const jobs: { name: string; run: () => Promise<void> }[] = [];
  const status = await fetchStatus();
  if (!status.online) return;

  if (status.steam && steamProfile && connections.steam?.lastSync && stale(connections.steam.lastSync)) {
    jobs.push({
      name: 'Steam library',
      run: async () => {
        const res = await importSteam(steamProfile);
        useStore.getState().importLibrary('steam', 'steam', res.games, steamProfile);
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
  if (status.steam && steamProfile && connections.steam?.wishlistSync && stale(connections.steam.wishlistSync)) {
    jobs.push({
      name: 'Steam wishlist',
      run: async () => {
        const res = await fetchSteamWishlist(steamProfile);
        // An empty answer usually means the wishlist went private; don't wipe ours.
        if (res.games.length) useStore.getState().syncSteamWishlist(res.games, steamProfile);
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
