import { describe, it, expect } from 'vitest';
import type { Card, GamePlayer, GameState } from '@poker/shared';
import { DEFAULT_TABLE_CONFIG } from '@poker/shared';
import { viewFor } from './state-view.js';

const hole = (a: string, b: string): [Card, Card] => [
  { rank: a as Card['rank'], suit: 'hearts' },
  { rank: b as Card['rank'], suit: 'spades' },
];

function player(id: string, over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    discordUserId: id,
    displayName: id,
    avatarUrl: '',
    seatIndex: 0,
    chipStack: 1000,
    betThisRound: 0,
    totalBetThisHand: 0,
    holeCards: hole('A', 'K'),
    status: 'active',
    hasActed: false,
    ...over,
  };
}

function state(players: GamePlayer[], phase: GameState['phase']): GameState {
  return {
    gameId: 'g', instanceId: 'i', phase, players,
    communityCards: [], pots: [], currentPlayerIndex: 0, dealerIndex: 0,
    smallBlindIndex: 0, bigBlindIndex: 1, callAmount: 0, minRaise: 50,
    handNumber: 1, config: DEFAULT_TABLE_CONFIG,
  };
}

describe('viewFor', () => {
  it('shows your own hole cards and hides opponents during play', () => {
    const s = state([player('a'), player('b')], 'flop');
    const view = viewFor(s, 'a');
    expect(view.players.find((p) => p.discordUserId === 'a')!.holeCards).not.toBeNull();
    expect(view.players.find((p) => p.discordUserId === 'b')!.holeCards).toBeNull();
  });

  it('reveals all non-folded hands at showdown', () => {
    const s = state([player('a'), player('b')], 'showdown');
    const view = viewFor(s, null);
    expect(view.players.every((p) => p.holeCards !== null)).toBe(true);
  });

  it('never reveals folded players, even at showdown', () => {
    const s = state([player('a'), player('b', { status: 'folded' })], 'showdown');
    const view = viewFor(s, null);
    expect(view.players.find((p) => p.discordUserId === 'a')!.holeCards).not.toBeNull();
    expect(view.players.find((p) => p.discordUserId === 'b')!.holeCards).toBeNull();
  });

  it('does not mutate the source state', () => {
    const s = state([player('a'), player('b')], 'flop');
    viewFor(s, 'a');
    expect(s.players.every((p) => p.holeCards !== null)).toBe(true);
  });
});
