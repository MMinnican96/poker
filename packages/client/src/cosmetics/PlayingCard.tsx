import type { Card, Suit } from '@poker/shared';
import { cx } from '../ui/cx';
import { CardBack, CARD_RATIO } from './CardBack';

export const SUIT_PATH: Record<Suit, string> = {
  hearts: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.5 2.9 4.5 6.6 4.5c2.2 0 3.9 1.3 5.4 3.3 1.5-2 3.2-3.3 5.4-3.3 3.7 0 5.7 4 4.2 7.3C19.5 16.4 12 21 12 21Z',
  diamonds: 'M12 2.2 19.6 12 12 21.8 4.4 12Z',
  clubs: 'M12 3.2a4.3 4.3 0 0 1 3.9 6.1 4.3 4.3 0 1 1-2.6 6.9L14.5 21h-5l1.2-4.8a4.3 4.3 0 1 1-2.6-6.9A4.3 4.3 0 0 1 12 3.2Z',
  spades: 'M12 2.5S3.8 8.8 3.8 13.8a4.1 4.1 0 0 0 7.1 2.8L9.6 21h4.8l-1.3-4.4a4.1 4.1 0 0 0 7.1-2.8C20.2 8.8 12 2.5 12 2.5Z',
};

const SUIT_NAME: Record<Suit, string> = { hearts: 'hearts', diamonds: 'diamonds', clubs: 'clubs', spades: 'spades' };
const RANK_NAME: Record<string, string> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };

export const isRedSuit = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';

/** Spoken name, e.g. "Queen of hearts". */
export function cardName(card: Card): string {
  return `${RANK_NAME[card.rank] ?? card.rank} of ${SUIT_NAME[card.suit]}`;
}

export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export const CARD_WIDTH: Record<CardSize, number> = { xs: 28, sm: 40, md: 56, lg: 72, xl: 96 };

/** A suit symbol as an inline SVG (never an emoji). */
export function SuitIcon({ suit, size = 14, className }: { suit: Suit; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={cx(isRedSuit(suit) ? 'fill-suit-red' : 'fill-suit-black', className)}>
      <path d={SUIT_PATH[suit]} />
    </svg>
  );
}

export interface PlayingCardProps {
  /** The card; null (or `faceDown`) draws the back. */
  card: Card | null;
  faceDown?: boolean;
  /** Card back to use when face down. */
  backId?: string;
  /** Preset width, or pass `width` in px. */
  size?: CardSize;
  width?: number;
  /** Lift + brass outline (e.g. cards in the winning hand). */
  highlight?: boolean;
  /** Fade (e.g. cards not in the winning hand, folded). */
  dim?: boolean;
  className?: string;
}

/**
 * A playing card on card stock: big rank + suit in the corner (readable down to
 * 28px wide) and a large suit in the lower right.
 */
export function PlayingCard({ card, faceDown, backId = 'back-classic', size = 'md', width, highlight, dim, className }: PlayingCardProps) {
  const w = width ?? CARD_WIDTH[size];
  const wrap = cx(
    'inline-block shrink-0 rounded-[8%/5.7%] leading-none transition-[transform,opacity]',
    highlight && 'ring-2 ring-brass -translate-y-[6%] shadow-lift',
    dim && 'opacity-40',
    className,
  );
  if (!card || faceDown) {
    return (
      <span className={wrap} style={{ width: w }}>
        <CardBack backId={backId} width={w} className="block drop-shadow-sm" />
      </span>
    );
  }
  const red = isRedSuit(card.suit);
  const tiny = w < 44;
  return (
    <span className={wrap} style={{ width: w }}>
      <svg width={w} height={Math.round(w * CARD_RATIO)} viewBox="0 0 50 70" role="img" aria-label={cardName(card)} className="block drop-shadow-sm">
        <rect x="0.5" y="0.5" width="49" height="69" rx="4" className="fill-stock stroke-stock-edge" />
        <text
          x={tiny ? 5 : 5}
          y={tiny ? 27 : 21}
          fontFamily="Barlow Condensed, Barlow, sans-serif"
          fontWeight="700"
          fontSize={tiny ? (card.rank === '10' ? 27 : 30) : card.rank === '10' ? 20 : 22}
          letterSpacing={card.rank === '10' ? -1.5 : 0}
          className={red ? 'fill-suit-red' : 'fill-suit-black'}
        >
          {card.rank}
        </text>
        {tiny ? (
          <path d={SUIT_PATH[card.suit]} transform="translate(22 38) scale(1.1)" className={red ? 'fill-suit-red' : 'fill-suit-black'} />
        ) : (
          <>
            <path d={SUIT_PATH[card.suit]} transform="translate(5.5 25) scale(0.5)" className={red ? 'fill-suit-red' : 'fill-suit-black'} />
            <path d={SUIT_PATH[card.suit]} transform="translate(20 34) scale(1.15)" className={red ? 'fill-suit-red' : 'fill-suit-black'} />
          </>
        )}
      </svg>
    </span>
  );
}
