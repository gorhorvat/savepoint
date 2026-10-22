import { Tooltip } from '@mantine/core';
import { PLATFORM_BY_ID } from '../data/platforms';
import { formatPlaytime } from '../lib/format';
import type { PlatformId } from '../types';

interface Props {
  parts: { platform: PlatformId; minutes: number }[];
  height?: number;
  /** Scale the filled part against this many minutes (for comparing rows). */
  scaleTo?: number;
  hero?: boolean;
  withTooltips?: boolean;
}

/** Play time split by platform as one horizontal bar. */
export function TimeStrip({ parts, height = 8, scaleTo, hero, withTooltips = true }: Props) {
  const total = parts.reduce((n, p) => n + p.minutes, 0);
  const filled = scaleTo ? Math.max(0.02, Math.min(1, total / scaleTo)) : 1;
  const label = parts
    .filter((p) => p.minutes > 0)
    .map((p) => `${PLATFORM_BY_ID[p.platform].name} ${formatPlaytime(p.minutes)}`)
    .join(', ');

  return (
    <div className="strip-track" style={{ height }} role="img" aria-label={label}>
      <div className={`strip${hero ? ' strip-hero' : ''}`} style={{ height, width: `${filled * 100}%` }}>
        {parts
          .filter((p) => p.minutes > 0)
          .map((p) => {
            const seg = (
              <div
                key={p.platform}
                className="strip-seg"
                style={{ flexGrow: p.minutes, background: PLATFORM_BY_ID[p.platform].colorVar }}
              />
            );
            return withTooltips ? (
              <Tooltip
                key={p.platform}
                label={`${PLATFORM_BY_ID[p.platform].name}: ${formatPlaytime(p.minutes)}`}
                withArrow
              >
                {seg}
              </Tooltip>
            ) : (
              seg
            );
          })}
      </div>
    </div>
  );
}
