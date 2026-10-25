import type { Game } from '../types';

// Edition and platform suffixes that stores tack onto titles.
const NOISE = [
  /\b(game of the year|goty|complete|definitive|deluxe|ultimate|standard|digital|director'?s cut|remastered|enhanced|anniversary|royal edition)\b( edition)?/g,
  // Platform suffixes before the bare word "edition": otherwise "Red Dead
  // Redemption: Nintendo Switch 2 Edition" loses "edition" first and ends up
  // as "red dead redemption 2". Longest first, so "ps4 and ps5" goes whole.
  /\b(ps4\s+and\s+ps5|playstation ?[345]|ps[345]|for nintendo switch|nintendo switch 2 edition|nintendo switch)\b/g,
  /\bedition\b/g,
];

export function normalizeTitle(title: string): string {
  let t = title
    .toLowerCase()
    // Before NFKD, which would turn ™ into the letters "tm".
    .replace(/[™®©]/g, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '');
  for (const re of NOISE) t = t.replace(re, ' ');
  return t.replace(/[^a-z0-9]+/g, ' ').trim();
}

// Further words that only name a version of a game you might already own.
// Used to hide owned games from suggestions, never for matching imports.
const VERSION_NOISE = [
  /\b(gold|special|cloud|hd|windows|steam|pc)( (edition|version|remaster|remastered))?\b/g,
  /\b(remaster|version|edition)\b/g,
  // Resident Evil 7 is "Resident Evil 7 biohazard"; the series is "Biohazard" in Japan.
  /\bbiohazard\b/g,
  /\bnintendo switch 2\b|\bswitch 2\b/g,
];

const ROMAN: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
  xiii: '13',
  xiv: '14',
  xv: '15',
  xvi: '16',
};

/**
 * A title boiled down to the game itself, so every version of something you
 * own looks the same: "Resident Evil 7 biohazard", "RESIDENT EVIL 7 Gold
 * Edition" and "Resident Evil VII Cloud Version" all become "resident evil 7".
 */
export function ownedKey(title: string): string {
  let t = normalizeTitle(title);
  for (const re of VERSION_NOISE) t = t.replace(re, ' ');
  return t
    .split(/\s+/)
    .map((w) => ROMAN[w] ?? w)
    .join(' ')
    .replace(/ (19|20)\d\d$/, '') // "FINAL FANTASY VII (2013)"
    .replace(/\s+/g, ' ')
    .trim();
}

const ROMAN_VALUE: Record<string, number> = { i: 1, v: 5, x: 10 };
const toNumber = (w: string) =>
  /^\d+$/.test(w)
    ? Number(w)
    : /^[ivx]+$/.test(w)
      ? [...w].reduce((n, c, i, a) => {
          const v = ROMAN_VALUE[c];
          return ROMAN_VALUE[a[i + 1]] > v ? n - v : n + v;
        }, 0)
      : NaN;

/**
 * Every game an owned title stands for, as ownedKey()s. Bundles and combined
 * releases count as each game in them: "FINAL FANTASY I-VI Bundle" owns
 * Final Fantasy 1 to 6, and "FINAL FANTASY X/X-2 HD Remaster" owns X and X-2.
 */
export function ownedKeys(title: string): string[] {
  const keys = new Set([ownedKey(title)]);
  const t = title.replace(/[™®©]/g, '').normalize('NFKD');

  // "Name I-VI …" or "Name 1-3 …": a numbered range.
  const range = t.match(/^(.*?\S)\s+([IVX]+|\d+)\s*[-–]\s*([IVX]+|\d+)\b/i);
  if (range) {
    const [, name, from, to] = range;
    const a = toNumber(from.toLowerCase());
    const b = toNumber(to.toLowerCase());
    if (a >= 1 && b > a && b - a <= 15)
      for (let n = a; n <= b; n++) {
        keys.add(ownedKey(`${name} ${n}`));
        if (n === 1) keys.add(ownedKey(name)); // The first game usually has no number.
      }
  }

  // "Name X/X-2": the parts after a slash share the name before the first part.
  if (t.includes('/')) {
    const [first, ...rest] = t.split('/');
    const words = first.trim().split(/\s+/);
    const name = words.slice(0, -1).join(' ');
    keys.add(ownedKey(first));
    for (const part of rest) keys.add(ownedKey(`${name} ${part.trim()}`));
  }
  return [...keys];
}

export const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/['’:]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Finds the saved game an import or search result belongs to, among games
 * that came from the old built-in catalog (their ids have no "x-" prefix).
 * Those were matched by Steam app id or title before, so re-syncing keeps
 * using their ids and their ratings, progress and history stay attached.
 */
export function legacyMatcher(customGames: Record<string, Game>) {
  const legacy = Object.values(customGames).filter((g) => !g.id.startsWith('x-'));
  const byNorm = new Map(legacy.map((g) => [normalizeTitle(g.title), g]));
  const bySteam = new Map(legacy.filter((g) => g.steamAppId).map((g) => [g.steamAppId!, g]));
  return (name: string, steamAppId?: number): Game | undefined => {
    if (steamAppId && bySteam.has(steamAppId)) return bySteam.get(steamAppId);
    // Exact match after stripping edition/platform noise. Looser prefix matching
    // would merge sequels and spin-offs ("Elden Ring Nightreign"), which is worse
    // than leaving a game unmatched.
    return byNorm.get(normalizeTitle(name));
  };
}
