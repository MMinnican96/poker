import { describe, it, expect } from 'vitest';
import { DEFAULT_TABLE_CONFIG, type TableConfig } from '@poker/shared';
import { createDeck } from './deck.js';
import { startHand, act, contenders, type PlayerSeed } from './game-state.js';

const CONFIG: TableConfig = DEFAULT_TABLE_CONFIG; // sb 25, bb 50

function seeds(n: number, stack = 1000): PlayerSeed[] {
  return Array.from({ length: n }, (_, i) => ({
    discordUserId: `p${i}`,
    displayName: `p${i}`,
    avatarUrl: '',
    seatIndex: i,
    chipStack: stack,
  }));
}

function newHand(n: number, stack = 1000) {
  // Unshuffled deck → deterministic dealing; card values don't affect flow.
  return startHand({
    gameId: 'g',
    instanceId: 'i',
    handNumber: 1,
    dealerIndex: 0,
    seeds: seeds(n, stack),
    config: CONFIG,
    deck: createDeck(),
  });
}

describe('startHand', () => {
  it('posts blinds and seats the first actor (3-handed)', () => {
    const { state } = newHand(3);
    expect(state.phase).toBe('pre-flop');
    expect(state.smallBlindIndex).toBe(1);
    expect(state.bigBlindIndex).toBe(2);
    expect(state.players[1].betThisRound).toBe(25);
    expect(state.players[2].betThisRound).toBe(50);
    expect(state.callAmount).toBe(50);
    expect(state.currentPlayerIndex).toBe(0); // UTG, left of BB
    expect(state.players.every((p) => p.holeCards?.length === 2)).toBe(true);
  });

  it('uses the heads-up rule: button is the small blind and acts first', () => {
    const { state } = newHand(2);
    expect(state.smallBlindIndex).toBe(0); // button
    expect(state.bigBlindIndex).toBe(1);
    expect(state.currentPlayerIndex).toBe(0);
  });
});

describe('betting round progression', () => {
  it('deals the flop after the pre-flop round closes', () => {
    const { state } = (() => {
      const ctx = newHand(3);
      act(ctx, 'p0', { type: 'call' }); // UTG calls 50
      act(ctx, 'p1', { type: 'call' }); // SB completes
      act(ctx, 'p2', { type: 'check' }); // BB checks option
      return ctx;
    })();
    expect(state.phase).toBe('flop');
    expect(state.communityCards).toHaveLength(3);
    expect(state.callAmount).toBe(0);
    expect(state.players.every((p) => p.betThisRound === 0)).toBe(true);
    expect(state.currentPlayerIndex).toBe(1); // first active left of button
  });

  it('reopens the round when the BB raises its option', () => {
    const ctx = newHand(3);
    act(ctx, 'p0', { type: 'call' });
    act(ctx, 'p1', { type: 'call' });
    act(ctx, 'p2', { type: 'raise', amount: 150 });
    expect(ctx.state.phase).toBe('pre-flop'); // still betting
    expect(ctx.state.callAmount).toBe(150);
    expect(ctx.state.players[0].hasActed).toBe(false);
  });
});

describe('hand resolution paths', () => {
  it('ends the hand when everyone but one folds', () => {
    const ctx = newHand(3);
    act(ctx, 'p0', { type: 'fold' });
    act(ctx, 'p1', { type: 'fold' });
    expect(ctx.state.phase).toBe('hand-complete');
    const left = contenders(ctx.state);
    expect(left).toHaveLength(1);
    expect(left[0].discordUserId).toBe('p2');
  });

  it('runs the board out to showdown when all players are all-in', () => {
    const ctx = newHand(2);
    act(ctx, 'p0', { type: 'all-in' });
    act(ctx, 'p1', { type: 'all-in' });
    expect(ctx.state.phase).toBe('showdown');
    expect(ctx.state.communityCards).toHaveLength(5);
    expect(ctx.state.players.every((p) => p.status === 'all-in')).toBe(true);
  });
});
