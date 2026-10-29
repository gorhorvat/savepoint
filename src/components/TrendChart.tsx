import { Paper, Text } from '@mantine/core';
import { useEffect, useMemo, useRef, useState } from 'react';

// A single-series line, for the progress graphs in My Stats (over days) and
// in-match graphs (over minutes): 2px line, recessive grid, a marker on the
// last point, a zero line when values cross zero, and a crosshair with a
// tooltip on hover. The title outside names the series, so no legend.

export interface TrendPoint {
  /** A day (YYYY-MM-DD) or, with `minutes`, a minute number. */
  day: string | number;
  value: number;
}

const H = 180;
const PAD = { top: 14, right: 16, bottom: 26 };
const dayLabel = (d: string | number, year = false) =>
  typeof d === 'number'
    ? `${d} min`
    : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        ...(year ? { year: 'numeric' } : {}),
      });
const xOf = (d: string | number) => (typeof d === 'number' ? d : new Date(`${d}T12:00:00`).getTime());

/** Round tick values covering [min, max]. */
function ticks(min: number, max: number, count = 4) {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export function TrendChart({
  points,
  format = (v) => v.toLocaleString(),
  tickFormat,
  yTicks,
  empty = 'Not enough days yet. Savepoint saves a point each day you refresh.',
}: {
  points: TrendPoint[];
  format?: (v: number) => string;
  /** Labels on the y axis, when shorter than `format`. */
  tickFormat?: (v: number) => string;
  /** Fixed tick values (e.g. rank boundaries); otherwise round numbers. */
  yTicks?: number[];
  empty?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const t0 = xOf(points[0].day);
    const t1 = xOf(points[points.length - 1].day);
    const vals = points.map((p) => p.value);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    // Fixed ticks in range, thinned to about five; round numbers when fewer than two fit.
    let ys = (yTicks ?? []).filter((v) => v >= lo && v <= hi);
    if (ys.length > 6) ys = ys.filter((_, i) => i % Math.ceil(ys.length / 5) === 0);
    if (ys.length < 2) ys = ticks(lo, hi);
    const left = Math.max(40, Math.max(...ys.map((v) => (tickFormat ?? format)(v).length)) * 6.6 + 14);
    const x = (day: string | number) => left + ((xOf(day) - t0) / Math.max(1, t1 - t0)) * (w - left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const xy = points.map((p) => [x(p.day), y(p.value)] as const);
    const first = String(points[0].day);
    const zero = lo < 0 && hi > 0 ? y(0) : null;
    return {
      xy,
      ys,
      y,
      zero,
      left,
      spansYears: first.slice(0, 4) !== String(points[points.length - 1].day).slice(0, 4),
    };
  }, [points, w, yTicks, format, tickFormat]);

  if (!geo) {
    return (
      <Text size="sm" c="dimmed">
        {points.length === 1 ? `${format(points[0].value)} today. ${empty}` : empty}
      </Text>
    );
  }

  const { xy, ys, y, zero, left, spansYears } = geo;
  const path = xy.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const last = xy.length - 1;
  const xLabels = [0, Math.floor(last / 2), last].filter((v, i, a) => a.indexOf(v) === i);
  const h = hover ?? null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left + left;
    let best = 0;
    for (let i = 1; i < xy.length; i++) if (Math.abs(xy[i][0] - mx) < Math.abs(xy[best][0] - mx)) best = i;
    setHover(best);
  };

  return (
    <div ref={box} style={{ position: 'relative', width: '100%' }}>
      <svg
        width={w}
        height={H}
        role="img"
        aria-label="Progress over time"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {ys.map((v) => (
          <g key={v}>
            <line x1={left} x2={w - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--sp-line)" strokeWidth={1} />
            <text x={left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--sp-muted)">
              {(tickFormat ?? format)(v)}
            </text>
          </g>
        ))}
        {xLabels.map((i) => (
          <text
            key={i}
            x={xy[i][0]}
            y={H - 6}
            fontSize={11}
            fill="var(--sp-muted)"
            textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
          >
            {dayLabel(points[i].day, spansYears)}
          </text>
        ))}
        {zero != null && (
          <line x1={left} x2={w - PAD.right} y1={zero} y2={zero} stroke="var(--sp-muted)" strokeWidth={1} />
        )}
        <path
          d={path}
          fill="none"
          stroke="var(--mantine-primary-color-filled)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <circle
          cx={xy[last][0]}
          cy={xy[last][1]}
          r={4}
          fill="var(--mantine-primary-color-filled)"
          stroke="var(--sp-surface)"
          strokeWidth={2}
        />
        {h != null && (
          <>
            <line
              x1={xy[h][0]}
              x2={xy[h][0]}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--sp-muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={xy[h][0]}
              cy={xy[h][1]}
              r={5}
              fill="var(--mantine-primary-color-filled)"
              stroke="var(--sp-surface)"
              strokeWidth={2}
            />
          </>
        )}
        <rect
          x={left}
          y={0}
          width={Math.max(0, w - left - PAD.right)}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {h != null && (
        <Paper
          shadow="sm"
          px={8}
          py={4}
          withBorder
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            top: Math.max(0, xy[h][1] - 52),
            left: Math.min(Math.max(0, xy[h][0] - 60), w - 140),
            whiteSpace: 'nowrap',
          }}
        >
          <Text size="xs" c="dimmed">
            {dayLabel(points[h].day, true)}
          </Text>
          <Text size="sm" fw={600} className="num">
            {format(points[h].value)}
          </Text>
        </Paper>
      )}
    </div>
  );
}
