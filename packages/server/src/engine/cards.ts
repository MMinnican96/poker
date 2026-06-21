import type { Card, Rank, Suit } from '@poker/shared';
export { rankValue } from '@poker/shared';

export const RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

const SUIT_CHAR: Record<Suit, string> = {
  hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's',
};

/** Compact string like "Ah" / "10d" — handy for tests and logging. */
export function cardToString(card: Card): string {
  return `${card.rank}${SUIT_CHAR[card.suit]}`;
}
