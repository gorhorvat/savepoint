import { useEffect, useState } from 'react';
import type { Game } from '../types';
import { fetchInfo, type GameInfo } from './api';

/** Info from IGDB, HowLongToBeat and OpenCritic for one game; null until loaded or when unavailable. */
export function useGameInfo(game: Game | undefined): GameInfo | null {
  const [info, setInfo] = useState<{ id: string; data: GameInfo | null } | null>(null);
  useEffect(() => {
    if (!game) return;
    let alive = true;
    fetchInfo(game).then((data) => alive && setInfo({ id: game.id, data }));
    return () => {
      alive = false;
    };
  }, [game]);
  return info && game && info.id === game.id ? info.data : null;
}
