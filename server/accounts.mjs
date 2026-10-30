// Accounts and app settings: shared by the server and `npm run setup-account`.
import { randomInt } from 'node:crypto';
import { query } from './db.mjs';

export const ROLES = { superAdmin: 'superadmin', user: 'user' };

const USERNAME = /^[\w.-]{2,40}$/;

/**
 * A typed username as it's checked and stored: trimmed, without invisible
 * characters (zero-width spaces and the like that copy-paste or autofill can add).
 */
export function tidyUsername(raw) {
  return typeof raw === 'string'
    ? raw
        .normalize('NFC')
        .replace(/[\p{Cf}]/gu, '')
        .trim()
    : '';
}

/** How a character reads in an error message. */
function describe(ch) {
  if (ch === ' ') return '" " (a space)';
  if (/\s/u.test(ch)) return 'a space-like character';
  if (/\p{Extended_Pictographic}/u.test(ch)) return `"${ch}" (an emoji)`;
  if (/[čćđšžČĆĐŠŽ]/.test(ch))
    return `"${ch}" (use ${ch.normalize('NFD')[0].replace('đ', 'd').replace('Đ', 'D')} instead)`;
  const code = ch.codePointAt(0);
  if (code < 32 || /\p{C}/u.test(ch))
    return `an invisible character (U+${code.toString(16).toUpperCase().padStart(4, '0')})`;
  return `"${ch}"`;
}

/** Why a username isn't acceptable, or null. Says which character is the problem. */
export function usernameProblem(username) {
  if (typeof username !== 'string') return 'Pick a username.';
  if (username.includes('@')) return 'Pick a username, not your email address: like mhorvat or marko_h.';
  const bad = [...new Set([...username].filter((ch) => !/[\w.-]/.test(ch)))];
  if (bad.length) {
    const list = bad.slice(0, 3).map(describe);
    const what = list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : list[0];
    return `Usernames can't contain ${what}. Use letters without accents, digits, dots, dashes or underscores.`;
  }
  if (username.length < 2) return 'A username needs at least 2 characters.';
  if (username.length > 40) return 'A username can have at most 40 characters.';
  return USERNAME.test(username)
    ? null
    : 'For a username, use letters without accents, digits, dots, dashes or underscores.';
}

export class UsernameTaken extends Error {}

/**
 * Inserts a user and returns { id, username, role }. Throws UsernameTaken.
 * passwordHash is null for an account that logs in through Steam only.
 */
export async function createAccount(username, passwordHash, role = ROLES.user, steamId = null) {
  try {
    const { rows } = await query(
      'INSERT INTO users ("username", "password_hash", "role", "steam_id") VALUES ($1, $2, $3, $4) RETURNING "id", "username", "role"',
      [username, passwordHash, role, steamId],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505' && /username/.test(err.constraint ?? '')) {
      throw new UsernameTaken(`The username "${username}" is taken.`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------- invite code

/** The invite code for sign-up, or '' when sign-up is closed. */
export async function getInviteCode() {
  const { rows } = await query('SELECT "value" FROM app_settings WHERE "key" = \'invite_code\'');
  return rows[0]?.value ?? '';
}

/** Sets the invite code; an empty one closes sign-up. */
export async function setInviteCode(code) {
  if (!code) {
    await query('DELETE FROM app_settings WHERE "key" = \'invite_code\'');
    return;
  }
  await query(
    'INSERT INTO app_settings ("key", "value") VALUES (\'invite_code\', $1) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"',
    [code],
  );
}

/** Why an invite code isn't acceptable, or null. */
export function inviteCodeProblem(code) {
  if (typeof code !== 'string' || code.trim().length < 6) return 'Use at least 6 characters.';
  if (code.length > 60) return 'Use at most 60 characters.';
  return null;
}

// No 0/O or 1/I/L, so a code read out loud or typed from a phone can't be misread.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A random code like "K7QM-4XTD-P9WA". */
export function randomInviteCode() {
  const group = () => Array.from({ length: 4 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
  return [group(), group(), group()].join('-');
}
