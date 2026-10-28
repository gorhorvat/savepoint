import { IconBrandXbox, IconDeviceDesktop, IconDeviceGamepad2, IconDisc } from '@tabler/icons-react';
import { CARTRIDGE_PLATFORMS, DIGITAL, platformFamily } from '../data/physical';
import type { PhysicalPlatform } from '../types';
import { PlatformIcon } from './PlatformBadge';

export function PhysicalPlatformIcon({ platform, size = 16 }: { platform: PhysicalPlatform; size?: number }) {
  const digital = DIGITAL[platform];
  if (digital && platform !== 'PC') return <PlatformIcon platform={digital} size={size} />;
  const family = platformFamily(platform);
  if (family === 'xbox') return <IconBrandXbox size={size} color="#107c10" />;
  if (family === 'playstation') return <PlatformIcon platform="playstation" size={size} />;
  if (platform === 'PC') return <IconDeviceDesktop size={size} stroke={1.8} />;
  if (CARTRIDGE_PLATFORMS.has(platform)) return <IconCartridge size={size} />;
  if (family === 'nintendo' || family === 'sega') return <IconDeviceGamepad2 size={size} stroke={1.8} />;
  return <IconDisc size={size} stroke={1.8} />;
}

/** Game card outline (like a Switch cartridge), drawn to match Tabler's line icons. */
export function IconCartridge({ size = 16, stroke = 1.8, color = 'currentColor' }: { size?: number; stroke?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z" />
      <path d="M9 6h6" />
      <path d="M8.5 10h7v7h-7z" />
    </svg>
  );
}

/** Cartridge for Switch copies, disc for everything else. */
export function PhysicalCopyIcon({ platform, size = 16, color }: { platform: PhysicalPlatform; size?: number; color?: string }) {
  return CARTRIDGE_PLATFORMS.has(platform) ? (
    <IconCartridge size={size} color={color} />
  ) : (
    <IconDisc size={size} stroke={1.8} color={color} style={{ flexShrink: 0 }} />
  );
}
