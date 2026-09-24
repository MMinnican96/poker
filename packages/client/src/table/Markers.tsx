import { formatChips, formatChipsShort } from '@poker/shared';
import { ChipGlyph, cx } from '../ui';
import type { Point } from './layout';

/** Chips a player has put in on this street, sitting in front of their seat. */
export function BetChips({ at, amount, name, size, blind, showBlind = true }: { at: Point; amount: number; name: string; size: number; blind?: 'SB' | 'BB' | null; showBlind?: boolean }) {
  const chips = amount >= 1000 ? 3 : amount >= 100 ? 2 : 1;
  const g = Math.max(13, Math.round(size * 0.34));
  return (
    <div
      className="tbl-pop absolute z-[2] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
      style={{ left: at.x, top: at.y }}
      aria-label={`${name} bet ${formatChips(amount)}${blind ? ` (${blind === 'SB' ? 'small blind' : 'big blind'})` : ''}`}
      role="img"
    >
      <span className="relative inline-block" style={{ width: g, height: g + (chips - 1) * 3 }} aria-hidden="true">
        {Array.from({ length: chips }, (_, i) => (
          <span key={i} className="absolute left-0 drop-shadow-[0_1px_0_rgb(0_0_0/0.5)]" style={{ bottom: i * 3 }}>
            <ChipGlyph size={g} className="block" />
          </span>
        ))}
      </span>
      <span
        className="tabular rounded-full bg-walnut-950/70 px-1.5 font-condensed font-bold text-stock"
        style={{ fontSize: Math.max(11, Math.min(14, size * 0.3)), lineHeight: 1.4 }}
        aria-hidden="true"
      >
        {blind && showBlind && <span className="mr-1 text-[0.85em] text-muted">{blind}</span>}
        {formatChipsShort(amount)}
      </span>
    </div>
  );
}

/** The dealer button, or a small/big blind marker. */
export function SeatMarker({ at, kind, size }: { at: Point; kind: 'D' | 'SB' | 'BB'; size: number }) {
  const d = Math.max(16, Math.round(size * (kind === 'D' ? 0.42 : 0.38)));
  const label = kind === 'D' ? 'Dealer button' : kind === 'SB' ? 'Small blind' : 'Big blind';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cx(
        'absolute z-[2] grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-condensed leading-none font-bold',
        kind === 'D'
          ? 'bg-stock text-ink shadow-[0_2px_0_var(--color-stock-edge),0_3px_6px_rgb(0_0_0/0.4)]'
          : 'bg-walnut-950/80 text-stock-dim ring-1 ring-stock/25',
      )}
      style={{ left: at.x, top: at.y, width: d, height: d, fontSize: d * (kind === 'D' ? 0.56 : 0.44) }}
    >
      {kind}
    </span>
  );
}
