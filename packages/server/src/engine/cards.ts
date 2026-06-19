import type { Card, Rank, Suit } from '@poker/shared';

export const RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/** Numeric value of a rank, Ace high (14). */
export function rankValue(rank: Rank): number {
  return RANK_VALUE[rank];
}

const SUIT_CHAR: Record<Suit, string> = {
  hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's',
};

/** Compact string like "Ah" / "10d" — handy for tests and logging. */
export function cardToString(card: Card): string {
  return `${card.rank}${SUIT_CHAR[card.suit]}`;
}
