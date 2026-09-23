import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../ui/cx';
import { feltVisual } from './catalog';
import { RatbagCrest } from './RatbagCrest';

export interface FeltProps {
  /** Shop felt item id (unknown ids fall back to the house felt). */
  feltId: string;
  /** oval = a table top; rect = a swatch or panel. */
  shape?: 'oval' | 'rect';
  /** Print the Ratbag crest in the middle (default true). */
  crest?: boolean;
  /** Print the racetrack line (the betting line) inside the edge (default true). */
  racetrack?: boolean;
  /** Wrap the cloth in a padded rail in the felt's rail colour. */
  rail?: boolean;
  /** Crest width as a fraction of the felt's width (default 0.3). */
  crestScale?: number;
  className?: string;
  style?: CSSProperties;
  /** Overlaid on the cloth (seats, board, pot) — positioned relative to it. */
  children?: ReactNode;
}

/**
 * Club baize printed with the Ratbag crest. Fills its container: size it with
 * `className` (e.g. `w-full aspect-[2/1]`). Colours come from the catalog item.
 */
export function Felt({ feltId, shape = 'oval', crest = true, racetrack = true, rail = false, crestScale = 0.3, className, style, children }: FeltProps) {
  const v = feltVisual(feltId);
  const round = shape === 'oval' ? 'rounded-[50%]' : 'rounded-xl';
  const cloth = (
    <div
      className={cx('relative h-full w-full overflow-hidden', round, !rail && className)}
      style={{
        backgroundColor: v.base,
        backgroundImage: `radial-gradient(ellipse at 50% 45%, transparent 35%, ${v.deep} 125%)`,
        boxShadow: `inset 0 0 0 1px ${v.deep}, inset 0 6px 24px ${v.deep}`,
        ...(rail ? undefined : style),
      }}
      data-felt={feltId}
    >
      <div className="tex-grain pointer-events-none absolute inset-0 opacity-80" aria-hidden="true" />
      {racetrack && (
        <div
          aria-hidden="true"
          className={cx('pointer-events-none absolute', shape === 'oval' ? 'inset-[11%] rounded-[50%]' : 'inset-3 rounded-lg')}
          style={{ border: `2px solid ${v.line}`, opacity: 0.32 }}
        />
      )}
      {crest && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 aspect-square -translate-x-1/2 -translate-y-1/2"
          style={{ width: `${crestScale * 100}%`, maxHeight: '70%', opacity: 0.2 }}
        >
          <RatbagCrest color={v.line} className="h-full w-full" />
        </div>
      )}
      {children}
    </div>
  );
  if (!rail) return cloth;
  return (
    <div
      className={cx('tex-wood p-[3.5%]', round, className)}
      style={{ backgroundColor: v.rail, boxShadow: `inset 0 2px 0 rgb(255 255 255 / 0.08), 0 14px 30px rgb(0 0 0 / 0.5)`, ...style }}
    >
      {cloth}
    </div>
  );
}
