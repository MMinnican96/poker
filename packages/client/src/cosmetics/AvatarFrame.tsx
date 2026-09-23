import type { ReactNode } from 'react';
import { cx } from '../ui/cx';
import { frameVisual } from './catalog';

export interface AvatarFrameProps {
  /** Shop frame item id (unknown ids draw no frame). */
  frameId: string;
  /** Outer size in px, frame included. */
  size: number;
  /** The round picture inside the frame. */
  children: ReactNode;
  className?: string;
}

/** How much of the outer size the frame ring takes, per style. */
const RING: Record<string, number> = { none: 0.05, brass: 0.1, chip: 0.14, cheese: 0.13, crown: 0.1, flames: 0.14 };

/**
 * Draws a cosmetic frame around a round avatar. Everything is SVG in a 100×100
 * box, so frames scale from 20px seat chips to 160px profile cards.
 */
export function AvatarFrame({ frameId, size, children, className }: AvatarFrameProps) {
  const v = frameVisual(frameId);
  const ring = RING[v.style] ?? 0.05;
  const inset = Math.max(1, Math.round(size * ring));
  const crown = v.style === 'crown';
  return (
    <span
      className={cx('relative inline-block shrink-0', className)}
      style={{ width: size, height: size }}
      data-frame={v.style}
    >
      <span className="absolute overflow-hidden rounded-full bg-walnut-700" style={{ inset }}>
        {children}
      </span>
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        <FrameArt style={v.style} color={v.color} />
      </svg>
      {crown && (
        <svg viewBox="0 0 40 22" className="pointer-events-none absolute left-1/2 -translate-x-1/2" style={{ width: size * 0.46, top: -size * 0.2 }} aria-hidden="true">
          <path d="M3 20 1 5l10 7 9-11 9 11 10-7-2 15Z" fill={v.color} stroke="rgb(0 0 0 / 0.35)" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="20" cy="13" r="2.4" className="fill-chip" />
        </svg>
      )}
    </span>
  );
}

function FrameArt({ style, color }: { style: string; color: string }) {
  switch (style) {
    case 'brass':
    case 'crown':
      return (
        <>
          <circle cx="50" cy="50" r="46" fill="none" stroke={color} strokeWidth="8" />
          <circle cx="50" cy="50" r="49.3" fill="none" stroke="rgb(0 0 0 / 0.35)" strokeWidth="1.2" />
          <circle cx="50" cy="50" r="42.4" fill="none" stroke="rgb(0 0 0 / 0.3)" strokeWidth="1" />
          <path d="M20 22a42 42 0 0 1 30-14" fill="none" stroke="rgb(255 255 255 / 0.45)" strokeWidth="2.4" strokeLinecap="round" />
        </>
      );
    case 'chip':
      // The clay-chip edge: coloured ring with cream edge spots.
      return (
        <>
          <circle cx="50" cy="50" r="43.5" fill="none" stroke={color} strokeWidth="13" />
          <circle cx="50" cy="50" r="43.5" fill="none" className="stroke-stock" strokeWidth="13" strokeDasharray="11.4 22.8" strokeDashoffset="5" />
          <circle cx="50" cy="50" r="49.4" fill="none" stroke="rgb(0 0 0 / 0.4)" strokeWidth="1.2" />
          <circle cx="50" cy="50" r="37" fill="none" className="stroke-stock" strokeWidth="1.2" strokeDasharray="2.5 2.5" />
        </>
      );
    case 'cheese':
      return (
        <>
          <circle cx="50" cy="50" r="44" fill="none" stroke={color} strokeWidth="12" />
          {[20, 75, 130, 200, 250, 315].map((deg, i) => {
            const r = (deg * Math.PI) / 180;
            return <circle key={deg} cx={50 + 44 * Math.cos(r)} cy={50 + 44 * Math.sin(r)} r={i % 2 ? 2.4 : 3.6} fill="rgb(150 95 10 / 0.75)" />;
          })}
          <circle cx="50" cy="50" r="49.5" fill="none" stroke="rgb(150 95 10 / 0.8)" strokeWidth="1.2" />
        </>
      );
    case 'flames':
      return (
        <>
          {Array.from({ length: 14 }, (_, i) => (
            <path
              key={i}
              d="M50 -4 C55 4 57 8 54 14 L46 14 C43 8 45 4 50 -4Z"
              fill={color}
              fillOpacity={i % 2 ? 0.75 : 1}
              transform={`rotate(${i * (360 / 14) + (i % 2 ? 6 : 0)} 50 50)`}
            />
          ))}
          <circle cx="50" cy="50" r="44" fill="none" stroke={color} strokeWidth="9" />
          <circle cx="50" cy="50" r="44" fill="none" className="stroke-brass-light" strokeWidth="2" strokeOpacity="0.8" />
        </>
      );
    default:
      return <circle cx="50" cy="50" r="48" fill="none" className="stroke-walnut-500" strokeWidth="3" />;
  }
}
