import { useId, type ReactNode } from 'react';
import type { CardBackVisual } from '@poker/shared';
import { cardBackVisual } from './catalog';
import { RatbagCrest } from './RatbagCrest';

/** Standard card proportions (width : height). */
export const CARD_RATIO = 1.4;

export interface CardBackProps {
  /** Shop card-back item id (unknown ids fall back to the club lattice). */
  backId: string;
  /** Width in px; height follows the card ratio. */
  width?: number;
  className?: string;
}

function Pattern({ v, pid }: { v: CardBackVisual; pid: string }): ReactNode {
  const { primary: p, secondary: s } = v;
  switch (v.pattern) {
    case 'lattice':
      return (
        <pattern id={pid} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={p} />
          <path d="M0 0h6M0 0v6" stroke={s} strokeWidth="1" strokeOpacity="0.75" />
        </pattern>
      );
    case 'stripes':
      return (
        <pattern id={pid} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="5" height="5" fill={p} />
          <rect width="1.6" height="5" fill={s} fillOpacity="0.85" />
        </pattern>
      );
    case 'cheese':
      return (
        <pattern id={pid} width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill={p} />
          <circle cx="4" cy="5" r="2.6" fill={s} />
          <circle cx="14" cy="3" r="1.5" fill={s} />
          <circle cx="11" cy="12" r="3.2" fill={s} />
          <circle cx="3" cy="16" r="1.8" fill={s} />
          <circle cx="17" cy="17" r="2" fill={s} />
        </pattern>
      );
    case 'grid':
      return (
        <pattern id={pid} width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill={p} />
          <path d="M5 0H0v5" fill="none" stroke={s} strokeWidth="0.5" strokeOpacity="0.7" />
        </pattern>
      );
    case 'sunburst':
      return (
        <pattern id={pid} width="50" height="70" patternUnits="userSpaceOnUse">
          <rect width="50" height="70" fill={p} />
          {Array.from({ length: 16 }, (_, i) => (
            <path key={i} d="M25 35 L22.5 -20 L27.5 -20 Z" fill={s} fillOpacity="0.8" transform={`rotate(${i * 22.5} 25 35)`} />
          ))}
        </pattern>
      );
  }
}

/**
 * A card back's pattern as a fill for any box (e.g. the art window of a profile
 * card). Fills its container; `scale` enlarges the pattern (default 3).
 */
export function CardBackPattern({ backId, scale = 3, className }: { backId: string; scale?: number; className?: string }) {
  const v = cardBackVisual(backId);
  const pid = `backfill-${useId().replace(/:/g, '')}`;
  return (
    <svg className={className} width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true" data-card-back={backId}>
      <defs>
        <Pattern v={v} pid={pid} />
      </defs>
      <g transform={`scale(${scale})`}>
        <rect width="100%" height="100%" fill={`url(#${pid})`} />
      </g>
    </svg>
  );
}

/** The back of a playing card, drawn from the catalog's pattern + colours. */
export function CardBack({ backId, width = 56, className }: CardBackProps) {
  const v = cardBackVisual(backId);
  const pid = `back-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={width}
      height={Math.round(width * CARD_RATIO)}
      viewBox="0 0 50 70"
      className={className}
      role="img"
      aria-label="Face-down card"
    >
      <defs>
        <Pattern v={v} pid={pid} />
      </defs>
      <rect x="0.5" y="0.5" width="49" height="69" rx="4" fill={v.secondary} stroke="rgb(0 0 0 / 0.25)" />
      <rect x="3.5" y="3.5" width="43" height="63" rx="2.2" fill={`url(#${pid})`} />
      <rect x="3.5" y="3.5" width="43" height="63" rx="2.2" fill="none" stroke={v.secondary} strokeOpacity="0.6" strokeWidth="0.8" />
      {v.pattern === 'lattice' && (
        <g transform="translate(13 23)">
          <circle cx="12" cy="12" r="12.5" fill={v.primary} />
          <svg width="24" height="24" viewBox="0 0 200 200">
            <RatbagCrest color={v.secondary} lettering={false} />
          </svg>
        </g>
      )}
    </svg>
  );
}
