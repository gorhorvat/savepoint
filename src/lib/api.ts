import { useEffect, useMemo, useState } from 'react';
import { STORES } from '../data/stores';
import type { ChatMessage, Game, StoreId, StorePrice, TrophyGrades } from '../types';
import type { ImportedGame } from './store';

export interface ServerStatus {
  /** True when Ollama is reachable and has the configured model. */
  assistant: boolean;
  /** Which backend answers: Gemini (free API key) or a local Ollama model. */
  assistantProvider: 'gemini' | 'ollama';
  assistantModel: string;
  ollama: { reachable: boolean; installed: boolean; model: string; url: string };
  steam: boolean;
  psn: boolean;
  prices: boolean;
  /** IGDB (game info and screenshots) is set up. */
  igdb?: boolean;
  /** OpenCritic scores are set up. */
  critics?: boolean;
  /** IsThereAnyDeal prices are set up. */
  deals?: boolean;
  /** ntfy topic for price alerts, when set. */
  ntfyTopic?: string | null;
  /** False when the API server isn't running at all. */
  online: boolean;
  /** Xbox import (OpenXBL key) is set up and usable by this account. */
  xbox?: boolean;
  /** True for the super admin; other accounts can't use their PlayStation, Xbox or alerts, or the invite code. */
  superAdmin?: boolean;
}

const OFFLINE: ServerStatus = {
  assistant: false,
  assistantProvider: 'ollama',
  assistantModel: '',
  ollama: { reachable: false, installed: false, model: '', url: '' },
  steam: false,
  psn: false,
  prices: false,
  online: false,
};

let statusPromise: Promise<ServerStatus> | null = null;

/** Server capabilities, cached for the page's lifetime unless `fresh` is set. */
export function fetchStatus(fresh = false): Promise<ServerStatus> {
  if (fresh) statusPromise = null;
  statusPromise ??= fetch('/api/status')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((s) => ({ ...s, online: true }))
    .catch(() => {
      statusPromise = null;
      return OFFLINE;
    });
  return statusPromise;
}

/**
 * Pass `fresh` where the answer can change while the app is open (e.g. Ollama
 * being started). Call the returned `recheck` to ask again.
 */
export function useServerStatus(fresh = false): [ServerStatus | null, () => void] {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchStatus(fresh || attempt > 0).then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, [fresh, attempt]);
  return [status, () => setAttempt((n) => n + 1)];
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
  return body as T;
}

/** The address of a Steam account's profile page. */
export const steamProfileUrl = (steamId: string) => `https://steamcommunity.com/profiles/${steamId}/`;

// Steam data is always for the Steam account connected through Steam's login
// (Settings, Platforms); the server answers 409 when none is connected.

export function importSteam() {
  return getJson<{ steamId: string; games: ImportedGame[] }>('/api/steam/library');
}

export function fetchSteamAchievements(appids: number[]) {
  return getJson<{ results: Record<string, { earned: number; total: number }> }>(
    `/api/steam/achievements?appids=${appids.join(',')}`,
  );
}

export function fetchPsnTrophies() {
  return getJson<{
    titles: { name: string; earned: number; total: number; platinum: boolean; grades?: TrophyGrades }[];
  }>('/api/psn/trophies');
}

export function importPsn() {
  return getJson<{ games: ImportedGame[] }>('/api/psn/library');
}

export function importXbox() {
  return getJson<{ games: ImportedGame[] }>('/api/xbox/library');
}

// ---------------------------------------------------------------- genres

export interface GenreResult {
  genres: string[];
  subgenres: string[];
  tags: string[];
  source: 'steam' | 'igdb' | 'wikidata' | 'none';
  steamAppId?: number;
  developer?: string;
  year?: number;
  blurb?: string;
}

export interface GenreResponse {
  results: Record<string, GenreResult>;
  /** Seconds the service asked us to wait before sending more. */
  retryAfter?: number;
}

/**
 * Look up genres online. The 'steam' pass is fast and takes the whole list;
 * the 'wikidata' pass is slow and returns early with whatever it got through.
 * Games not covered are missing from `results`.
 */
