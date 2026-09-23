import { formatChips, formatChipsShort, formatSigned } from '@poker/shared';
import { cx } from './cx';

/** A tiny clay chip: brass body with the edge-spot ring. */
export function ChipGlyph({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className={cx('shrink-0', className)}>
      <circle cx="8" cy="8" r="7.5" className="fill-brass-dark" />
      <circle cx="8" cy="8" r="6.6" className="fill-brass" />
      <circle cx="8" cy="8" r="5.6" fill="none" className="stroke-stock" strokeWidth="1.6" strokeDasharray="2.2 2.2" />
      <circle cx="8" cy="8" r="3.4" className="fill-brass-dark/40" />
    </svg>
  );
}

export interface ChipAmountProps {
  value: number;
  /** 12.3k / 1.2M above 10,000 — for tight spaces. */
  short?: boolean;
  /** Prefix + / - and colour by sign (winnings, net results). */
  signed?: boolean;
  /** sm/md use the UI face; lg/xl use the slab display face (pots, stacks, bankroll). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Hide the chip glyph. */
  bare?: boolean;
  className?: string;
}

const TEXT = {
  sm: 'text-[13px] font-semibold gap-1',
  md: 'text-[15px] font-semibold gap-1.5',
  lg: 'font-display text-xl gap-1.5',
  xl: 'font-display text-3xl gap-2',
} as const;
const GLYPH = { sm: 12, md: 14, lg: 18, xl: 24 } as const;

/** A chip count with the chip glyph and tabular figures. The full amount is in the accessible label. */
export function ChipAmount({ value, short, signed, size = 'md', bare, className }: ChipAmountProps) {
  const text = signed ? formatSigned(value) : short ? formatChipsShort(value) : formatChips(value);
  const shown = signed && short && Math.abs(value) >= 10_000 ? (value > 0 ? '+' : '') + formatChipsShort(value) : text;
  const tone = signed ? (value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : undefined) : undefined;
  return (
    <span
      className={cx('tabular inline-flex items-center whitespace-nowrap', TEXT[size], tone, className)}
    >
      <span className="sr-only">{`${signed ? formatSigned(value) : formatChips(value)} chips`}</span>
      {!bare && <ChipGlyph size={GLYPH[size]} />}
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
