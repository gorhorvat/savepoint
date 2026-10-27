import { Group, Text, Tooltip } from '@mantine/core';
import { IconBrandXbox, IconDeviceNintendo } from '@tabler/icons-react';
import { siEpicgames, siPlaystation, siSteam } from 'simple-icons';
import { PLATFORM_BY_ID } from '../data/platforms';
import type { PlatformId } from '../types';

// Brand logos from simple-icons. Nintendo and Microsoft had theirs removed from
// that set, so Switch uses a console icon and Xbox Tabler's Xbox icon.
const LOGOS: Partial<Record<PlatformId, { path: string }>> = {
  steam: siSteam,
  epic: siEpicgames,
  playstation: siPlaystation,
};

/** A platform's logo in its data colour. Pass `label` to announce it to screen readers. */
export function PlatformIcon({
  platform,
  size = 16,
  label,
  color,
}: {
  platform: PlatformId;
  size?: number;
  label?: boolean;
  color?: string;
}) {
  const fill = color ?? PLATFORM_BY_ID[platform].colorVar;
  const a11y = label ? { role: 'img', 'aria-label': PLATFORM_BY_ID[platform].name } : { 'aria-hidden': true };
  const logo = LOGOS[platform];
  if (platform === 'xbox') {
    return <IconBrandXbox size={size + 2} stroke={1.8} color={fill} style={{ flexShrink: 0 }} {...a11y} />;
  }
  if (!logo) {
    return <IconDeviceNintendo size={size + 2} stroke={1.8} color={fill} style={{ flexShrink: 0 }} {...a11y} />;
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} style={{ flexShrink: 0 }} {...a11y}>
      <path d={logo.path} />
    </svg>
  );
}

/** Logo with the platform name as a tooltip. */
export function PlatformLogo({ platform, size = 16 }: { platform: PlatformId; size?: number }) {
  return (
    <Tooltip label={PLATFORM_BY_ID[platform].name} withArrow>
      <span style={{ display: 'inline-flex', lineHeight: 0 }}>
        <PlatformIcon platform={platform} size={size} label />
      </span>
    </Tooltip>
  );
}

/** Logo plus optional extra text (e.g. hours or "Switch 2"). */
export function PlatformLabel({
  platform,
  size = 'sm',
  children,
}: {
  platform: PlatformId;
  short?: boolean;
  size?: 'xs' | 'sm' | 'md';
  children?: React.ReactNode;
}) {
  return (
    <Group gap={6} wrap="nowrap" component="span" style={{ display: 'inline-flex' }}>
      <PlatformLogo platform={platform} size={size === 'xs' ? 14 : 17} />
      {children && (
        <Text span size={size}>
          {children}
        </Text>
      )}
    </Group>
  );
}

/** Row of platform logos; Switch shows "2" when only the Switch 2 version exists. */
export function PlatformList({
  platforms,
  switchVersions,
  size = 16,
}: {
  platforms: PlatformId[];
  short?: boolean;
  switchVersions?: string[];
  size?: number;
}) {
  return (
    <Group gap={10} wrap="wrap" align="center">
      {platforms.map((p) =>
        p === 'switch' && switchVersions?.includes('Switch 2') ? (
          <Tooltip
            key={p}
            label={switchVersions.includes('Switch') ? 'Nintendo Switch and Switch 2' : 'Nintendo Switch 2'}
            withArrow
          >
            <Group
              gap={2}
              wrap="nowrap"
              component="span"
              style={{ display: 'inline-flex' }}
              aria-label="Nintendo Switch 2"
            >
              <PlatformIcon platform="switch" size={size} />
              <Text span size="xs" fw={700} c="var(--sp-switch)">
                {switchVersions.includes('Switch') ? '1+2' : '2'}
              </Text>
            </Group>
          </Tooltip>
        ) : (
          <PlatformLogo key={p} platform={p} size={size} />
        ),
      )}
    </Group>
  );
}
