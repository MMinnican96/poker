import { describe, it, expect } from 'vitest';
import type { Card } from '@poker/shared';
import { HandStatsTracker, royalAwareCategory, buildHandFacts } from './hand-stats.js';
import type { HandRank } from '../engine/hand-evaluator.js';
import type { GameState, GamePlayer } from '@poker/shared';
import type { ShowdownResult } from '../engine/showdown.js';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('HandStatsTracker', () => {
  it('flags VPIP and PFR from a pre-flop raise', () => {
    const t = new HandStatsTracker(1000);
    t.record('a', 'pre-flop', 'raise');
    t.record('b', 'pre-flop', 'call');
    expect(t.vpip('a')).toBe(true);
    expect(t.pfr('a')).toBe(true);
    expect(t.vpip('b')).toBe(true);
    expect(t.pfr('b')).toBe(false);
  });

  it('does not flag VPIP for a pre-flop check (big blind option)', () => {
    const t = new HandStatsTracker(1000);
    t.record('bb', 'pre-flop', 'check');
    expect(t.vpip('bb')).toBe(false);
    expect(t.pfr('bb')).toBe(false);
  });

  it('counts aggressive (raise/all-in) vs passive (call) actions', () => {
    const t = new HandStatsTracker(0);
    t.record('a', 'pre-flop', 'raise');
    t.record('a', 'flop', 'all-in');
    t.record('a', 'turn', 'call');
    expect(t.aggressiveActions('a')).toBe(2);
    expect(t.passiveActions('a')).toBe(1);
    expect(t.wasAllIn('a')).toBe(true);
  });

  it('reports the street a player folded on, or null if they never folded', () => {
    const t = new HandStatsTracker(0);
    t.record('a', 'flop', 'fold');
    expect(t.foldStreet('a')).toBe('flop');
    expect(t.foldStreet('b')).toBeNull();
  });
});

describe('royalAwareCategory', () => {
  const mk = (category: HandRank['category'], cards: Card[]): HandRank => ({
    category,
    name: category,
    score: 0,
    cards,
  });

  it('upgrades an ace-high straight flush to royal-flush', () => {
    const royal = mk('straight-flush', [
      card('10', 'spades'), card('J', 'spades'), card('Q', 'spades'),
      card('K', 'spades'), card('A', 'spades'),
    ]);
    expect(royalAwareCategory(royal)).toBe('royal-flush');
  });

  it('keeps a lower straight flush as straight-flush', () => {
    const sf = mk('straight-flush', [
      card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'),
      card('8', 'hearts'), card('9', 'hearts'),
    ]);
    expect(royalAwareCategory(sf)).toBe('straight-flush');
  });

  it('passes through non-straight-flush categories unchanged', () => {
    const flush = mk('flush', [
      card('2', 'clubs'), card('5', 'clubs'), card('8', 'clubs'),
      card('J', 'clubs'), card('K', 'clubs'),
    ]);
    expect(royalAwareCategory(flush)).toBe('flush');
  });
});

function seat(over: Partial<GamePlayer>): GamePlayer {
  return {
    discordUserId: 'x', displayName: 'X', avatarUrl: '', seatIndex: 0,
    chipStack: 0, betThisRound: 0, totalBetThisHand: 0, holeCards: null,
    status: 'active', hasActed: true, ...over,
  };
}

function baseState(players: GamePlayer[]): GameState {
  return {
    gameId: 'G', instanceId: 'I', phase: 'hand-complete', players,
    communityCards: [], pots: [], currentPlayerIndex: 0, dealerIndex: 0,
    smallBlindIndex: 0, bigBlindIndex: 1, callAmount: 0, minRaise: 50,
    handNumber: 1, config: { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9 },
  };
}

describe('buildHandFacts', () => {
  it('records a fold-out: winner won, folder folded, no showdown category', () => {
    const players = [
      seat({ discordUserId: 'a', seatIndex: 0, totalBetThisHand: 25, status: 'folded' }),
      seat({ discordUserId: 'b', seatIndex: 1, totalBetThisHand: 50, status: 'active' }),
    ];
    const state = baseState(players);
    const result: ShowdownResult = {
      awards: [{ amount: 75, winnerIds: ['b'] }],
      winningsByPlayer: { b: 75 },
      hands: {},
    };
    const tracker = new HandStatsTracker(0);
    tracker.record('a', 'pre-flop', 'fold');

    const facts = buildHandFacts({ state, result, tracker, gameId: 'G', handNumber: 1, now: 5000 });
    const a = facts.find((f) => f.playerId === 'a')!;
    const b = facts.find((f) => f.playerId === 'b')!;

    expect(a.result).toBe('folded');
    expect(a.handCategory).toBeNull();
    expect(a.netResult).toBe(-25);
    expect(a.finalStreet).toBe('pre-flop');
    expect(b.result).toBe('won');
    expect(b.chipsWon).toBe(75);
    expect(b.netResult).toBe(25);
    expect(b.wentToShowdown).toBe(false);
    expect(b.potTotal).toBe(75);
    expect(b.durationMs).toBe(5000);
  });

  it('records a multiway showdown with category and showdown flag', () => {
    const players = [
      seat({ discordUserId: 'a', seatIndex: 0, totalBetThisHand: 100, status: 'active' }),
      seat({ discordUserId: 'b', seatIndex: 1, totalBetThisHand: 100, status: 'active' }),
    ];
    const state = baseState(players);
    state.communityCards = [
      { rank: '2', suit: 'clubs' }, { rank: '7', suit: 'hearts' },
      { rank: '9', suit: 'spades' }, { rank: 'J', suit: 'diamonds' },
      { rank: 'K', suit: 'clubs' },
    ];
    const result: ShowdownResult = {
      awards: [{ amount: 200, winnerIds: ['a'] }],
      winningsByPlayer: { a: 200 },
      hands: {
        a: { category: 'pair', name: 'Pair', score: 1, cards: [] },
        b: { category: 'high-card', name: 'High Card', score: 0, cards: [] },
      },
    };
    const facts = buildHandFacts({ state, result, tracker: new HandStatsTracker(0), gameId: 'G', handNumber: 1, now: 0 });
    const a = facts.find((f) => f.playerId === 'a')!;
    const b = facts.find((f) => f.playerId === 'b')!;

    expect(a.result).toBe('won');
    expect(a.wentToShowdown).toBe(true);
    expect(a.handCategory).toBe('pair');
    expect(a.finalStreet).toBe('showdown');
    expect(b.result).toBe('lost');
    expect(b.wentToShowdown).toBe(true);
    expect(b.handCategory).toBe('high-card');
  });

  it('skips sitting-out players', () => {
    const players = [
      seat({ discordUserId: 'a', seatIndex: 0, status: 'active', totalBetThisHand: 50 }),
      seat({ discordUserId: 'c', seatIndex: 1, status: 'sitting-out' }),
    ];
    const result: ShowdownResult = { awards: [{ amount: 50, winnerIds: ['a'] }], winningsByPlayer: { a: 50 }, hands: {} };
    const facts = buildHandFacts({ state: baseState(players), result, tracker: new HandStatsTracker(0), gameId: 'G', handNumber: 1, now: 0 });
    expect(facts.map((f) => f.playerId)).toEqual(['a']);
  });
});