export async function fetchGenres(games: Game[], pass: 'steam' | 'igdb' | 'wikidata'): Promise<GenreResponse> {
  const r = await fetch('/api/genres', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pass, games: games.map((g) => ({ id: g.id, title: g.title, steamAppId: g.steamAppId })) }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Genre lookup failed (${r.status})`);
  return body;
}

// ---------------------------------------------------------------- prices

interface LivePrices {
  found: boolean;
  historicalLow?: number | null;
  deals: { storeId: StoreId; price: number; regular: number; url: string }[];
  /** Lowest key-marketplace price, from GG.deals (needs GGDEALS_API_KEY). */
  keyshops?: KeyshopPrice | null;
  /** Best deal across every PC store IsThereAnyDeal tracks (needs ITAD_API_KEY). */
  itad?: ItadDeal | null;
}

export interface ItadDeal {
  current?: { price: number; regular: number; cut: number; shop: string; url: string };
  lowest?: { price: number; shop: string; date: string };
  url?: string;
}

export interface KeyshopPrice {
  price: number;
  historicalLow: number | null;
  /** GG.deals comparison page listing each marketplace's offer. */
  url: string;
}

const priceCache = new Map<string, Promise<LivePrices | null>>();

function loadLive(game: Game): Promise<LivePrices | null> {
  // Live prices: PC stores via CheapShark, Switch via the Nintendo eShop.
  const pc = game.availableOn.includes('steam') || game.availableOn.includes('epic');
  const nintendo = game.availableOn.includes('switch');
  if (!pc && !nintendo) return Promise.resolve(null);
  const key = game.id;
  if (!priceCache.has(key)) {
    const params = new URLSearchParams({ title: game.title });
    if (game.steamAppId) params.set('steamAppId', String(game.steamAppId));
    if (game.nsuid) params.set('nsuid', game.nsuid);
    if (pc) params.set('pc', '1');
    if (nintendo) params.set('switch', '1');
    const qs = params.toString();
    priceCache.set(
      key,
      fetchStatus().then((s) => (s.online ? getJson<LivePrices>(`/api/prices?${qs}`).catch(() => null) : null)),
    );
  }
  return priceCache.get(key)!;
}

const OFFICIAL_FOR: Partial<Record<StoreId, Game['availableOn'][number]>> = {
  steam: 'steam',
  epic: 'epic',
  psstore: 'playstation',
  eshop: 'switch',
};

/**
 * Prices for a game across trusted stores. PC stores use live CheapShark data
 * when the API server is running; console stores (which have no public price
 * API) and offline PC stores fall back to the game's typical full price, marked
 * as not live.
 */
export function buildPrices(game: Game, live: LivePrices | null): StorePrice[] {
  const out: StorePrice[] = [];
  const liveByStore = new Map((live?.deals ?? []).map((d) => [d.storeId, d]));
  for (const store of STORES) {
    if (store.kind === 'Key marketplace') continue;
    const d = liveByStore.get(store.id);
    if (d) {
      out.push({ storeId: store.id, price: d.price, regular: d.regular, url: d.url, live: true });
      continue;
    }
    const platform = OFFICIAL_FOR[store.id];
    if (platform && game.availableOn.includes(platform) && game.basePrice !== undefined) {
      out.push({
        storeId: store.id,
        price: game.basePrice,
        regular: game.basePrice,
        url: store.searchUrl(game),
        live: false,
      });
    }
  }
  return out.sort((a, b) => a.price - b.price);
}

export function usePrices(game: Game | undefined) {
  const [live, setLive] = useState<{ game: Game; data: LivePrices | null } | null>(null);
  useEffect(() => {
    if (!game) return;
    let alive = true;
    loadLive(game).then((data) => {
      if (alive) setLive({ game, data });
    });
    return () => {
      alive = false;
    };
  }, [game]);
  // Until this game's live prices arrive, show the typical-price fallback.
  const current = live && live.game === game ? live : null;
  const prices = useMemo(() => (game ? buildPrices(game, current?.data ?? null) : []), [game, current]);
  return {
    prices,
    loading: !!game && !current,
    historicalLow: current?.data?.historicalLow,
    keyshops: current?.data?.keyshops ?? null,
    itad: current?.data?.itad ?? null,
  };
}

// ---------------------------------------------------------------- search and wishlist

/** A game from search or the Steam wishlist, before it's saved in the app. */
export interface FoundGame {
  title: string;
  availableOn: Game['availableOn'];
  switchVersions?: string[];
  steamAppId?: number;
  nsuid?: string;
  imageUrl?: string;
  developer?: string;
  year?: number;
  blurb?: string;
  genres: string[];
  subgenres: string[];
  tags: string[];
  eshop?: { price: number; regular: number; url: string };
  addedAt?: string;
  releaseDate?: string;
  releaseLabel?: string;
  comingSoon?: boolean;
}

/** Cover image and release info for saved games (keyed by game id). */
export async function fetchDetails(
  games: Game[],
): Promise<
  Record<
    string,
    { imageUrl?: string; releaseDate?: string; releaseLabel?: string; comingSoon?: boolean; steamAppId?: number }
  >
> {
  const r = await fetch('/api/details', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      games: games.map((g) => ({
        id: g.id,
        title: g.title,
        steamAppId: g.steamAppId,
        nsuid: g.nsuid,
        switch: g.availableOn.includes('switch'),
        playstation: g.availableOn.includes('playstation'),
        epic: g.availableOn.includes('epic'),
      })),
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Details lookup failed (${r.status})`);
  return body.results;
}

