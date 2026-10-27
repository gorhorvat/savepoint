export type PlatformId = 'steam' | 'epic' | 'playstation' | 'switch';

export type StoreId =
  | 'steam'
  | 'epic'
  | 'psstore'
  | 'eshop'
  | 'gog'
  | 'humble'
  | 'fanatical'
  | 'gmg'
  | 'eneba'
  | 'g2a'
  | 'gamivo'
  | 'kinguin'
  | 'hrk';

export interface Game {
  id: string;
  title: string;
  year?: number;
  developer?: string;
  steamAppId?: number;
  /** Broad genres, e.g. "RPG". */
  genres: string[];
  /** Specific sub-genres, e.g. "Soulslike". */
  subgenres: string[];
  /** Feel and feature tags used for matching, e.g. "co-op", "story-rich". */
  tags: string[];
  availableOn: PlatformId[];
  blurb?: string;
  /** Typical full price in USD, used for sample store prices. 0 = free to play. */
  basePrice?: number;
  imageUrl?: string;
  /** True for games created from an import that aren't in the built-in catalog. */
  custom?: boolean;
  /** 'app' for non-game titles a platform reports, like YouTube or Twitch. */
  kind?: 'game' | 'app';
  /** Where an imported game's genres came from; 'none' = looked up, not found. */
  genreSource?: 'steam' | 'igdb' | 'wikidata' | 'nintendo' | 'none';
  /** Nintendo eShop id, for live Switch prices. */
  nsuid?: string;
  /** Which Nintendo consoles it's sold for, e.g. ['Switch', 'Switch 2']. */
  switchVersions?: string[];
  /** ISO release date, when known. */
  releaseDate?: string;
  /** How the store announces an upcoming release: "14 Oct 2027", "Q4 2027", "Coming soon". */
  releaseLabel?: string;
  /** True until the game is out. */
  comingSoon?: boolean;
}

export type EntrySource = 'demo' | 'steam' | 'psn' | 'manual';

/** Where a game stands for you. "completed" = everything done (100%). */
export type PlayStatus = 'playing' | 'backlog' | 'finished' | 'completed' | 'dropped';

export interface Progress {
  status?: PlayStatus;
  /** 1-5 stars. */
  rating?: number;
  /** YYYY-MM-DD */
  finishedAt?: string;
}

/** Hours played on a day, worked out from the difference between syncs. */
export interface PlayLogEntry {
  /** YYYY-MM-DD */
  date: string;
  gameId: string;
  minutes: number;
}

export interface TrophyGrades {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
}

/** Achievement or trophy progress for one game on one platform. */
export interface AchievementProgress {
  earned: number;
  total: number;
  /** PlayStation only: the platinum trophy is earned. */
  platinum?: boolean;
  /** PlayStation only: earned trophies by grade (for XP). */
  grades?: TrophyGrades;
  /** Total play minutes when this was checked, to skip unchanged games. */
  minutesAt?: number;
  checkedAt: string;
}

export interface PlayEntry {
  gameId: string;
  platform: PlatformId;
  minutes: number;
  lastPlayed: string | null;
  source: EntrySource;
}

export interface WishlistItem {
  gameId: string;
  addedAt: string;
  /** Alert me when the best price drops to this (USD). */
  targetPrice?: number;
  note?: string;
  /** 'steam' for items copied from the Steam wishlist; they follow it on each sync. */
  source?: 'steam' | 'manual';
}

export interface StorePrice {
  storeId: StoreId;
  price: number;
  regular: number;
  url: string;
  live: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Cover and release info looked up for a game (catalog or custom). */
export interface GameDetails {
  imageUrl?: string;
  releaseDate?: string;
  releaseLabel?: string;
  comingSoon?: boolean;
  /** When the lookup ran; missing means not looked up yet. */
  checkedAt?: string;
  /** Lookup version; games checked by an older version without a cover are retried. */
  v?: number;
}

export type PhysicalPlatform =
  | 'PS5'
  | 'PS4'
  | 'Switch 2'
  | 'Switch'
  | 'Xbox Series X|S'
  | 'Xbox One'
  | 'PC'
  | 'Other';

export type Condition = 'Sealed' | 'Complete' | 'Game only';

/** A physical copy you own. */
export interface PhysicalItem {
  id: string;
  /** Linked game record (catalog or custom), when picked from search. */
  gameId?: string;
  title: string;
  platform: PhysicalPlatform;
  condition?: Condition;
  edition?: string;
  pricePaid?: number;
  acquiredAt?: string;
  notes?: string;
  addedAt: string;
}

/** A physical copy you're looking for. */
export interface PhysicalWant {
  id: string;
  gameId?: string;
  title: string;
  platform: PhysicalPlatform;
  maxPrice?: number;
  edition?: string;
  notes?: string;
  addedAt: string;
}
