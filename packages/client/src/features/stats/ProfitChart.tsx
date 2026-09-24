import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatChips, formatChipsShort, formatSigned } from '@poker/shared';
import type { ProfitPoint } from '../../app/api';
import { useElementWidth } from '../../app/hooks';
import { cx } from '../../ui';

/** Round tick step for a range: 1, 2 or 5 × 10^k. */
export function niceStep(range: number, target = 4): number {
  if (range <= 0) return 1;
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return Math.max(1, nice * mag);
}

/** Domain and ticks that always include zero. */
export function yScale(values: number[]): { lo: number; hi: number; ticks: number[] } {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const step = niceStep(max - min || 100);
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(lo + step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

const PLOT_H = 190;
const PAD = { l: 52, r: 62, t: 14, b: 26 };

/**
 * Cumulative net profit, one point per hand (hand 0 = where you started). A
 * single brass line over a faint wash to the zero line; a crosshair and
 * readout follow the pointer or the arrow keys.
 */
export function ProfitChart({ curve }: { curve: ProfitPoint[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const clipId = `pc-${useId().replace(/:/g, '')}`;
  const points = [{ hand: 0, total: 0, at: '' }, ...curve];
  const n = points.length;
  const last = points[n - 1];
  const { lo, hi, ticks } = yScale(points.map((p) => p.total));
  const w = Math.max(0, width);
  const plotW = Math.max(10, w - PAD.l - PAD.r);
  const x = (i: number) => PAD.l + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * PLOT_H;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join('');
  const area = `${line}L${x(n - 1).toFixed(1)} ${y(0).toFixed(1)}L${x(0).toFixed(1)} ${y(0).toFixed(1)}Z`;
  const peak = points.reduce((b, p, i) => (p.total > points[b].total ? i : b), 0);
  const trough = points.reduce((b, p, i) => (p.total < points[b].total ? i : b), 0);
  const summary = `Net profit over your last ${curve.length} ${curve.length === 1 ? 'hand' : 'hands'}: now ${formatSigned(last.total)} chips, peak ${formatSigned(points[peak].total)}, low ${formatSigned(points[trough].total)}.`;

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    setActive(Math.min(n - 1, Math.max(0, Math.round((px / box.width) * (n - 1)))));
  };
  const onKey = (e: KeyboardEvent) => {
    const cur = active ?? n - 1;
    const step = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - step);
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + step);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') setActive(null);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  const a = active !== null ? points[active] : null;
  const tipLeft = active !== null ? x(active) : 0;
  const flip = tipLeft > w - 150;
  // Only direct-label the peak/low when they're real extremes away from the end.
  const labelPeak = peak !== n - 1 && points[peak].total > 0;
  const labelTrough = trough !== n - 1 && points[trough].total < 0;

  return (
    <figure className="m-0">
      <div ref={ref} className="relative w-full" style={{ height: PLOT_H + PAD.t + PAD.b }}>
        {w > 0 && (
          <svg
            width={w}
            height={PLOT_H + PAD.t + PAD.b}
            role="img"
            aria-label={summary}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="block rounded-md outline-none focus-visible:outline-2 focus-visible:outline-focus"
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={PAD.l} y={PAD.t - 6} width={plotW} height={PLOT_H + 12} />
              </clipPath>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={PAD.l + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-stock/35' : 'stroke-walnut-600/70'} strokeWidth="1" shapeRendering="crispEdges" />
                <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-muted text-[12px]">
                  {t === 0 ? '0' : formatChipsShort(t)}
                </text>
              </g>
            ))}
            <text x={PAD.l} y={PLOT_H + PAD.t + 18} className="fill-muted text-[12px]">Start</text>
            <text x={PAD.l + plotW} y={PLOT_H + PAD.t + 18} textAnchor="end" className="tabular fill-muted text-[12px]">
              {`Hand ${n - 1}`}
            </text>
            <g clipPath={`url(#${clipId})`}>
              <path d={area} className="fill-brass/10" />
              <path d={line} fill="none" className="stroke-brass" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
            {labelPeak && (
              <text x={x(peak)} y={y(points[peak].total) - 9} textAnchor="middle" className="tabular fill-stock-dim text-[12px] font-semibold">
                {`Peak ${formatSigned(points[peak].total)}`}
              </text>
            )}
            {labelTrough && (
              <text x={x(trough)} y={y(points[trough].total) + 18} textAnchor="middle" className="tabular fill-stock-dim text-[12px] font-semibold">
                {`Low ${formatSigned(points[trough].total)}`}
              </text>
            )}
            <circle cx={x(n - 1)} cy={y(last.total)} r="4.5" className="fill-brass stroke-walnut-800" strokeWidth="2" />
            <text x={x(n - 1) + 9} y={y(last.total)} dy="0.32em" className="tabular fill-stock text-[13px] font-bold">
              {formatSigned(last.total)}
            </text>
            {a && active !== null && (
              <g aria-hidden="true">
                <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={PAD.t + PLOT_H} className="stroke-stock/50" strokeWidth="1" shapeRendering="crispEdges" />
                <circle cx={x(active)} cy={y(a.total)} r="4.5" className="fill-brass stroke-walnut-800" strokeWidth="2" />
              </g>
            )}
            <rect
              x={PAD.l}
              y={PAD.t}
              width={plotW}
              height={PLOT_H}
              fill="transparent"
              onPointerMove={pick}
              onPointerDown={pick}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}
        {a && active !== null && (
          <div
            className={cx('pointer-events-none absolute top-1 z-10 w-max rounded-md bg-stock px-2.5 py-1.5 text-ink shadow-lift', flip ? '-translate-x-[calc(100%+10px)]' : 'translate-x-[10px]')}
            style={{ left: tipLeft }}
            role="status"
          >
            <p className="tabular text-[15px] font-bold leading-tight">{formatSigned(a.total)}</p>
            <p className="text-[12px] text-ink-soft">{active === 0 ? 'Where you started' : `After hand ${active}`}</p>
          </div>
        )}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
      <details className="mt-2 text-sm text-stock-dim">
        <summary className="cursor-pointer select-none font-semibold hover:text-stock">Show as a table</summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md bg-walnut-950/60 ring-1 ring-inset ring-black/40">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-walnut-900 text-muted">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-semibold">Hand</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">Result</th>
                <th scope="col" className="px-3 py-1.5 text-right font-semibold">Running total</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {curve.map((p, i) => (
                <tr key={p.hand} className="border-t border-walnut-800">
                  <td className="px-3 py-1">{p.hand}</td>
                  <td className="px-3 py-1 text-right">{formatSigned(p.total - (i ? curve[i - 1].total : 0))}</td>
                  <td className="px-3 py-1 text-right text-stock">{formatChips(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
