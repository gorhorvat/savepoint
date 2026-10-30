// Messages between friends (server/messages.mjs): one to one, text and game
// cards, "Seen" receipts. The app polls for new messages.
import type { Game } from '../types';

/** Fired when messages are read or sent, so the header badge updates at once. */
export const MESSAGES_CHANGED = 'savepoint:messages-changed';

/** A game shared in a chat: enough to show it and wishlist it. */
export interface SharedGame {
  title: string;
  imageUrl?: string;
  steamAppId?: number;
  nsuid?: string;
  availableOn: Game['availableOn'];
  genres: string[];
  subgenres: string[];
  tags: string[];
  developer?: string;
  year?: number;
  releaseDate?: string;
  /** The sender's match % for it, when it came from their suggestions. */
  fit?: number;
}

export interface Message {
  id: number;
  /** Sent by you. */
  mine: boolean;
  body: string;
  game: SharedGame | null;
  at: string;
  readAt: string | null;
}

export interface ChatPerson {
  id: number;
  username: string;
  avatar: string | null;
}

export interface Conversation {
  friend: ChatPerson;
  last: Message;
  unread: number;
  canWrite: boolean;
}

export interface Chat {
  friend: ChatPerson;
  canWrite: boolean;
  messages: Message[];
  more: boolean;
  seenUpTo: number | null;
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
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Failed (${r.status}).`);
  return data as T;
}

export async function fetchConversations(): Promise<Conversation[]> {
  return (await call<{ conversations: Conversation[] }>('/api/messages')).conversations;
}

export async function fetchUnread(): Promise<number> {
  return (await call<{ unread: number }>('/api/messages/unread')).unread;
}

export function fetchChat(friendId: number, opts: { after?: number; before?: number } = {}): Promise<Chat> {
  const qs = new URLSearchParams();
  if (opts.after) qs.set('after', String(opts.after));
  if (opts.before) qs.set('before', String(opts.before));
  return call(`/api/messages/${friendId}${qs.size ? `?${qs}` : ''}`);
}

export async function sendMessage(friendId: number, body: string, game?: SharedGame): Promise<Message> {
  const m = await call<Message>(`/api/messages/${friendId}`, 'POST', { body, game });
  window.dispatchEvent(new Event(MESSAGES_CHANGED));
  return m;
}

/** A game as a card to share. */
export function shareable(game: Game, fit?: number): SharedGame {
  return {
    title: game.title,
    imageUrl: game.imageUrl,
    steamAppId: game.steamAppId,
    nsuid: game.nsuid,
    availableOn: game.availableOn,
    genres: game.genres,
    subgenres: game.subgenres,
    tags: game.tags.slice(0, 20),
    developer: game.developer,
    year: game.year,
    releaseDate: game.releaseDate,
    fit,
  };
}
