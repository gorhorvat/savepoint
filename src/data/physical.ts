import type { Condition, PhysicalPlatform, PlatformId } from '../types';

export const PHYSICAL_PLATFORMS: PhysicalPlatform[] = [
  'PS5',
  'PS4',
  'Switch 2',
  'Switch',
  'Xbox Series X|S',
  'Xbox One',
  'PC',
  'Other',
];

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
};
