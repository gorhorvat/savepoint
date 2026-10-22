import { useEffect } from 'react';
import { useStore } from './store';

/**
 * Records play time history whenever play time changes (a sync, an import or
 * hours added by hand). Savepoint only gets lifetime totals from platforms, so
 * the hours between two recordings are dated by the last session, or today.
 */
export function usePlayHistory() {
  const entries = useStore((s) => s.entries);
  useEffect(() => {
    useStore.getState().recordHistory();
  }, [entries]);
}
