import { Tooltip } from '@mantine/core';
import type { CSSProperties } from 'react';
import { RARITY } from './format';

/** Coins as gold, silver and copper. */
export function Coins({ copper }: { copper: number }) {
  const v = Math.round(copper);
  const g = Math.floor(v / 10000);
  const s = Math.floor((v % 10000) / 100);
  const c = v % 100;
  return (
    <span className="num">
      {g > 0 && <span style={{ color: '#e6b422' }}>{g.toLocaleString()}g </span>}
      {(g > 0 || s > 0) && <span style={{ color: '#a8a9ad' }}>{s}s </span>}
      {g === 0 && <span style={{ color: '#b87333' }}>{c}c</span>}
    </span>
  );
}

/** A game icon with its name on hover; an empty square when there is none. */
export function Img({
  src,
  name,
  size = 24,
  rarity,
  style,
}: {
  src: string | null | undefined;
  name?: string | null;
  size?: number;
  rarity?: string | null;
  style?: CSSProperties;
}) {
  const border = rarity && RARITY[rarity] ? `2px solid ${RARITY[rarity]}` : undefined;
  const img = src ? (
    <img
      src={src}
      alt={name ?? ''}
      width={size}
      height={size}
      loading="lazy"
      style={{ borderRadius: 4, flexShrink: 0, display: 'block', border, boxSizing: 'border-box', ...style }}
    />
  ) : (
    <div
      style={{ width: size, height: size, borderRadius: 4, background: 'var(--sp-raised)', flexShrink: 0, ...style }}
    />
  );
  return name ? <Tooltip label={name}>{img}</Tooltip> : img;
}
