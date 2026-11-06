// Messages between friends (server/messages.mjs): one to one, text, game cards
// and pictures, "Seen" receipts. The app polls for new messages.
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

/** A picture in a message: where to load it from, and its size (to keep its space while it loads). */
export interface MessageImage {
  url: string;
  width: number;
  height: number;
}

/** A picture uploaded for a message that hasn't been sent yet. */
export interface UploadedImage {
  id: string;
  width: number;
  height: number;
}

export interface Message {
  id: number;
  /** Sent by you. */
  mine: boolean;
  body: string;
  game: SharedGame | null;
  image?: MessageImage | null;
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

/** The newest message you haven't read, for the "new message" pop-up. */
export interface UnreadLatest {
  id: number;
  from: ChatPerson;
  /** The start of the text, or the shared game's title. */
  preview: string;
}

/** Settings: how new messages announce themselves (stored with the account). */
export interface MessageAlerts {
  /** A pop-up inside Savepoint. */
  toast: boolean;
  /** A system notification while Savepoint is open in another tab or window. */
  browser: boolean;
}

export function messageAlerts(saved?: Partial<MessageAlerts>): MessageAlerts {
  return { toast: saved?.toast ?? true, browser: saved?.browser ?? false };
}

export function fetchChat(friendId: number, opts: { after?: number; before?: number } = {}): Promise<Chat> {
  const qs = new URLSearchParams();
  if (opts.after) qs.set('after', String(opts.after));
  if (opts.before) qs.set('before', String(opts.before));
  return call(`/api/messages/${friendId}${qs.size ? `?${qs}` : ''}`);
}

export async function sendMessage(
  friendId: number,
  body: string,
  game?: SharedGame,
  image?: UploadedImage,
): Promise<Message> {
  const m = await call<Message>(`/api/messages/${friendId}`, 'POST', { body, game, image: image?.id });
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

const LONGEST_SIDE = 1600;

/**
 * A picture made ready to send: turned the right way up, at most 1600 px on
 * its longest side, as WebP (or JPEG where the browser can't make WebP).
 */
export async function shrinkImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("That file isn't a picture Savepoint can open.");
  }
  const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
  // Browsers that can't make WebP quietly give back a PNG instead.
  let blob = await encode('image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.85);
  if (!blob) throw new Error("Couldn't prepare the picture. Try another one.");
  return { blob, width, height };
}

/** Shrinks a picture and uploads it, ready to be sent with a message. */
export async function uploadImage(file: Blob): Promise<UploadedImage> {
  const { blob, width, height } = await shrinkImage(file);
  let r: Response;
  try {
    r = await fetch(`/api/message-images?w=${width}&h=${height}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type },
      body: blob,
    });
  } catch {
    throw new Error("Can't reach the Savepoint server.");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Upload failed (${r.status}).`);
  return (data as { image: UploadedImage }).image;
}
