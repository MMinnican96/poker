import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { GameState } from '@poker/shared';
import { rateForRaiseStep, useTableSounds } from './useTableSounds';
import type { SoundManager, SoundName } from './SoundManager';

function fakeManager() {
  const calls: { name: SoundName; rate?: number }[] = [];
  const manager: SoundManager = {
    unlock: vi.fn(),
    setSettings: vi.fn(),
    play: (name, opts) => calls.push({ name, rate: opts?.rate }),
  };
  return { manager, calls };
}

function base(): GameState {
  return {
    gameId: 'g', instanceId: 'i', phase: 'pre-flop',
    players: [
      { discordUserId: 'a', displayName: 'A', avatarUrl: '', seatIndex: 0, chipStack: 3000, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false, lastAction: null },
      { discordUserId: 'b', displayName: 'B', avatarUrl: '', seatIndex: 1, chipStack: 3000, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false, lastAction: null },
    ],
    communityCards: [],
    pots: [{ amount: 0, eligiblePlayerIds: ['a', 'b'] }],
    currentPlayerIndex: 0, dealerIndex: 0, smallBlindIndex: 0, bigBlindIndex: 1,
    callAmount: 0, minRaise: 50, handNumber: 1,
    config: { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 },
  };
}

const FLOP = [
  { rank: '2', suit: 'clubs' as const },
  { rank: '7', suit: 'hearts' as const },
  { rank: 'K', suit: 'spades' as const },
];

function frame(over: Partial<GameState>): GameState {
  return { ...base(), ...over };
}
function withLast(s: GameState, id: string, action: GameState['players'][number]['lastAction']): GameState {
  return { ...s, players: s.players.map((p) => (p.discordUserId === id ? { ...p, lastAction: action } : p)) };
}

describe('rateForRaiseStep', () => {
  it('starts at 1.0 and climbs, capped at 1.6', () => {
    expect(rateForRaiseStep(1)).toBeCloseTo(1.0);
    expect(rateForRaiseStep(2)).toBeCloseTo(1.07);
    expect(rateForRaiseStep(3)).toBeCloseTo(1.14);
    expect(rateForRaiseStep(50)).toBe(1.6);
  });
});

describe('useTableSounds', () => {
  let fm: ReturnType<typeof fakeManager>;
  beforeEach(() => { fm = fakeManager(); });

  function run(views: (GameState | null)[]) {
    const { rerender } = renderHook(({ v }) => useTableSounds(v, fm.manager), { initialProps: { v: views[0] } });
    for (const v of views.slice(1)) rerender({ v });
  }
  const names = () => fm.calls.map((c) => c.name);
  const suspense = () => fm.calls.filter((c) => c.name === 'suspense');

  it('plays no sound for the first view', () => {
    run([base()]);
    expect(fm.calls).toHaveLength(0);
  });

  it('plays the deal sound when a new street appears', () => {
    run([base(), frame({ phase: 'flop', communityCards: FLOP })]);
    expect(names()).toContain('deal');
  });

  it('escalates pitch across consecutive raises (incl. same player re-raising) and resets on the next street', () => {
    const f0 = base();
    const f1 = withLast(frame({ callAmount: 100 }), 'a', 'raise');
    const f2 = withLast(withLast(frame({ callAmount: 200 }), 'a', 'raise'), 'b', 'raise');
    const f3 = withLast(withLast(frame({ callAmount: 300 }), 'a', 'raise'), 'b', 'raise'); // a re-raises; lastAction unchanged
    const f4 = frame({ phase: 'flop', communityCards: FLOP, callAmount: 0 }); // street closes
    const f5 = withLast(frame({ phase: 'flop', communityCards: FLOP, callAmount: 100 }), 'b', 'raise');
    run([f0, f1, f2, f3, f4, f5]);

    expect(suspense().map((c) => c.rate)).toEqual([
      expect.closeTo(1.0), expect.closeTo(1.07), expect.closeTo(1.14), expect.closeTo(1.0),
    ]);
    expect(fm.calls.filter((c) => c.name === 'bet')).toHaveLength(4);
    expect(fm.calls.filter((c) => c.name === 'deal')).toHaveLength(1);
  });

  it('resets the streak on an observed call, then a new raise starts at base pitch', () => {
    const f0 = base();
    const f1 = withLast(frame({ callAmount: 100 }), 'a', 'raise');
    const f2 = withLast(frame({ callAmount: 100 }), 'b', 'call');
    const f3 = withLast(frame({ callAmount: 200 }), 'a', 'raise');
    run([f0, f1, f2, f3]);
    const s = suspense();
    expect(s[s.length - 1].rate).toBeCloseTo(1.0);
    expect(names()).toContain('bet');
  });

  it('plays bet and resets the streak on a passive (call-size) all-in', () => {
    const f0 = base();
    const f1 = withLast(frame({ callAmount: 100 }), 'a', 'raise');   // a raises → suspense 1.0
    const f2 = withLast(frame({ callAmount: 100 }), 'b', 'all-in');  // b shoves the call amount; callAmount flat
    const f3 = withLast(frame({ callAmount: 200 }), 'a', 'raise');   // a raises again → should be base pitch again
    run([f0, f1, f2, f3]);
    expect(fm.calls.filter((c) => c.name === 'bet')).toHaveLength(3); // raise + all-in(call) + raise
    expect(suspense().pop()!.rate).toBeCloseTo(1.0);                 // streak reset by the passive all-in
  });

  it('plays check and fold sounds', () => {
    run([base(), withLast(base(), 'a', 'check')]);
    expect(names()).toContain('check');
    fm.calls.length = 0;
    run([base(), withLast(base(), 'b', 'fold')]);
    expect(names()).toContain('fold');
  });

  it('plays the win sound once when showdown appears, without replaying deal/bet', () => {
    const river = frame({ phase: 'river', communityCards: [...FLOP, { rank: '9', suit: 'diamonds' }, { rank: 'J', suit: 'clubs' }], callAmount: 0 });
    const waiting = frame({ phase: 'waiting', communityCards: [], callAmount: 0 });
    const final = { ...river, phase: 'hand-complete' as const, showdown: { winnerIds: ['a'], hands: { a: { category: 'pair' as const, label: 'Pair' } } } };
    run([river, waiting, final]);
    expect(fm.calls.filter((c) => c.name === 'win')).toHaveLength(1);
    expect(names()).not.toContain('deal');
  });

  it('resets the streak on a new hand', () => {
    const f0 = base();
    const f1 = withLast(frame({ callAmount: 100 }), 'a', 'raise');
    const hand2 = frame({ handNumber: 2 });
    const f2 = withLast(frame({ handNumber: 2, callAmount: 100 }), 'a', 'raise');
    run([f0, f1, hand2, f2]);
    expect(suspense().pop()!.rate).toBeCloseTo(1.0);
  });
});