/** Search every PC (Steam, Epic) and Nintendo Switch / Switch 2 game. */
/** Well-reviewed Steam games for these sub-genres and genres (strongest first). */
export async function fetchDiscoverPool(
  subgenres: string[],
  genres: string[],
  franchises: string[] = [],
): Promise<FoundGame[]> {
  const list = (xs: string[]) => encodeURIComponent(xs.join(','));
  const q = `subgenres=${list(subgenres)}&genres=${list(genres)}&franchises=${list(franchises)}`;
  return (await getJson<{ results: FoundGame[] }>(`/api/discover?${q}`)).results;
}

export async function searchGames(query: string, signal?: AbortSignal): Promise<FoundGame[]> {
  const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Search failed (${r.status})`);
  return body.results;
}

export function fetchSteamWishlist() {
  return getJson<{ steamId: string; games: FoundGame[] }>('/api/steam/wishlist');
}

// ---------------------------------------------------------------- assistant

export async function streamAssistant(
  messages: ChatMessage[],
  context: string,
  onText: (delta: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const r = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context }),
    signal,
  });
  if (!r.ok || !r.body) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `The assistant didn't respond (${r.status}).`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(decoder.decode(value, { stream: true }));
  }
}

// ---------------------------------------------------------------- game info

export interface GameLength {
  /** Typical hours: main story, main plus extras, everything. */
  main?: number;
  extra?: number;
  complete?: number;
  url: string;
}

export interface GameInfo {
  igdb: {
    summary?: string;
    developer?: string;
    year?: number;
    screenshots: { thumb: string; full: string }[];
  } | null;
  length: GameLength | null;
  critic: { score: number; tier?: string; reviews?: number; url: string } | null;
}

const infoCache = new Map<string, Promise<GameInfo | null>>();

/** Screenshots and summary (IGDB), length (HowLongToBeat) and critic score (OpenCritic). */
export function fetchInfo(game: Game): Promise<GameInfo | null> {
  if (!infoCache.has(game.id)) {
    const qs = new URLSearchParams({ title: game.title });
    if (game.steamAppId) qs.set('steamAppId', String(game.steamAppId));
    infoCache.set(
      game.id,
      getJson<GameInfo>(`/api/info?${qs}`).catch(() => {
        infoCache.delete(game.id);
        return null;
      }),
    );
  }
  return infoCache.get(game.id)!;
}

export async function fetchLengths(games: Game[]): Promise<Record<string, GameLength | null>> {
  const r = await fetch('/api/lengths', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ games: games.map((g) => ({ id: g.id, title: g.title })) }),
  });
  if (!r.ok) throw new Error(`Length lookup failed (${r.status})`);
  return (await r.json()).results;
}

export interface AlertItem {
  id: string;
  title: string;
  steamAppId?: number;
  nsuid?: string;
  pc: boolean;
  switch: boolean;
  target: number;
}

/** Sends the wishlist's target prices to the server, which checks them every 6 hours. */
export async function syncAlerts(items: AlertItem[]): Promise<{ checked: number; sent: number }> {
  const r = await fetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Price check failed (${r.status})`);
  return body;
}

export async function sendTestAlert(): Promise<void> {
  const r = await fetch('/api/alerts/test', { method: 'POST' });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Test failed (${r.status})`);
}

/** Changes the logged-in account's password (no current one when setting the first). Returns why it failed, or null. */
export async function changePassword(current: string, next: string): Promise<string | null> {
  try {
    const r = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, next }),
    });
    if (r.ok) return null;
    return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Failed (${r.status}).`;
  } catch {
    return "Can't reach the Savepoint server.";
  }
}

export interface Account {
  username: string;
  /** False for an account made through Steam that hasn't set a password. */
  hasPassword: boolean;
  /** SteamID64 when Steam is linked as a way to log in. */
  steamId: string | null;
}

export function fetchAccount(): Promise<Account> {
  return getJson<Account>('/api/account');
}

/** Removes Steam as a way to log in (needs a password). Returns why it failed, or null. */
export async function unlinkSteam(): Promise<string | null> {
  try {
    const r = await fetch('/api/account/steam/unlink', { method: 'POST' });
    if (r.ok) return null;
    return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Failed (${r.status}).`;
  } catch {
    return "Can't reach the Savepoint server.";
  }
}

/** The invite code for sign-up ('' = sign-up closed). Super admin only. */
export async function fetchInviteCode(): Promise<string> {
  return (await getJson<{ code: string }>('/api/admin/invite')).code;
}

/** Sets the invite code: a given one, a new random one, or '' to close sign-up. Returns the new code. */
export async function updateInviteCode(change: { code: string } | { generate: true }): Promise<string> {
  const r = await fetch('/api/admin/invite', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Failed (${r.status}).`);
  return body.code;
}

export interface Taxonomy {
  genres: string[];
  subgenres: string[];
}

let taxonomyPromise: Promise<Taxonomy> | null = null;

/** Every genre and sub-genre name Savepoint knows (for the favourites picker). */
export function fetchTaxonomy(): Promise<Taxonomy> {
  taxonomyPromise ??= getJson<Taxonomy>('/api/taxonomy').catch((err) => {
    taxonomyPromise = null;
    throw err;
  });
  return taxonomyPromise;
}
