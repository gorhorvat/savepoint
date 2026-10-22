import { useEffect } from 'react';
import { syncAlerts, type AlertItem } from './api';
import { resolveGame, useStore } from './store';

let lastSent = '';

/**
 * Keeps the server's list of price alerts in step with the wishlist targets.
 * The server checks them every six hours and sends a push notification
 * through ntfy when a game hits its target.
 */
export function usePriceAlertsSync() {
  const wishlist = useStore((s) => s.wishlist);
  useEffect(() => {
    const timer = setTimeout(() => {
      const { customGames, genreOverrides, details } = useStore.getState();
      const items: AlertItem[] = [];
      for (const w of wishlist) {
        if (w.targetPrice == null) continue;
        const g = resolveGame(w.gameId, customGames, genreOverrides, details);
        if (!g) continue;
        items.push({
          id: g.id,
          title: g.title,
          steamAppId: g.steamAppId,
          nsuid: g.nsuid,
          pc: g.availableOn.includes('steam') || g.availableOn.includes('epic'),
          switch: g.availableOn.includes('switch'),
          target: w.targetPrice,
        });
      }
      const key = JSON.stringify(items);
      if (key === lastSent) return;
      syncAlerts(items)
        .then(() => {
          lastSent = key;
        })
        .catch(() => {});
    }, 1500); // Wait for typing in the target field to settle.
    return () => clearTimeout(timer);
  }, [wishlist]);
}
