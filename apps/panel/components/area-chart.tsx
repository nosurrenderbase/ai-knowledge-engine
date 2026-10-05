'use client';

import {Tooltip} from 'antd';
import {useId} from 'react';

export interface Point {
  label: string;
  value: number;
  /** Days with errors get a small orange marker. */
  errors?: number;
}

const W = 1000;

/** Smooth path through the points (cardinal-like, clamped so it never dips below zero). */
function smooth(pts: [number, number][], h: number): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = Math.min(h, y1 + (y2 - y0) / 6);
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = Math.min(h, y2 - (y3 - y1) / 6);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
  }
  return d;
}

/** Calls over time: a soft area with a drawn-in line; hover a day for its number. */
export function AreaChart({points, height = 180, unit = 'çağrı'}: {points: Point[]; height?: number; unit?: string}) {
  const id = useId().replace(/:/g, '');
  const max = Math.max(1, ...points.map(p => p.value));
  const H = 100;
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const xy = points.map((p, i): [number, number] => [i * step, H - (p.value / max) * (H - 8) - 2]);
  const line = smooth(xy, H);
  const area = line ? `${line} L${W},${H} L0,${H} Z` : '';
  return (
    <div style={{position: 'relative', height}}>
      {/* Revealed left to right with a clip, not a stroke dash: dashes and non-scaling strokes
          disagree on a stretched SVG and the line stopped half way on wide screens. */}
      <svg className="kb-chart-reveal" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%" style={{display: 'block', overflow: 'visible'}}>
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a84ff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0a84ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(15,23,42,0.06)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill={`url(#fill-${id})`} />
        <path d={line} fill="none" stroke="#0a84ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Hover targets and markers, in HTML so they keep their shape on any width. */}
      <div style={{position: 'absolute', inset: 0, display: 'flex'}}>
        {points.map((p, i) => (
          <Tooltip key={p.label} title={`${p.label} · ${p.value} ${unit}${p.errors ? ` · ${p.errors} hata` : ''}`}>
            <div className="kb-area-col" style={{flex: 1, position: 'relative'}}>
              <span
                className="kb-area-dot"
                style={{
                  left: `${points.length > 1 ? (i / (points.length - 1)) * 100 : 50}%`,
                  top: `${(xy[i][1] / H) * 100}%`,
                  background: p.errors ? '#ff9f0a' : '#0a84ff',
                  opacity: p.errors ? 1 : undefined,
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
