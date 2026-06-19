import { describe, it, expect } from 'vitest';
import type { GamePlayer, GameState } from '@poker/shared';
import { DEFAULT_TABLE_CONFIG } from '@poker/shared';
import { validateAction, applyActionToState } from './actions.js';

function player(id: string, over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    discordUserId: id,
    displayName: id,
    avatarUrl: '',
    seatIndex: 0,
    chipStack: 1000,
    betThisRound: 0,
    totalBetThisHand: 0,
    holeCards: null,
    status: 'active',
    hasActed: false,
    ...over,
  };
}

function state(players: GamePlayer[], over: Partial<GameState> = {}): GameState {
  players.forEach((p, i) => (p.seatIndex = i));
  return {
    gameId: 'g',
    instanceId: 'i',
    phase: 'pre-flop',
    players,
    communityCards: [],
    pots: [],
    currentPlayerIndex: 0,
    dealerIndex: 0,
    smallBlindIndex: 0,
    bigBlindIndex: 1,
    callAmount: 0,
    minRaise: DEFAULT_TABLE_CONFIG.bigBlind,
    handNumber: 1,
    config: DEFAULT_TABLE_CONFIG,
    ...over,
  };
}

describe('validateAction', () => {
  it("rejects acting out of turn", () => {
    const s = state([player('a'), player('b')]);
    expect(validateAction(s, 'b', { type: 'check' }).valid).toBe(false);
  });

  it('allows check only when there is nothing to call', () => {
    const s = state([player('a')], { callAmount: 0 });
    expect(validateAction(s, 'a', { type: 'check' }).valid).toBe(true);
    s.callAmount = 50;
    expect(validateAction(s, 'a', { type: 'check' }).valid).toBe(false);
  });

  it('rejects a raise below the minimum that is not an all-in', () => {
    const s = state([player('a', { chipStack: 1000 })], { callAmount: 100, minRaise: 100 });
    expect(validateAction(s, 'a', { type: 'raise', amount: 150 }).valid).toBe(false);
    expect(validateAction(s, 'a', { type: 'raise', amount: 200 }).valid).toBe(true);
  });

  it('rejects raising more chips than you have', () => {
    const s = state([player('a', { chipStack: 120 })], { callAmount: 50, minRaise: 50 });
    expect(validateAction(s, 'a', { type: 'raise', amount: 300 }).valid).toBe(false);
  });

  it('allows a short all-in below the min raise', () => {
    const s = state([player('a', { chipStack: 120 })], { callAmount: 100, minRaise: 100 });
    // total bet 120 < min target 200, but it is the whole stack
    expect(validateAction(s, 'a', { type: 'raise', amount: 120 }).valid).toBe(true);
  });
});

describe('applyActionToState', () => {
  it('a partial call goes all-in', () => {
    const p = player('a', { chipStack: 30 });
    const s = state([p], { callAmount: 100 });
    applyActionToState(s, 'a', { type: 'call' });
    expect(p.chipStack).toBe(0);
    expect(p.betThisRound).toBe(30);
    expect(p.status).toBe('all-in');
  });

  it('a full raise updates callAmount/minRaise and reopens action', () => {
    const a = player('a', { chipStack: 1000 });
    const b = player('b', { hasActed: true });
    const c = player('c', { status: 'folded', hasActed: true });
    const s = state([a, b, c], { callAmount: 100, minRaise: 100 });
    applyActionToState(s, 'a', { type: 'raise', amount: 300 });
    expect(s.callAmount).toBe(300);
    expect(s.minRaise).toBe(200);
    expect(a.betThisRound).toBe(300);
    expect(b.hasActed).toBe(false); // must respond
    expect(c.hasActed).toBe(true); // folded, untouched
  });

  it('fold marks the player folded', () => {
    const p = player('a');
    const s = state([p]);
    applyActionToState(s, 'a', { type: 'fold' });
    expect(p.status).toBe('folded');
  });
});
