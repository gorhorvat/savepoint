import { CATALOG } from '../data/catalog';
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

const byNorm = new Map(CATALOG.map((g) => [normalizeTitle(g.title), g]));
const bySteam = new Map(CATALOG.filter((g) => g.steamAppId).map((g) => [g.steamAppId!, g]));

export function findCatalogMatch(name: string, steamAppId?: number): Game | undefined {
  if (steamAppId && bySteam.has(steamAppId)) return bySteam.get(steamAppId);
  // Exact match after stripping edition/platform noise. Looser prefix matching
  // would merge sequels and spin-offs ("Elden Ring Nightreign"), which is worse
  // than leaving a game unmatched.
  return byNorm.get(normalizeTitle(name));
}
