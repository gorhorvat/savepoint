// Friends: requests, the friend link, a friend's profile, and online status.
// See server/friends.mjs.

/** Tells the header's Friends badge to look again (after accepting or declining a request). */
export const FRIENDS_CHANGED = 'savepoint:friends-changed';

/** savepoint: used Savepoint in the last few minutes. */
export type PresencePlatform = 'steam' | 'playstation' | 'xbox' | 'savepoint';

export interface Presence {
  platform: PresencePlatform;
  online: boolean;
  /** Steam: online, busy, away, snooze or offline. */
  status?: string;
  /** PlayStation: PS5 or PS4. */
  device?: string | null;
  /** The game being played, when the platform shares it. */
  playing: string | null;
}

export interface FriendCard {
  id: number;
  username: string;
  avatar: string | null;
  level: number | null;
  rank: string | null;
  into: number | null;
  needed: number | null;
}

export interface Friend extends FriendCard {
  since: string;
  presence: Presence[];
}

export interface FriendsList {
  friends: Friend[];
  incoming: FriendCard[];
  outgoing: FriendCard[];
}

export interface ProfileGame {
  title: string;
  imageUrl?: string;
  hours?: number;
  platforms?: string[];
  /** The owner's game id (wishlist), so a gift can take it off their list. */
  gameId?: string;
  steamAppId?: number;
  nsuid?: string;
}

/** A physical copy someone is looking for, as friends see it. */
export interface ProfileWant {
  title: string;
  platform: string;
  edition?: string;
  imageUrl?: string;
}

/** What friends see of an account (sent by its app; see usePublicProfileSync). */
export interface PublicProfile {
  level: number;
  rank: string;
  xp: number;
  into: number;
  needed: number;
  avatar: string | null;
  favoriteGenres: string[];
  favoriteFranchises: string[];
  totalHours: number;
  gameCount: number;
  hoursByPlatform: Record<string, number>;
  topGames: ProfileGame[];
  wishlist: ProfileGame[];
  physicalWants?: ProfileWant[];
}

export interface FriendProfile {
  id: number;
  username: string;
  since: string;
  profile: Partial<PublicProfile> | null;
  updatedAt: string | null;
  presence: Presence[];
  /** Their Steam ID, PSN online ID and Xbox gamertag, when connected. */
  accounts?: { steam: string | null; playstation: string | null; xbox: string | null };
  /** Which of those platforms you have connected yourself. */
  mine?: { steam: boolean; playstation: boolean; xbox: boolean };
}

