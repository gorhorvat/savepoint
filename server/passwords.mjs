// Password hashing with scrypt (built into Node). Stored as
// scrypt$N$r$p$salt$hash, so the cost can be raised later without breaking
// existing passwords.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
// Memory scrypt needs at this cost (128 * N * r), with room to spare.
const maxmem = 256 * COST.N * COST.r;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, { ...COST, maxmem });
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const cost = { N: Number(N), r: Number(r), p: Number(p) };
  const given = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
    ...cost,
    maxmem: 256 * cost.N * cost.r,
  });
  return timingSafeEqual(given, expected);
}

/** Used when the username doesn't exist, so a wrong name takes as long as a wrong password. */
let dummy = null;
export async function verifyAgainstNothing(password) {
  dummy ??= await hashPassword('not a real password');
  await verifyPassword(password, dummy);
  return false;
}

/** Why a new password isn't acceptable, or null. */
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return 'That password is too long.';
  return null;
}
