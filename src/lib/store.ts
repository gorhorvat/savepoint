import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LEGACY_GAMES_BY_ID } from '../data/legacyCatalog';
import type {
  AchievementProgress,
  ChatMessage,
  EntrySource,
  Game,
  GameDetails,
  PhysicalItem,
  PhysicalWant,
  PlatformId,
  PlayEntry,
  PlayLogEntry,
  Progress,
  WishlistItem,
} from '../types';
import type { FoundGame, GameLength, GenreResult } from './api';
import { legacyMatcher, slug } from './match';
import { hydrationDone, serverStorage } from './serverStorage';

export interface ImportedGame {
  name: string;
  minutes: number;
  lastPlayed: string | null;
  steamAppId?: number;
  imageUrl?: string;
  /** Set by the import when the platform says this title isn't a game. */
  isApp?: boolean;
}

export interface Connection {
  /** Last library import; missing if only the wishlist was synced. */
  lastSync?: string;
  /** Last Steam wishlist sync. */
  wishlistSync?: string;
  count: number;
  account?: string;
}

export interface Profile {
  /** Small JPEG as a data URL (resized to 256 px before saving). */
  avatar?: string;
  /** Genre and sub-genre names, e.g. "Survival horror". */
  favoriteGenres: string[];
  /** Series names matched against titles, e.g. "Resident Evil". */
  favoriteFranchises: string[];
}

interface State {
  entries: PlayEntry[];
  customGames: Record<string, Game>;
  genreOverrides: Record<string, { genres: string[]; subgenres: string[] }>;
  /** Cover and release info looked up per game id. */
  details: Record<string, GameDetails>;
  physical: PhysicalItem[];
  physicalWants: PhysicalWant[];
  wishlist: WishlistItem[];
  dismissed: string[];
  connections: Partial<Record<PlatformId, Connection>>;
  chat: ChatMessage[];
  /** Show apps like YouTube and Twitch in the library. */
  showApps: boolean;
  /** Extra Play next candidates from Steam, for the taste profile named by `key`. */
  suggested: { key: string; fetchedAt: string; games: Record<string, Game> };
  /** Status, rating and finish date you set per game. */
  progress: Record<string, Progress>;
  /**
   * Play time history, recorded from the change between syncs. `base` holds
   * each game's total at the last recording; `since` is when tracking began.
   */
  history: { since?: string; recordedAt?: string; base: Record<string, number>; log: PlayLogEntry[] };
  /** Achievements and trophies per game and platform. */
  achievements: Record<string, Partial<Record<PlatformId, AchievementProgress>>>;
  achievementsSync?: string;
  /** Typical hours to beat (HowLongToBeat); null = looked up, not found. */
  lengths: Record<string, { main?: number; extra?: number; complete?: number; url?: string; checkedAt: string } | null>;
  /** Your profile: picture, and the genres and franchises you love (they boost suggestions). */
  profile: Profile;
  /** Shops searched for physical wants, as domains ("amazon.de", "vinted.hr"). */
  vendors: string[];

