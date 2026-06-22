import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { GameState, ActionType } from '@poker/shared';
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

function withAction(s: GameState, id: string, action: ActionType): GameState {
  return {
    ...s,
    players: s.players.map((p) => (p.discordUserId === id ? { ...p, lastAction: action } : p)),
  };
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
    const { rerender } = renderHook(({ v }) => useTableSounds(v, fm.manager), {
      initialProps: { v: views[0] },
    });
    for (const v of views.slice(1)) rerender({ v });
  }

  it('plays no sound for the first view', () => {
    run([base()]);
    expect(fm.calls).toHaveLength(0);
  });

  it('plays the deal sound when community cards appear', () => {
    const flop = { ...base(), phase: 'flop' as const, communityCards: [
      { rank: '2', suit: 'clubs' as const }, { rank: '7', suit: 'hearts' as const }, { rank: 'K', suit: 'spades' as const },
    ] };
    run([base(), flop]);
    expect(fm.calls.map((c) => c.name)).toContain('deal');
  });

  it('escalates suspense pitch on consecutive raises and resets on call', () => {
    const s0 = base();
    const s1 = withAction(s0, 'a', 'raise');
    const s2 = withAction(s1, 'b', 'raise');
    const s3 = withAction(s2, 'a', 'call'); // resets
    const s4 = withAction({ ...s3, players: s3.players.map((p) => ({ ...p, lastAction: null })) }, 'b', 'raise');
    run([s0, s1, s2, s3, s4]);

    const suspense = fm.calls.filter((c) => c.name === 'suspense');
    expect(suspense.length).toBe(3);
    expect(suspense[0].rate).toBeCloseTo(1.0); // first raise
    expect(suspense[1].rate).toBeCloseTo(1.07); // second consecutive raise
    expect(suspense[2].rate).toBeCloseTo(1.0); // after a call → reset
    expect(fm.calls.filter((c) => c.name === 'bet').length).toBe(3); // 2 raises + 1 call
  });

  it('plays check and fold sounds', () => {
    const s0 = base();
    run([s0, withAction(s0, 'a', 'check')]);
    expect(fm.calls.map((c) => c.name)).toContain('check');
    fm.calls.length = 0;
    run([s0, withAction(s0, 'b', 'fold')]);
    expect(fm.calls.map((c) => c.name)).toContain('fold');
  });

  it('plays the win sound once when showdown appears, without replaying deal/bet', () => {
    const river = { ...base(), phase: 'river' as const, communityCards: [
      { rank: '2', suit: 'clubs' as const }, { rank: '7', suit: 'hearts' as const }, { rank: 'K', suit: 'spades' as const },
      { rank: '9', suit: 'diamonds' as const }, { rank: 'J', suit: 'clubs' as const },
    ], players: base().players.map((p) => ({ ...p, lastAction: 'check' as const })) };
    // Cardless waiting rebroadcast, then the revealed showdown finalState.
    const waiting = { ...base(), phase: 'waiting' as const, communityCards: [], players: base().players.map((p) => ({ ...p, lastAction: null })) };
    const final = { ...river, phase: 'hand-complete' as const, showdown: { winnerIds: ['a'], hands: { a: { category: 'pair' as const, label: 'Pair' } } } };
    run([river, waiting, final]);
    expect(fm.calls.filter((c) => c.name === 'win')).toHaveLength(1);
    expect(fm.calls.map((c) => c.name)).not.toContain('deal');
  });

  it('resets the raise counter on a new hand', () => {
    const s0 = base();
    const s1 = withAction(s0, 'a', 'raise');
    const hand2 = { ...base(), handNumber: 2 };
    const s2 = withAction(hand2, 'a', 'raise');
    run([s0, s1, hand2, s2]);
    const suspense = fm.calls.filter((c) => c.name === 'suspense');
    expect(suspense[suspense.length - 1].rate).toBeCloseTo(1.0); // fresh hand → base pitch
  });
});
