import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Small hand-rolled SVG charts for the simulator dashboard.
 * Specs: 2px lines, hairline recessive grid, bars <= 24px with 4px rounded data ends,
 * a legend for every multi-series chart, hover tooltips on every mark.
 */

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'] as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) {
    const pad = Math.abs(lo) || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

export const compact = (v: number) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return `${+v.toFixed(Math.abs(v) < 10 && v % 1 ? 1 : 0)}`;
};

export const signed = (v: number, digits = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits);

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; band?: boolean }[] }) {
  return (
    <div className="viz-legend">
      {items.map((it, index) => (
        <span key={index} className="viz-legend-item">
          {it.band ? (
            <span className="viz-key-band" style={{ background: it.color }} />
          ) : (
            <svg width="18" height="8" aria-hidden>
              <line x1="1" y1="4" x2="17" y2="4" stroke={it.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={it.dashed ? '3 3' : undefined} />
            </svg>
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = x > width - 190 ? x - 12 : x + 12;
  return (
    <div className="viz-tip" style={{ left, top: y, transform: x > width - 190 ? 'translate(-100%, -50%)' : 'translate(0, -50%)' }}>
      {children}
    </div>
  );
}

export interface LineSeries {
  label: string;
  color: string;
  dashed?: boolean;
  /** [x, y] points, x ascending. */
  points: [number, number][];
}

export function LineChart({
  series,
  band,
  height = 240,
  formatX = compact,
  formatY = compact,
  xTitle,
  tooltipTitle,
  sortTooltip = false,
}: {
  series: LineSeries[];
  /** List tooltip rows from highest to lowest value. */
  sortTooltip?: boolean;
  /** Shaded range, [x, lo, hi]. */
  band?: { label: string; color: string; points: [number, number, number][] };
  height?: number;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  xTitle: string;
  tooltipTitle?: (x: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 52, r: 16, t: 10, b: 34 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = [...series.flatMap((s) => s.points.map((p) => p[1])), ...(band?.points.flatMap((p) => [p[1], p[2]]) ?? []), 0].filter(Number.isFinite);
  if (!xs.length) return <div ref={ref} className="viz-empty" style={{ height }} />;
  const x0 = Math.min(0, ...xs);
  const x1 = Math.max(...xs);
  const yt = niceTicks(Math.min(...ys), Math.max(...ys), 5);
  const y0 = yt[0];
  const y1 = yt[yt.length - 1];
  const sx = (v: number) => m.l + ((v - x0) / Math.max(1e-9, x1 - x0)) * iw;
  const sy = (v: number) => m.t + ih - ((v - y0) / Math.max(1e-9, y1 - y0)) * ih;
  const xt = niceTicks(x0, x1, Math.max(2, Math.floor(iw / 90))).filter((v) => v >= x0 && v <= x1);
  const path = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
  const bandPath = band
    ? band.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[2]).toFixed(1)}`).join('') +
      [...band.points].reverse().map((p) => `L${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('') +
      'Z'
    : '';
  const ref0 = series[0].points;
  const nearest = (px: number) => {
    const xv = x0 + ((px - m.l) / iw) * (x1 - x0);
    let lo = 0;
    let hi = ref0.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ref0[mid][0] < xv) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(ref0[lo - 1][0] - xv) < Math.abs(ref0[lo][0] - xv)) lo--;
    return lo;
  };
  const hx = hover !== null ? ref0[hover]?.[0] : null;
  // Labels can repeat. Keep each row keyed to its original series slot when sorting by value.
  const hoverRows = hover === null ? [] : series.flatMap((s, index) => {
    const point = s.points[hover];
    return point ? [{ series: s, index, point }] : [];
  });
  const tooltipRows = sortTooltip ? [...hoverRows].sort((a, b) => b.point[1] - a.point[1]) : hoverRows;
  return (
    <div ref={ref} className="viz" style={{ height }}>
      <svg
        width={width}
        height={height}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - r.left;
          setHover(px >= m.l && px <= width - m.r ? nearest(px) : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {yt.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={width - m.r} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'viz-zero' : 'viz-grid'} />
            <text x={m.l - 8} y={sy(v)} className="viz-tick" textAnchor="end" dominantBaseline="middle">
              {formatY(v)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={v} x={sx(v)} y={height - m.b + 16} className="viz-tick" textAnchor="middle">
            {formatX(v)}
          </text>
        ))}
        <text x={m.l + iw / 2} y={height - 3} className="viz-axis-title" textAnchor="middle">
          {xTitle}
        </text>
        {band && <path d={bandPath} fill={band.color} opacity={0.14} />}
        {series.map((s, index) => (
          <path key={index} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
        ))}
        {series.map((s, index) => {
          const p = s.points[s.points.length - 1];
          return p ? <circle key={index} cx={sx(p[0])} cy={sy(p[1])} r={4} fill={s.color} stroke="#f6edd9" strokeWidth={2} /> : null;
        })}
        {hx !== null && hx !== undefined && (
          <>
            <line x1={sx(hx)} x2={sx(hx)} y1={m.t} y2={m.t + ih} className="viz-cross" />
            {hoverRows.map(({ series: s, index, point }) => (
              <circle key={index} cx={sx(point[0])} cy={sy(point[1])} r={4.5} fill={s.color} stroke="#f6edd9" strokeWidth={2} />
            ))}
          </>
        )}
      </svg>
      {hx !== null && hx !== undefined && (
        <Tooltip x={sx(hx)} y={m.t + ih / 2} width={width}>
          <div className="viz-tip-title">{tooltipTitle ? tooltipTitle(hx) : formatX(hx)}</div>
          {tooltipRows.map(({ series: s, index, point }) => (
            <div key={index} className="viz-tip-row">
              <span className="viz-swatch" style={{ background: s.color }} />
              <span>{s.label}</span>
              <b>{formatY(point[1])}</b>
            </div>
          ))}
          {band && band.points[hover!] && (
            <div className="viz-tip-row muted">
              <span className="viz-swatch" style={{ background: band.color, opacity: 0.35 }} />
              <span>{band.label}</span>
              <b>
                {formatY(band.points[hover!][1])} … {formatY(band.points[hover!][2])}
              </b>
            </div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

/** Grouped vertical bars around a zero baseline (values may be negative). */
export function GroupedBars({
  categories,
  series,
  height = 230,
  formatY = (v: number) => signed(v, 0),
  unit,
}: {
  categories: string[];
  series: { label: string; color: string; values: number[] }[];
  height?: number;
  formatY?: (v: number) => string;
  unit: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ c: number; s: number } | null>(null);
  const m = { l: 52, r: 12, t: 12, b: 28 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const vals = series.flatMap((s) => s.values).filter(Number.isFinite);
  const yt = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 5);
  const y0 = yt[0];
  const y1 = yt[yt.length - 1];
  const sy = (v: number) => m.t + ih - ((v - y0) / Math.max(1e-9, y1 - y0)) * ih;
  const band = iw / categories.length;
  const barW = Math.min(24, (band * 0.7) / series.length - 2);
  const groupW = series.length * barW + (series.length - 1) * 2;
  const zero = sy(0);
  const barPath = (x: number, v: number) => {
    const y = sy(v);
    const h = Math.abs(zero - y);
    const r = Math.min(4, h, barW / 2);
    if (h < 0.5) return `M${x},${zero}h${barW}`;
    return v >= 0
      ? `M${x},${zero}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${zero}Z`
      : `M${x},${zero}V${y - r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y - r}V${zero}Z`;
  };
  const tip = hover ? series[hover.s] : null;
  return (
    <div ref={ref} className="viz" style={{ height }} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height}>
        {yt.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={width - m.r} y1={sy(v)} y2={sy(v)} className={v === 0 ? 'viz-zero' : 'viz-grid'} />
            <text x={m.l - 8} y={sy(v)} className="viz-tick" textAnchor="end" dominantBaseline="middle">
              {formatY(v)}
            </text>
          </g>
        ))}
        {categories.map((c, ci) => {
          const gx = m.l + band * ci + (band - groupW) / 2;
          return (
            <g key={c}>
              <text x={m.l + band * ci + band / 2} y={height - m.b + 18} className="viz-tick viz-cat" textAnchor="middle">
                {c}
              </text>
              {series.map((s, si) => {
                const x = gx + si * (barW + 2);
                return (
                  <g key={s.label} onMouseEnter={() => setHover({ c: ci, s: si })}>
                    <rect x={x - 3} y={m.t} width={barW + 6} height={ih} fill="transparent" />
                    <path d={barPath(x, s.values[ci])} fill={s.color} opacity={hover && (hover.c !== ci || hover.s !== si) ? 0.55 : 1} />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover && tip && (
        <Tooltip x={m.l + band * hover.c + band / 2} y={Math.min(sy(tip.values[hover.c]), zero) + 10} width={width}>
          <div className="viz-tip-title">{categories[hover.c]}</div>
          <div className="viz-tip-row">
            <span className="viz-swatch" style={{ background: tip.color }} />
            <span>{tip.label}</span>
            <b>
              {formatY(tip.values[hover.c])} {unit}
            </b>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

/** Ordinal passive → aggressive ramp (fold is a neutral, not part of the ramp). */
export const ACTION_COLORS = ['#c9bfae', '#6da7ec', '#2a78d6', '#1c5cab', '#0d366b'];
export const ACTION_LABELS = ['Fold', 'Check', 'Call', 'Bet', 'Raise'];

/** 100% stacked horizontal bars, one per row. */
export function StackedRows({ rows }: { rows: { group?: string; label: string; swatch: string; counts: number[] }[] }) {
  const [hover, setHover] = useState<{ r: number; k: number } | null>(null);
  return (
    <div className="stack-rows" onMouseLeave={() => setHover(null)}>
      {rows.map((row, ri) => {
        const total = row.counts.reduce((a, b) => a + b, 0) || 1;
        return (
          <div key={`${row.group}-${row.label}`} className={`stack-row ${row.group ? 'first' : ''}`}>
            <span className="stack-group">{row.group ?? ''}</span>
            <span className="stack-label">
              <span className="viz-swatch" style={{ background: row.swatch }} />
              {row.label}
            </span>
            <div className="stack-bar">
              {row.counts.map((c, k) =>
                c > 0 ? (
                  <div
                    key={k}
                    className="stack-seg"
                    style={{ flexGrow: c / total, background: ACTION_COLORS[k], color: k >= 2 ? '#fff' : '#231a13' }}
                    onMouseEnter={() => setHover({ r: ri, k })}
                  >
                    {c / total >= 0.09 ? `${Math.round((100 * c) / total)}%` : ''}
                    {hover?.r === ri && hover.k === k && (
                      <div className="viz-tip stack-tip">
                        <div className="viz-tip-title">
                          {row.label} · {row.group ?? rows.slice(0, ri + 1).reverse().find((r) => r.group)?.group}
                        </div>
                        <div className="viz-tip-row">
                          <span className="viz-swatch" style={{ background: ACTION_COLORS[k] }} />
                          <span>{ACTION_LABELS[k]}</span>
                          <b>{((100 * c) / total).toFixed(1)}%</b>
                        </div>
                        <div className="viz-tip-row muted">
                          <span />
                          <span>actions</span>
                          <b>{c.toLocaleString()}</b>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null,
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
