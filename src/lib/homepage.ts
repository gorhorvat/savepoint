// The homepage: which sections it shows, in which order (Settings, Homepage).
import type { FreeStore } from './api';

/** The stores free games are given away on (server/dealAlerts.mjs FREE_STORES). */
export const FREE_STORE_LABELS: Record<FreeStore, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG',
  itchio: 'itch.io',
  ubisoft: 'Ubisoft',
  ea: 'EA',
  battlenet: 'Battle.net',
  amazon: 'Prime Gaming',
  playstation: 'PlayStation',
  xbox: 'Xbox',
  switch: 'Switch',
  mobile: 'Android / iOS',
  drmfree: 'DRM-free',
};

export type HomeWidgetId =
  | 'continue'
  | 'picks'
  | 'live'
  | 'friends'
  | 'free'
  | 'news'
  | 'upcoming'
  | 'deals'
  | 'top'
  | 'stats'
  | 'leaderboard';

export interface HomeWidget {
  id: HomeWidgetId;
  on: boolean;
}

/** Which free games the homepage shows: stores (empty = all), and whether DLC and loot count. */
export interface HomeFreeGames {
  stores: FreeStore[];
  dlc: boolean;
  loot: boolean;
}

export interface HomepageSettings {
  widgets: HomeWidget[];
  /** News sites to show (server/news.mjs ids); empty = all. */
  newsSources: string[];
  freeGames: HomeFreeGames;
}

export const DEFAULT_HOME_FREE_GAMES: HomeFreeGames = { stores: [], dlc: false, loot: false };

export const HOME_WIDGETS: Record<HomeWidgetId, { label: string; description: string }> = {
  continue: { label: 'Continue playing', description: 'What you played most recently.' },
  picks: { label: 'Play next', description: 'Your best suggestions right now.' },
  live: { label: 'Your streamers, live', description: 'Twitch and Kick channels you follow that are live now.' },
  friends: { label: 'Friend activity', description: 'Who is online, what they are playing, requests and gifts.' },
  free: { label: 'Free games', description: 'Games given away to keep right now.' },
  news: { label: 'Gaming news', description: 'The newest headlines from big gaming sites.' },
  upcoming: { label: 'Coming soon', description: 'Wishlisted games that come out soon.' },
  deals: { label: 'Big deals', description: 'Well-reviewed PC games at their lowest price.' },
  top: { label: 'Your top games', description: 'The games you have played most.' },
  stats: { label: 'Quick stats', description: 'Hours, games and your level.' },
  leaderboard: { label: 'Leaderboard', description: 'Where you stand among your friends.' },
};

export const NEWS_SITES: { id: string; name: string }[] = [
  { id: 'ign', name: 'IGN' },
  { id: 'gamespot', name: 'GameSpot' },
  { id: 'pcgamer', name: 'PC Gamer' },
  { id: 'eurogamer', name: 'Eurogamer' },
  { id: 'polygon', name: 'Polygon' },
  { id: 'kotaku', name: 'Kotaku' },
  { id: 'rps', name: 'Rock Paper Shotgun' },
  { id: 'gamesradar', name: 'GamesRadar+' },
];

export const DEFAULT_HOMEPAGE: HomepageSettings = {
  widgets: [
    { id: 'continue', on: true },
    { id: 'picks', on: true },
    { id: 'live', on: true },
    { id: 'friends', on: true },
    { id: 'free', on: true },
    { id: 'news', on: true },
    { id: 'upcoming', on: true },
    { id: 'deals', on: false },
    { id: 'top', on: false },
    { id: 'stats', on: false },
    { id: 'leaderboard', on: false },
  ],
  newsSources: [],
  freeGames: DEFAULT_HOME_FREE_GAMES,
};

/** Saved settings with any section added since, appended (off) at the end. */
export function normalizeHomepage(saved: Partial<HomepageSettings> | undefined): HomepageSettings {
  const known = (saved?.widgets ?? []).filter((w) => w && w.id in HOME_WIDGETS);
  const seen = new Set(known.map((w) => w.id));
  const added = DEFAULT_HOMEPAGE.widgets.filter((w) => !seen.has(w.id)).map((w) => ({ ...w, on: saved ? false : w.on }));
  return {
    widgets: known.length ? [...known, ...added] : DEFAULT_HOMEPAGE.widgets,
    newsSources: Array.isArray(saved?.newsSources) ? saved.newsSources : [],
    freeGames: {
      stores: Array.isArray(saved?.freeGames?.stores)
        ? saved.freeGames.stores.filter((k) => k in FREE_STORE_LABELS)
        : [],
      dlc: saved?.freeGames?.dlc === true,
      loot: saved?.freeGames?.loot === true,
    },
  };
}
