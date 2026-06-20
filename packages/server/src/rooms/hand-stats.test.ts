import { describe, it, expect } from 'vitest';
import type { Card } from '@poker/shared';
import { HandStatsTracker, royalAwareCategory } from './hand-stats.js';
import type { HandRank } from '../engine/hand-evaluator.js';

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
