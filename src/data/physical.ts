import type { Condition, PhysicalPlatform, PlatformId } from '../types';

/** Platforms by maker, newest first; drives the grouped platform pickers. */
export const PHYSICAL_PLATFORM_GROUPS: { group: string; items: PhysicalPlatform[] }[] = [
  { group: 'PlayStation', items: ['PS5', 'PS4', 'PS3', 'PS2', 'PS1', 'PS Vita', 'PSP'] },
  {
    group: 'Nintendo',
    items: ['Switch 2', 'Switch', 'Wii U', 'Wii', 'GameCube', 'N64', 'SNES', 'NES', '3DS', 'DS', 'Game Boy Advance', 'Game Boy Color', 'Game Boy'],
  },
  { group: 'Xbox', items: ['Xbox Series X|S', 'Xbox One', 'Xbox 360', 'Xbox'] },
  { group: 'Sega', items: ['Dreamcast', 'Saturn', 'Mega Drive', 'Master System', 'Game Gear'] },
  { group: 'Other', items: ['PC', 'Other'] },
];

export const PHYSICAL_PLATFORMS: PhysicalPlatform[] = PHYSICAL_PLATFORM_GROUPS.flatMap((g) => g.items);

/** Cartridge-based platforms (drawn with a cartridge icon instead of a disc). */
export const CARTRIDGE_PLATFORMS = new Set<PhysicalPlatform>([
  'Switch 2',
  'Switch',
  'N64',
  'SNES',
  'NES',
  '3DS',
  'DS',
  'Game Boy Advance',
  'Game Boy Color',
  'Game Boy',
  'Mega Drive',
  'Master System',
  'Game Gear',
  'PS Vita',
]);

/** Brand family, for icons. */
export function platformFamily(p: PhysicalPlatform): 'playstation' | 'xbox' | 'nintendo' | 'sega' | 'pc' | 'other' {
  return (PHYSICAL_PLATFORM_GROUPS.find((g) => g.items.includes(p))?.group.toLowerCase() ?? 'other') as never;
}

export const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'Sealed', label: 'Sealed' },
  { value: 'Complete', label: 'Complete in box' },
  { value: 'Game only', label: 'Game only' },
];

/** Which digital platform a physical copy relates to, for icons and lookups. */
export const DIGITAL: Partial<Record<PhysicalPlatform, PlatformId>> = {
  PS5: 'playstation',
  PS4: 'playstation',
  'Switch 2': 'switch',
  Switch: 'switch',
  PC: 'steam',
  'Xbox Series X|S': 'xbox',
  'Xbox One': 'xbox',
};