  importLibrary: (
    platform: PlatformId,
    source: EntrySource,
    games: ImportedGame[],
    account?: string,
  ) => { matched: number; added: number; removedSample: boolean };
  addManualEntry: (input: {
    gameId?: string;
    title?: string;
    platform: PlatformId;
    minutes: number;
    lastPlayed: string | null;
  }) => string;
  removeEntry: (gameId: string, platform: PlatformId) => void;
  disconnect: (platform: PlatformId) => void;
  removeDemo: () => void;
  setGenres: (gameId: string, genres: string[], subgenres: string[]) => void;
  toggleWishlist: (gameId: string) => boolean;
  setSuggested: (key: string, found: FoundGame[]) => void;
  setProgress: (gameId: string, patch: Partial<Progress>) => void;
  applyLengths: (results: Record<string, GameLength | null>) => void;
  recordHistory: () => void;
  applyAchievements: (
    platform: PlatformId,
    results: Record<string, Omit<AchievementProgress, 'checkedAt'>>,
    finished?: boolean,
  ) => void;
  /** Save a game found by search (if it isn't known yet) and wishlist it. Returns its id. */
  addFoundToWishlist: (found: FoundGame) => string;
  /** Mirror the Steam wishlist: add new items, drop ones removed on Steam. Returns counts. */
  syncSteamWishlist: (games: FoundGame[], profile: string) => { added: number; removed: number; total: number };
  updateWishlist: (gameId: string, patch: Partial<WishlistItem>) => void;
  dismiss: (gameId: string) => void;
  restoreDismissed: () => void;
  setChat: (chat: ChatMessage[]) => void;
  setShowApps: (show: boolean) => void;
  applyGenres: (results: Record<string, GenreResult>) => void;
  applyDetails: (results: Record<string, GameDetails & { steamAppId?: number }>) => void;
  /** Save a game picked from search (if new). Returns its id. */
  saveFound: (found: FoundGame) => string;
  addPhysical: (item: Omit<PhysicalItem, 'id' | 'addedAt'>) => void;
  updatePhysical: (id: string, patch: Partial<PhysicalItem>) => void;
  removePhysical: (id: string) => void;
  addWant: (item: Omit<PhysicalWant, 'id' | 'addedAt'>) => void;
  updateWant: (id: string, patch: Partial<PhysicalWant>) => void;
  removeWant: (id: string) => void;
  updateProfile: (patch: Partial<Profile>) => void;
  setVendors: (vendors: string[]) => void;
}

function ensureGame(
  customGames: Record<string, Game>,
  item: ImportedGame,
  platform: PlatformId,
  findLegacy = legacyMatcher(customGames),
): string {
  const match = findLegacy(item.name, item.steamAppId);
  if (match) return match.id;
  const id = `x-${slug(item.name)}`;
  const prev: Game = customGames[id] ?? {
    id,
    title: item.name,
    steamAppId: item.steamAppId,
    imageUrl: item.imageUrl,
    genres: [],
    subgenres: [],
    tags: [],
    availableOn: [],
    custom: true,
  };
  customGames[id] = {
    ...prev,
    availableOn: prev.availableOn.includes(platform) ? prev.availableOn : [...prev.availableOn, platform],
    // A later import's flag wins; manual entries (no flag) keep what's known.
    kind: item.isApp === undefined ? prev.kind : item.isApp ? 'app' : 'game',
  };
  return id;
}

/**
 * Store a game from search or a wishlist: games from the old catalog keep
 * their entry; anything else becomes (or updates) a custom game. Returns its id.
 */
function upsertFound(customGames: Record<string, Game>, f: FoundGame): string {
  const match = legacyMatcher(customGames)(f.title, f.steamAppId);
  if (match) return match.id;
  const id = `x-${slug(f.title)}`;
  const prev = customGames[id];
  const hasGenres = f.genres.length + f.subgenres.length > 0;
  customGames[id] = {
    id,
    title: prev?.title ?? f.title,
    genres: prev?.genres.length ? prev.genres : f.genres,
    subgenres: prev?.subgenres.length ? prev.subgenres : f.subgenres,
    tags: prev?.tags.length ? prev.tags : f.tags,
    genreSource: prev?.genreSource ?? (hasGenres ? (f.steamAppId ? 'steam' : 'nintendo') : undefined),
    availableOn: [...new Set([...(prev?.availableOn ?? []), ...f.availableOn])],
    switchVersions: f.switchVersions ?? prev?.switchVersions,
    steamAppId: prev?.steamAppId ?? f.steamAppId,
    nsuid: prev?.nsuid ?? f.nsuid,
    imageUrl: prev?.imageUrl ?? f.imageUrl,
    developer: prev?.developer ?? f.developer,
    year: prev?.year ?? f.year,
    blurb: prev?.blurb ?? f.blurb,
    basePrice: prev?.basePrice ?? f.eshop?.regular,
    releaseDate: f.releaseDate ?? prev?.releaseDate,
    releaseLabel: f.releaseLabel ?? prev?.releaseLabel,
    comingSoon: f.comingSoon ?? prev?.comingSoon,
    kind: prev?.kind ?? 'game',
    custom: true,
  };
  return id;
}

