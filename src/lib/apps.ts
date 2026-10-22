import type { Game } from '../types';
import { normalizeTitle } from './match';

// Media and utility apps that platforms report as "played" alongside games.
// Imports flag apps from store data; this list is the backup for apps a store
// files as games (e.g. SHAREfactory on PlayStation) and for data imported
// before apps were flagged. Matched on the whole normalized title, so
// "Max Payne" isn't caught by "Max".
const KNOWN_APPS = new Set(
  [
    'YouTube',
    'YouTube TV',
    'Twitch',
    'Netflix',
    'Spotify',
    'Disney+',
    'Plex',
    'Prime Video',
    'Amazon Prime Video',
    'HBO Max',
    'Max',
    'Crunchyroll',
    'Apple TV',
    'Apple Music',
    'Hulu',
    'Peacock',
    'Paramount+',
    'DAZN',
    'Tidal',
    'Deezer',
    'Filmbox Live',
    'Media Player',
    'SHAREfactory',
    'Share Factory Studio',
    'Wallpaper Engine',
  ].map(normalizeTitle),
);

export function isApp(game: Game): boolean {
  return game.kind === 'app' || (!!game.custom && KNOWN_APPS.has(normalizeTitle(game.title)));
}
