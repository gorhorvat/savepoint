// Streaming: who's live in a game, your Twitch sign-in, Kick
// channels, and the games your favourite streamers play (they feed Play next
// and More like this). See server/streaming.mjs.
import { useEffect } from 'react';
import type { Game, StreamChannel, StreamTaste, WatchedGame } from '../types';
import { useStore } from './store';

export type StreamService = 'twitch' | 'kick';

export const SERVICE_NAME: Record<StreamService, string> = { twitch: 'Twitch', kick: 'Kick' };

export interface LiveStream {
  platform: StreamService;
  channel: string;
  title: string;
  viewers?: number;
  language?: string;
  thumbnail?: string;
  avatar?: string;
  startedAt?: string;
  /** For followed channels: what they're playing. */
  game?: string;
  url: string;
}

/** Top live streams per service; null = that service isn't set up or didn't answer. */
export type GameStreams = Record<StreamService, LiveStream[] | null>;

export interface StreamingStatus {
  configured: { twitch: boolean; kick: boolean };
  twitch: { account: string } | null;
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

const streamCache = new Map<string, { at: number; promise: Promise<GameStreams> }>();

/** Top 5 live streams on each service for a game; kept for two minutes. */
export function fetchGameStreams(game: Pick<Game, 'title'> & { igdbId?: number }): Promise<GameStreams> {
  const qs = new URLSearchParams({ title: game.title });
  if (game.igdbId) qs.set('igdbId', String(game.igdbId));
  const key = qs.toString();
  const hit = streamCache.get(key);
  if (hit && hit.at > Date.now() - 120_000) return hit.promise;
  const promise = call<GameStreams>(`/api/streams?${key}`);
  promise.catch(() => streamCache.delete(key));
  streamCache.set(key, { at: Date.now(), promise });
  return promise;
}

export const fetchStreamingStatus = () => call<StreamingStatus>('/api/streaming');
export const disconnectStreaming = (service: 'twitch') => call(`/api/streaming/${service}`, 'DELETE');
export const fetchFollowedLive = (kick: string[]) => call<{ live: LiveStream[] }>('/api/streaming/live', 'POST', { kick });
const fetchTaste = (kick: string[]) =>
  call<{ games: WatchedGame[]; channels: StreamTaste['channels'] }>('/api/streaming/taste', 'POST', { kick });

/** Where the sign-in buttons go. */
export const signInUrl = (service: 'twitch') => `/api/auth/${service}/start`;

/** "kick.com/xqc", "https://kick.com/xQc/videos" or "xqc" -> "xqc"; empty when it isn't a channel. */
export function normalizeKickChannel(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^(www\.)?kick\.com\//, '')
    .split(/[/?#\s]/)[0];
  return /^[\w-]{2,40}$/.test(slug) ? slug : '';
}

const TASTE_TTL = 12 * 3600 * 1000;
let inFlight: Promise<void> | null = null;

/** Works out (again) the games your streamers play. `connections` names what changed. */
export async function refreshStreamTaste(connections: string) {
  if (inFlight) return inFlight;
  const kick = useStore.getState().kickChannels;
  const key = `${connections}|${kick.join(',')}`;
  inFlight = fetchTaste(kick)
    .then((t) => useStore.getState().setStreamTaste({ ...t, key, fetchedAt: new Date().toISOString() }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Keeps the streaming taste fresh: worked out again twice a day, and whenever
 * a sign-in or the Kick list changes. Background work, so failures stay quiet.
 */
export function useStreamTasteSync() {
  const kick = useStore((s) => s.kickChannels);
  const taste = useStore((s) => s.streamTaste);
  useEffect(() => {
    let cancelled = false;
    fetchStreamingStatus()
      .then((s) => {
        if (cancelled) return;
        const connections = s.twitch ? `t:${s.twitch.account}` : '';
        const key = `${connections}|${kick.join(',')}`;
        // Nothing connected and nothing typed in: nothing to learn from.
        if (!connections && !kick.length) {
          if (taste) useStore.getState().setStreamTaste(null);
          return;
        }
        const stale = !taste || taste.key !== key || Date.now() - new Date(taste.fetchedAt).getTime() > TASTE_TTL;
        if (stale) void refreshStreamTaste(connections).catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Checked when the Kick list changes and on load; the taste itself isn't a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kick]);
}

/** Your streamers' games with real genres, for matching. */
export const watchedForTaste = (taste: StreamTaste | null): WatchedGame[] =>
  (taste?.games ?? []).filter((g) => g.genres.length + g.subgenres.length > 0);

export const allChannels = (taste: StreamTaste | null): (StreamChannel & { service: StreamService })[] =>
  taste
    ? (['twitch', 'kick'] as const).flatMap((service) => taste.channels[service].map((c) => ({ ...c, service })))
    : [];