/** Bump when the cover lookup gains sources, so games without a cover are retried. */
// 3: covers missed when a big import overflowed the lookup are retried.
export const DETAILS_VERSION = 3;

type PersistedState = Omit<State, 'suggested'>;

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      entries: [],
      customGames: {},
      genreOverrides: {},
      details: {},
      physical: [],
      physicalWants: [],
      wishlist: [],
      dismissed: [],
      connections: {},
      chat: [],
      profile: { favoriteGenres: [], favoriteFranchises: [] },
      vendors: ['ebay.com'],
      showApps: false,
      suggested: { key: '', fetchedAt: '', games: {} },
      progress: {},
      history: { base: {}, log: [] },
      achievements: {},
      lengths: {},

      importLibrary: (platform, source, games, account) => {
        const customGames = { ...get().customGames };
        const details = { ...get().details };
        // Merge duplicates within one import (e.g. PS4 and PS5 versions of a game).
        const merged = new Map<string, PlayEntry>();
        let matched = 0;
        const findLegacy = legacyMatcher(customGames);
        for (const g of games) {
          const gameId = ensureGame(customGames, g, platform, findLegacy);
          // Old catalog games have no image of their own; keep the platform's.
          if (!customGames[gameId]?.imageUrl && g.imageUrl && !details[gameId]?.imageUrl) {
            details[gameId] = { ...details[gameId], imageUrl: g.imageUrl };
          }
          if (!gameId.startsWith('x-')) matched++;
          const prev = merged.get(gameId);
          merged.set(gameId, {
            gameId,
            platform,
            source,
            minutes: (prev?.minutes ?? 0) + g.minutes,
            lastPlayed: [prev?.lastPlayed, g.lastPlayed].filter(Boolean).sort().pop() ?? null,
          });
        }
        // An import replaces everything previously imported from that platform
        // but leaves manual entries alone. The first real import also clears
        // the whole sample library, so sample games never mix with real ones.
        const removedSample = get().entries.some((e) => e.source === 'demo');
        const keep = get().entries.filter(
          (e) => e.source !== 'demo' && !(e.platform === platform && e.source === source),
        );
        set({
          customGames,
          details,
          entries: [...keep, ...merged.values()],
          connections: {
            ...get().connections,
            // Keep other fields, e.g. the Steam wishlist's last sync time.
            [platform]: {
              ...get().connections[platform],
              lastSync: new Date().toISOString(),
              count: merged.size,
              account,
            },
          },
        });
        return { matched, added: merged.size, removedSample };
      },

      addManualEntry: ({ gameId, title, platform, minutes, lastPlayed }) => {
        const customGames = { ...get().customGames };
        const id = gameId ?? ensureGame(customGames, { name: title ?? 'Untitled', minutes, lastPlayed }, platform);
        const others = get().entries.filter((e) => !(e.gameId === id && e.platform === platform));
        set({
          customGames,
          entries: [...others, { gameId: id, platform, minutes, lastPlayed, source: 'manual' }],
        });
        return id;
      },

      removeEntry: (gameId, platform) =>
        set({ entries: get().entries.filter((e) => !(e.gameId === gameId && e.platform === platform)) }),

      disconnect: (platform) => {
        const connections = { ...get().connections };
        delete connections[platform];
        set({
          connections,
          entries: get().entries.filter(
            (e) => !(e.platform === platform && (e.source === 'steam' || e.source === 'psn')),
          ),
        });
      },

      removeDemo: () => set({ entries: get().entries.filter((e) => e.source !== 'demo') }),

      setGenres: (gameId, genres, subgenres) =>
        set({ genreOverrides: { ...get().genreOverrides, [gameId]: { genres, subgenres } } }),

      addFoundToWishlist: (found) => {
        const customGames = { ...get().customGames };
        const id = upsertFound(customGames, found);
        set({ customGames });
        if (!get().wishlist.some((w) => w.gameId === id)) {
          set({ wishlist: [...get().wishlist, { gameId: id, addedAt: new Date().toISOString(), source: 'manual' }] });
        }
        return id;
      },

      syncSteamWishlist: (games, profile) => {
        const customGames = { ...get().customGames };
        const steamIds = new Map(games.map((g) => [upsertFound(customGames, g), g]));
        const current = get().wishlist;
        const kept = current
          .filter((w) => w.source !== 'steam' || steamIds.has(w.gameId))
          // Games added here that are now also on Steam follow Steam from now on.
          .map((w) => (steamIds.has(w.gameId) ? { ...w, source: 'steam' as const } : w));
        const have = new Set(kept.map((w) => w.gameId));
        const added = [...steamIds]
          .filter(([id]) => !have.has(id))
          .map(([id, g]) => ({ gameId: id, addedAt: g.addedAt ?? new Date().toISOString(), source: 'steam' as const }));
        set({
          customGames,
          wishlist: [...kept, ...added],
          connections: {
            ...get().connections,
            steam: {
              ...(get().connections.steam ?? { count: 0 }),
              account: profile,
              wishlistSync: new Date().toISOString(),
            } as Connection,
          },
        });
        return { added: added.length, removed: current.length - kept.length, total: games.length };
      },

      toggleWishlist: (gameId) => {
        const has = get().wishlist.some((w) => w.gameId === gameId);
        // A Play next suggestion isn't saved anywhere yet; keep it once it's wishlisted.
        const { customGames, suggested } = get();
        if (!has && !customGames[gameId] && suggested.games[gameId]) {
          set({ customGames: { ...customGames, [gameId]: suggested.games[gameId] } });
        }
        set({
          wishlist: has
            ? get().wishlist.filter((w) => w.gameId !== gameId)
            : [...get().wishlist, { gameId, addedAt: new Date().toISOString() }],
        });
        return !has;
      },

      updateWishlist: (gameId, patch) =>
        set({ wishlist: get().wishlist.map((w) => (w.gameId === gameId ? { ...w, ...patch } : w)) }),

      dismiss: (gameId) => set({ dismissed: [...get().dismissed, gameId] }),
      restoreDismissed: () => set({ dismissed: [] }),
      setChat: (chat) => set({ chat }),
      setShowApps: (showApps) => set({ showApps }),

      applyLengths: (results) => {
        const lengths = { ...get().lengths };
        const checkedAt = new Date().toISOString();
        for (const [id, r] of Object.entries(results)) lengths[id] = r ? { ...r, checkedAt } : null;
        set({ lengths });
      },

      setProgress: (gameId, patch) => {
        const next = { ...get().progress[gameId], ...patch };
        // Drop cleared fields so an emptied game leaves no trace.
        for (const k of Object.keys(next) as (keyof Progress)[]) if (next[k] == null) delete next[k];
        const progress = { ...get().progress };
        if (Object.keys(next).length) progress[gameId] = next;
        else delete progress[gameId];
        set({ progress });
      },

      recordHistory: () => {
        const real = get().entries.filter((e) => e.source !== 'demo');
        if (!real.length) return;
        const totals: Record<string, number> = {};
        const last: Record<string, string> = {};
        for (const e of real) {
          totals[e.gameId] = (totals[e.gameId] ?? 0) + e.minutes;
          if (e.lastPlayed && e.lastPlayed > (last[e.gameId] ?? '')) last[e.gameId] = e.lastPlayed;
        }
        const now = new Date().toISOString();
        const { since, recordedAt, base, log } = get().history;
        if (!since) {
          // Start from today: hours before this point can't be dated.
          set({ history: { since: now, recordedAt: now, base: totals, log: [] } });
          return;
        }
        const added: PlayLogEntry[] = [];
        for (const [gameId, minutes] of Object.entries(totals)) {
          const before = base[gameId];
          // A game new to Savepoint only counts if it was first played after tracking began.
          const diff = before == null ? (last[gameId] && last[gameId] >= since ? minutes : 0) : minutes - before;
          if (diff <= 0) continue;
          // Date the hours by the last session when the platform reports one since the previous sync.
          const when = last[gameId] && last[gameId] > (recordedAt ?? since) ? new Date(last[gameId]) : new Date();
          added.push({ date: localDay(when), gameId, minutes: diff });
        }
        if (!added.length && Object.entries(totals).every(([id, m]) => base[id] === m)) return;
        const merged = [...log];
        for (const a of added) {
          const i = merged.findIndex((x) => x.date === a.date && x.gameId === a.gameId);
          if (i >= 0) merged[i] = { ...merged[i], minutes: merged[i].minutes + a.minutes };
          else merged.push(a);
        }
        // Removed games keep their last total, so reconnecting a platform doesn't count them twice.
        set({ history: { since, recordedAt: now, base: { ...base, ...totals }, log: merged } });
      },

      applyAchievements: (platform, results, finished) => {
        const achievements = { ...get().achievements };
        const checkedAt = new Date().toISOString();
        for (const [gameId, r] of Object.entries(results)) {
          achievements[gameId] = { ...achievements[gameId], [platform]: { ...r, checkedAt } };
        }
        set({ achievements, ...(finished && { achievementsSync: checkedAt }) });
      },

      setSuggested: (key, found) => {
        const games: Record<string, Game> = {};
        for (const f of found) upsertFound(games, f);
        set({ suggested: { key, fetchedAt: new Date().toISOString(), games } });
      },

      applyDetails: (results) => {
        const details = { ...get().details };
        const customGames = { ...get().customGames };
        const checkedAt = new Date().toISOString();
        for (const [id, r] of Object.entries(results)) {
          const { steamAppId, ...d } = r;
          details[id] = {
            ...details[id],
            ...d,
            imageUrl: d.imageUrl ?? details[id]?.imageUrl,
            checkedAt,
            v: DETAILS_VERSION,
          };
          // A title match on Steam also turns on live PC prices for imported games.
          const g = customGames[id];
          if (g && steamAppId && !g.steamAppId) {
            customGames[id] = {
              ...g,
              steamAppId,
              availableOn: g.availableOn.includes('steam') ? g.availableOn : [...g.availableOn, 'steam'],
            };
          }
        }
        set({ details, customGames });
      },

      saveFound: (found) => {
        const customGames = { ...get().customGames };
        const id = upsertFound(customGames, found);
        set({ customGames });
        return id;
      },

      addPhysical: (item) =>
        set({ physical: [...get().physical, { ...item, id: crypto.randomUUID(), addedAt: new Date().toISOString() }] }),
      updatePhysical: (id, patch) =>
        set({ physical: get().physical.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
      removePhysical: (id) => set({ physical: get().physical.filter((p) => p.id !== id) }),
      addWant: (item) =>
        set({
          physicalWants: [
            ...get().physicalWants,
            { ...item, id: crypto.randomUUID(), addedAt: new Date().toISOString() },
          ],
        }),
      updateWant: (id, patch) =>
        set({ physicalWants: get().physicalWants.map((w) => (w.id === id ? { ...w, ...patch } : w)) }),
      removeWant: (id) => set({ physicalWants: get().physicalWants.filter((w) => w.id !== id) }),
      updateProfile: (patch) => set({ profile: { ...get().profile, ...patch } }),
      setVendors: (vendors) => set({ vendors }),

      applyGenres: (results) => {
        const customGames = { ...get().customGames };
        for (const [id, r] of Object.entries(results)) {
          const g = customGames[id];
          if (!g) continue;
          customGames[id] = {
            ...g,
            genres: r.genres,
            subgenres: r.subgenres,
            tags: r.tags,
            genreSource: r.source,
            // Fill in what the import didn't have. A Steam match also means
            // the game is sold on Steam, which turns on live PC prices.
            steamAppId: g.steamAppId ?? r.steamAppId,
            availableOn: r.steamAppId && !g.availableOn.includes('steam') ? [...g.availableOn, 'steam'] : g.availableOn,
            developer: g.developer ?? r.developer,
            year: g.year ?? r.year,
            blurb: g.blurb ?? r.blurb,
          };
        }
        set({ customGames });
      },
    }),
    {
      name: 'savepoint',
      // Saved in VerBuddy through the Savepoint server, not in the browser.
      storage: serverStorage<PersistedState>(),
      // The Discover pool is re-fetched (and cached on the server), so it isn't saved.
      partialize: (state) => {
        const saved: Partial<State> = { ...state };
        delete saved.suggested;
        return saved as PersistedState;
      },
      onRehydrateStorage: () => (_state, error) => hydrationDone(error),
      version: 5,
      migrate: (persisted, version) => {
        const state = persisted as State;
        // v5 dropped the built-in catalog: games your data points at by a
        // catalog id are copied into customGames under the same id.
        if (version < 5) {
          state.customGames ??= {};
          const ids = new Set<string>([
            ...[state.entries, state.physical, state.physicalWants, state.wishlist]
              .flatMap((list): { gameId?: string }[] => (Array.isArray(list) ? list : []))
              .map((x) => x.gameId)
              .filter((id): id is string => !!id),
            ...(state.dismissed ?? []),
            ...[state.progress, state.achievements, state.details, state.lengths, state.genreOverrides, state.history?.base]
              .flatMap((map) => Object.keys(map ?? {})),
          ]);
          for (const id of ids) {
            const legacy = LEGACY_GAMES_BY_ID[id];
            if (legacy && !state.customGames[id]) state.customGames[id] = legacy;
          }
        }
        // v3 added IGDB, and v4 fixed Wikidata and IGDB lookups that wrongly
        // came back empty: games no source had genres for get another look.
        if (version < 4 && state.customGames) {
          for (const [id, g] of Object.entries(state.customGames)) {
            if (g.genreSource === 'none') state.customGames[id] = { ...g, genreSource: undefined };
          }
        }
        // v1 shipped three sample wishlist items; drop them unless the user edited them.
        if (version < 2 && Array.isArray(state.wishlist)) {
          const samples = new Set([
            'clair-obscur-expedition-33|2026-09-02T10:00:00Z',
            'metaphor-refantazio|2026-08-14T10:00:00Z',
            'animal-well|2026-07-30T10:00:00Z',
          ]);
          state.wishlist = state.wishlist.filter((w) => !samples.has(`${w.gameId}|${w.addedAt}`));
        }
        return state;
      },
    },
  ),
);

