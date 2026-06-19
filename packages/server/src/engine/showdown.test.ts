import { describe, it, expect } from 'vitest';
import type { Card, GamePlayer, GameState, Pot, Rank, Suit } from '@poker/shared';
import { DEFAULT_TABLE_CONFIG } from '@poker/shared';
import { resolveShowdown } from './showdown.js';
import { totalPot } from './pot.js';

const SUIT_BY_CHAR: Record<string, Suit> = {
  h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades',
};
function card(str: string): Card {
  return { rank: str.slice(0, -1) as Rank, suit: SUIT_BY_CHAR[str.slice(-1)] };
}
const cards = (...s: string[]): Card[] => s.map(card);

function player(id: string, seat: number, hole: [Card, Card]): GamePlayer {
  return {
    discordUserId: id,
    displayName: id,
    avatarUrl: '',
    seatIndex: seat,
    chipStack: 0,
    betThisRound: 0,
    totalBetThisHand: 0,
    holeCards: hole,
    status: 'active',
    hasActed: true,
  };
}

function showdownState(players: GamePlayer[], community: Card[], pots: Pot[]): GameState {
  return {
    gameId: 'g',
    instanceId: 'i',
    phase: 'showdown',
    players,
    communityCards: community,
    pots,
    currentPlayerIndex: 0,
    dealerIndex: 0,
    smallBlindIndex: 0,
    bigBlindIndex: 1,
    callAmount: 0,
    minRaise: 50,
    handNumber: 1,
    config: DEFAULT_TABLE_CONFIG,
  };
}

describe('resolveShowdown', () => {
  it('awards the pot to the best hand', () => {
    const board = cards('2h', '7d', '9s', 'Jc', '4d');
    const a = player('a', 0, [card('Ah'), card('Ad')]); // pair of aces
    const b = player('b', 1, [card('Kh'), card('Kd')]); // pair of kings
    const result = resolveShowdown(
      showdownState([a, b], board, [{ amount: 200, eligiblePlayerIds: ['a', 'b'] }]),
    );
    expect(result.winningsByPlayer).toEqual({ a: 200 });
  });

  it('splits a tied pot evenly', () => {
    const board = cards('10h', 'Jh', 'Qh', 'Kh', 'Ah'); // royal flush on board
    const a = player('a', 0, [card('2c'), card('3d')]);
    const b = player('b', 1, [card('4s'), card('5c')]);
    const result = resolveShowdown(
      showdownState([a, b], board, [{ amount: 200, eligiblePlayerIds: ['a', 'b'] }]),
    );
    expect(result.winningsByPlayer).toEqual({ a: 100, b: 100 });
  });

  it('gives the odd chip to the earliest seat left of the button', () => {
    const board = cards('10h', 'Jh', 'Qh', 'Kh', 'Ah');
    const a = player('a', 0, [card('2c'), card('3d')]);
    const b = player('b', 1, [card('4s'), card('5c')]);
    const result = resolveShowdown(
      showdownState([a, b], board, [{ amount: 201, eligiblePlayerIds: ['a', 'b'] }]),
    );
    expect(result.winningsByPlayer).toEqual({ a: 101, b: 100 });
  });

  it('awards an uncontested pot without evaluating an incomplete board', () => {
    // Pre-flop fold-out: empty board, only one eligible (non-folded) player.
    const a = player('a', 0, [card('Ah'), card('Ad')]);
    const result = resolveShowdown(
      showdownState([a], [], [{ amount: 75, eligiblePlayerIds: ['a'] }]),
    );
    expect(result.winningsByPlayer).toEqual({ a: 75 });
  });

  it('resolves main and side pots independently', () => {
    const board = cards('2h', '7d', '9s', 'Jc', '4d');
    const a = player('a', 0, [card('Ah'), card('Ad')]); // best overall (aces)
    const b = player('b', 1, [card('Kh'), card('Kd')]); // kings
    const c = player('c', 2, [card('Qh'), card('Qd')]); // queens
    const pots: Pot[] = [
      { amount: 150, eligiblePlayerIds: ['a', 'b', 'c'] }, // main: a wins
      { amount: 300, eligiblePlayerIds: ['b', 'c'] }, // side: b wins
    ];
    const result = resolveShowdown(showdownState([a, b, c], board, pots));
    expect(result.winningsByPlayer).toEqual({ a: 150, b: 300 });
    // chips are conserved
    expect(Object.values(result.winningsByPlayer).reduce((x, y) => x + y, 0)).toBe(
      totalPot(pots),
    );
  });
});