async function call<T>(url: string, method = 'GET', body?: object): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the Savepoint server.");
  }
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Failed (${r.status}).`);
  return data as T;
}

export const fetchFriends = () => call<FriendsList>('/api/friends');
export const fetchFriendSummary = () => call<{ incoming: number; online: number }>('/api/friends/summary');
export const fetchFriend = (id: number) => call<FriendProfile>(`/api/friends/${id}`);
export const fetchFriendCode = () => call<{ code: string }>('/api/friends/link');
export const newFriendCode = () => call<{ code: string }>('/api/friends/link', 'POST');
export const sendFriendRequest = (to: { username: string } | { code: string }) =>
  call<{ status: 'sent' | 'accepted'; friend: { id: number; username: string } }>('/api/friends/requests', 'POST', to);
export const acceptFriend = (id: number) => call(`/api/friends/requests/${id}/accept`, 'POST');
/** Declines an incoming request, or cancels one you sent. */
export const dropRequest = (id: number) => call(`/api/friends/requests/${id}`, 'DELETE');
export const removeFriend = (id: number) => call(`/api/friends/${id}`, 'DELETE');
export const savePublicProfile = (profile: PublicProfile) => call('/api/profile/public', 'PUT', profile);

/** The address that sends you a friend request when someone opens it. */
export const friendLink = (code: string) => `${location.origin}/add/${code}`;

const PLATFORM_NAMES: Record<PresencePlatform, string> = {
  steam: 'Steam',
  playstation: 'PlayStation',
  xbox: 'Xbox',
  savepoint: 'Savepoint',
};

const where = (p: Presence) => (p.platform === 'playstation' && p.device ? p.device : PLATFORM_NAMES[p.platform]);

// Playing something beats plain online; consoles before Steam (whose "online" is
// often just the client left running); Savepoint only when nothing else is.
const PLATFORM_ORDER: PresencePlatform[] = ['playstation', 'xbox', 'steam', 'savepoint'];
const away = (p: Presence) => !!p.status && p.status !== 'online';
const rank = (p: Presence) => (p.playing ? 0 : away(p) ? 20 : 10) + PLATFORM_ORDER.indexOf(p.platform);

/** Where a friend is online, most telling first; Savepoint only if nowhere else. */
export function onlineWhere(presence: Presence[]): Presence[] {
  const online = presence.filter((p) => p.online).sort((a, b) => rank(a) - rank(b));
  const elsewhere = online.filter((p) => p.platform !== 'savepoint');
  return elsewhere.length ? elsewhere : online;
}

/** "Playing Hades II on Steam", "Online on PS5 · Away on Steam", "Online on Savepoint" or "Offline". */
export function describePresence(presence: Presence[]): string {
  const online = onlineWhere(presence);
  if (!online.length) return 'Offline';
  return online
    .map((p) => {
      if (p.playing) return `Playing ${p.playing} on ${where(p)}`;
      const state = away(p) ? p.status![0].toUpperCase() + p.status!.slice(1) : 'Online';
      return `${state} on ${where(p)}`;
    })
    .join(' · ');
}

export const isOnline = (presence: Presence[]) => presence.some((p) => p.online);
export const isPlaying = (presence: Presence[]) => presence.some((p) => p.online && p.playing);

// ---------------------------------------------------------------- gifts (server/gifts.mjs)

export const GIFT_PLATFORMS = [
  'Steam',
  'Epic Games',
  'GOG',
  'PlayStation',
  'Xbox',
  'Nintendo',
  'Ubisoft',
  'EA',
  'Battle.net',
  'Other',
] as const;
export type GiftPlatform = (typeof GIFT_PLATFORMS)[number];

export interface Gift {
  id: number;
  /** Who sent it (received gifts). */
  from?: { id: number; username: string };
  /** Who it went to (sent gifts). */
  to?: { id: number; username: string };
  title: string;
  platform: GiftPlatform;
  message?: string;
  gameId?: string;
  sentAt: string;
  openedAt?: string;
  redeemedAt?: string;
}

export const fetchGifts = () => call<{ received: Gift[]; sent: Gift[] }>('/api/gifts');
export const fetchGiftSummary = () => call<{ unopened: number }>('/api/gifts/summary');
export const sendGift = (gift: {
  to: number;
  title: string;
  platform: GiftPlatform;
  key: string;
  message?: string;
  gameId?: string;
}) => call<{ id: number }>('/api/gifts', 'POST', gift);
export const openGift = (id: number) => call<{ key: string }>(`/api/gifts/${id}/open`, 'POST');
export const markGiftRedeemed = (id: number) =>
  call<{ ok: true; gameId?: string }>(`/api/gifts/${id}/redeemed`, 'POST');
export const takeBackGift = (id: number) => call(`/api/gifts/${id}`, 'DELETE');

// ---------------------------------------------------------------- leaderboards

export interface LeaderboardRow extends FriendCard {
  place: number;
  xp: number;
  hours: number;
  games: number;
  you: boolean;
}

export interface Leaderboard {
  scope: 'friends' | 'global';
  total: number;
  rows: LeaderboardRow[];
  /** Your own row, also when you're outside the top 100. */
  you: LeaderboardRow | null;
}

export const fetchLeaderboard = (scope: 'friends' | 'global') => call<Leaderboard>(`/api/leaderboard?scope=${scope}`);

/** Adds a Savepoint friend on PlayStation or Xbox: { sent } when done directly, else a page to finish it on. */
export const addOnPlatform = (id: number, platform: 'playstation' | 'xbox') =>
  call<{ sent: boolean; url: string }>(`/api/friends/${id}/add-on/${platform}`, 'POST');
