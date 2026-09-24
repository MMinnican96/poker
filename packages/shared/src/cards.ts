export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUITS: readonly Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/** Numeric value of a rank, ace high (14). */
export function rankValue(rank: Rank): number {
  return RANK_VALUE[rank];
}

const SUIT_CHAR: Record<Suit, string> = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' };
const CHAR_SUIT: Record<string, Suit> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };

/** Compact string like "Ah" / "10d" — handy for tests and logs. */
export function cardToString(card: Card): string {
  return `${card.rank}${SUIT_CHAR[card.suit]}`;
}

/** Parse "Ah", "10d", "Td" into a card. Throws on bad input. */
export function parseCard(text: string): Card {
  const suit = CHAR_SUIT[text.slice(-1).toLowerCase()];
  let rank = text.slice(0, -1).toUpperCase();
  if (rank === 'T') rank = '10';
  if (!suit || !(RANKS as readonly string[]).includes(rank)) throw new Error(`Bad card: ${text}`);
  return { rank: rank as Rank, suit };
}

/** Parse a space-separated list: "Ah Kd 10c". */
export function parseCards(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map(parseCard);
}