/** YYYY-MM-DD in the local time zone. */
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type GenreOverride = State['genreOverrides'][string];
const resolved = new WeakMap<Game, { override?: GenreOverride; detail?: GameDetails; game: Game }>();

/**
 * Resolve a game id to saved or suggested game data, with user genre edits
 * and looked-up details (cover, release date) applied. Returns the same object
 * until any of those change, so it is safe to use as a hook dependency.
 */
export function resolveGame(
  id: string,
  customGames: Record<string, Game>,
  overrides: State['genreOverrides'],
  details: State['details'] = {},
): Game | undefined {
  const base = customGames[id] ?? useStore.getState().suggested.games[id];
  if (!base) return undefined;
  const override = overrides[id];
  const detail = details[id];
  if (!override && !detail) return base;
  const cached = resolved.get(base);
  if (cached && cached.override === override && cached.detail === detail) return cached.game;
  const game: Game = {
    ...base,
    ...(override && { genres: override.genres, subgenres: override.subgenres }),
    // The game's own image (e.g. from a PlayStation import) wins over a looked-up one.
    imageUrl: base.imageUrl ?? detail?.imageUrl,
    releaseDate: detail?.releaseDate ?? base.releaseDate,
    releaseLabel: detail?.checkedAt ? detail.releaseLabel : base.releaseLabel,
    comingSoon: detail?.checkedAt ? detail.comingSoon : base.comingSoon,
  };
  resolved.set(base, { override, detail, game });
  return game;
}

export function useGameResolver() {
  const customGames = useStore((s) => s.customGames);
  const overrides = useStore((s) => s.genreOverrides);
  const details = useStore((s) => s.details);
  return (id: string) => resolveGame(id, customGames, overrides, details);
}
