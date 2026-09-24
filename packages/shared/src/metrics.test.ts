import { describe, expect, it } from 'vitest';
import { parseCards, type Card } from './cards.js';
import {
  HAND_METRICS, METRIC_IDS, METRICS, getMetric, isEventMetric, isHandMetric, isMetricId, metricValue,
  type HandFact, type MetricId,
} from './metrics.js';

const fact = (over: Partial<HandFact> = {}): HandFact => ({
  tableId: 't', playerId: 'p', handNumber: 1, seat: 0, position: 0, bigBlind: 50,
  chipsContributed: 500, chipsWon: 1500, netResult: 1000, result: 'won', handCategory: 'flush',
  potTotal: 2000, wentToShowdown: true, vpip: true, pfr: true, aggressiveActions: 1,
  passiveActions: 0, wasAllIn: false, finalStreet: 'showdown', durationMs: 30_000, ...over,
});

const hole = (text: string) => parseCards(text) as [Card, Card];
const v = (id: MetricId, over: Partial<HandFact> = {}) => metricValue(id, fact(over));

const lost = { result: 'lost', netResult: -500, chipsWon: 0 } as const;
const folded = { result: 'folded', wentToShowdown: false, finalStreet: 'flop', handCategory: null } as const;
const steal = { wentToShowdown: false, finalStreet: 'turn', handCategory: null } as const;

describe('metric registry', () => {
  it('has every id once, with a hand evaluator exactly for hand metrics', () => {
    expect(new Set(METRIC_IDS).size).toBe(METRIC_IDS.length);
    expect(METRIC_IDS).toHaveLength(50);
    for (const id of METRIC_IDS) {
      const def = METRICS[id];
      expect(def.id).toBe(id);
      expect('hand' in def).toBe(def.source === 'hand');
      expect(isHandMetric(id)).toBe(!isEventMetric(id));
    }
    expect(HAND_METRICS.map((m) => m.id)).not.toContain('level');
    expect(isMetricId('level')).toBe(true);
    expect(isMetricId('nope')).toBe(false);
    expect(getMetric('nope')).toBeUndefined();
    expect(getMetric('win-streak')?.mode).toBe('streak');
  });

  it('marks event metrics with their modes', () => {
    expect(METRICS.level).toMatchObject({ source: 'event', mode: 'max' });
    expect(METRICS['daily-streak']).toMatchObject({ source: 'event', mode: 'max' });
    expect(METRICS['challenges-claimed']).toMatchObject({ source: 'event', mode: 'sum' });
    expect(METRICS['items-owned']).toMatchObject({ source: 'event', mode: 'max' });
    expect(METRICS['tier-v-count']).toMatchObject({ source: 'event', mode: 'max' });
    expect(v('level')).toBe(0);
  });
});

describe('volume and wins', () => {
  it('counts hands, wins, showdowns, flops and steals', () => {
    expect(v('hands-played', folded)).toBe(1);
    expect(v('hands-won')).toBe(1);
    expect(v('hands-won', lost)).toBe(0);
    expect(v('showdowns-won')).toBe(1);
    expect(v('showdowns-won', steal)).toBe(0);
    expect(v('flops-seen')).toBe(1);
    expect(v('flops-seen', { finalStreet: 'pre-flop' })).toBe(0);
    expect(v('steals', steal)).toBe(1);
    expect(v('steals')).toBe(0);
    expect(v('steals', { ...steal, result: 'folded' })).toBe(0);
  });

  it('counts minutes played', () => {
    expect(v('minutes-played', { durationMs: 90_000 })).toBe(1.5);
  });
});

describe('aggression', () => {
  it('reads the pre-flop raise, three-bet and check-raise flags', () => {
    expect(v('preflop-raises')).toBe(1);
    expect(v('preflop-raises', { pfr: false })).toBe(0);
    expect(v('three-bets')).toBe(0);
    expect(v('three-bets', { threeBet: true })).toBe(1);
    expect(v('check-raises')).toBe(0);
    expect(v('check-raises', { checkRaise: true, result: 'folded' })).toBe(1);
  });
});

describe('big game', () => {
  it('counts all-in wins', () => {
    expect(v('all-in-wins', { wasAllIn: true })).toBe(1);
    expect(v('all-in-wins', { wasAllIn: true, ...lost })).toBe(0);
    expect(v('all-in-wins')).toBe(0);
  });

  it('counts knockouts and multi-knockouts', () => {
    expect(v('knockouts')).toBe(0);
    expect(v('knockouts', { knockouts: 2 })).toBe(2);
    expect(v('multi-knockouts', { knockouts: 1 })).toBe(0);
    expect(v('multi-knockouts', { knockouts: 2 })).toBe(1);
  });

  it('counts double and quadruple ups from the starting stack', () => {
    expect(v('double-ups')).toBe(0); // no starting stack
    expect(v('double-ups', { startingStack: 1000, netResult: 1000 })).toBe(1);
    expect(v('double-ups', { startingStack: 1000, netResult: 999 })).toBe(0);
    expect(v('quadruple-ups', { startingStack: 1000, netResult: 2999 })).toBe(0);
    expect(v('quadruple-ups', { startingStack: 1000, netResult: 3000 })).toBe(1);
    expect(v('double-ups', { startingStack: 0, netResult: 1000 })).toBe(0);
  });

  it('counts pots by big blinds won', () => {
    expect(v('pots-30bb', { potTotal: 1500 })).toBe(1);
    expect(v('pots-30bb', { potTotal: 1499 })).toBe(0);
    expect(v('pots-30bb', { potTotal: 1500, ...lost })).toBe(0);
    expect(v('pots-50bb', { potTotal: 2500 })).toBe(1);
    expect(v('pots-100bb', { potTotal: 5000 })).toBe(1);
    expect(v('pots-100bb', { potTotal: 4999 })).toBe(0);
    expect(v('pots-250bb', { potTotal: 12_500 })).toBe(1);
    expect(v('pots-250bb', { potTotal: 12_500, bigBlind: 0 })).toBe(0);
  });

  it('counts big blinds won and net big blinds', () => {
    expect(v('bb-won')).toBe(20);
    expect(v('bb-won', lost)).toBe(0);
    expect(v('net-bb', lost)).toBe(-10);
    expect(v('net-bb', { bigBlind: 0 })).toBe(0);
    expect(v('bb-won', { bigBlind: 0 })).toBe(0);
  });
});

describe('made hands', () => {
  it('counts wins at showdown with a category or better', () => {
    expect(v('wins-two-pair-plus', { handCategory: 'two-pair' })).toBe(1);
    expect(v('wins-two-pair-plus', { handCategory: 'pair' })).toBe(0);
    expect(v('wins-trips-plus', { handCategory: 'three-of-a-kind' })).toBe(1);
    expect(v('wins-trips-plus', { handCategory: 'two-pair' })).toBe(0);
    expect(v('wins-trips-plus', { handCategory: 'royal-flush' })).toBe(1);
    expect(v('wins-straight-plus', { handCategory: 'straight' })).toBe(1);
    expect(v('wins-flush-plus', { handCategory: 'straight' })).toBe(0);
    expect(v('wins-flush-plus', { handCategory: 'flush' })).toBe(1);
    expect(v('wins-full-house-plus', { handCategory: 'four-of-a-kind' })).toBe(1);
    expect(v('wins-full-house-plus', { handCategory: 'flush' })).toBe(0);
    expect(v('wins-trips-plus', { handCategory: 'full-house', ...lost })).toBe(0);
    expect(v('wins-trips-plus', { ...steal, handCategory: 'full-house' })).toBe(0);
  });

  it('counts wins at showdown with an exact category', () => {
    expect(v('wins-straight', { handCategory: 'straight' })).toBe(1);
    expect(v('wins-straight', { handCategory: 'flush' })).toBe(0);
    expect(v('wins-flush')).toBe(1);
    expect(v('wins-flush', lost)).toBe(0);
    expect(v('wins-full-house', { handCategory: 'full-house' })).toBe(1);
    expect(v('wins-quads', { handCategory: 'four-of-a-kind' })).toBe(1);
    expect(v('wins-quads', { handCategory: 'full-house' })).toBe(0);
    expect(v('wins-straight-flush', { handCategory: 'straight-flush' })).toBe(1);
    expect(v('wins-straight-flush', { handCategory: 'royal-flush' })).toBe(0);
    expect(v('wins-royal-flush', { handCategory: 'royal-flush' })).toBe(1);
    expect(v('wins-royal-flush', { ...steal, handCategory: 'royal-flush' })).toBe(0);
  });

  it('spots four aces from hole cards and board', () => {
    const quads = { handCategory: 'four-of-a-kind', holeCards: hole('As Ad'), board: parseCards('Ah Ac 2d 7s 9h') } as const;
    expect(v('wins-four-aces', quads)).toBe(1);
    expect(v('wins-four-aces', { ...quads, holeCards: hole('Ks Kd'), board: parseCards('Kh Kc Ad 7s 9h') })).toBe(0);
    expect(v('wins-four-aces', { ...quads, ...lost })).toBe(0);
    expect(v('wins-four-aces', { ...quads, holeCards: null })).toBe(0);
    expect(v('wins-four-aces', { ...quads, holeCards: undefined })).toBe(0);
  });

  it('spots a wheel but not a six-high straight or a steel wheel', () => {
    const wheel = { handCategory: 'straight', holeCards: hole('As 2d'), board: parseCards('3h 4c 5d Ks Qh') } as const;
    expect(v('wins-wheel', wheel)).toBe(1);
    expect(v('wins-wheel', { ...wheel, board: parseCards('3h 4c 5d 6s Qh') })).toBe(0);
    expect(v('wins-wheel', { ...wheel, holeCards: hole('As 2s'), board: parseCards('3s 4s 5s Kd Qh') })).toBe(0);
    expect(v('wins-wheel', { ...wheel, ...lost })).toBe(0);
    expect(v('wins-wheel', { ...wheel, board: parseCards('3h 4c') })).toBe(0);
  });
});

describe('hole cards', () => {
  it('counts pocket pairs and suited wins', () => {
    expect(v('pocket-pair-wins', { holeCards: hole('9s 9d') })).toBe(1);
    expect(v('pocket-pair-wins', { holeCards: hole('9s 8d') })).toBe(0);
    expect(v('pocket-pair-wins', { holeCards: hole('9s 9d'), ...lost })).toBe(0);
    expect(v('pocket-pair-wins')).toBe(0);
    expect(v('suited-wins', { holeCards: hole('Js 4s') })).toBe(1);
    expect(v('suited-wins', { holeCards: hole('Js 4s'), ...steal })).toBe(0);
    expect(v('pocket-pair-wins', { holeCards: hole('9s 9d'), ...steal })).toBe(0);
    expect(v('suited-wins', { holeCards: hole('Js 4d') })).toBe(0);
    expect(v('suited-wins', { holeCards: null })).toBe(0);
  });

  it('counts seven-deuce offsuit wins at showdown', () => {
    expect(v('seven-deuce-wins', { holeCards: hole('7s 2d') })).toBe(1);
    expect(v('seven-deuce-wins', { holeCards: hole('2c 7h') })).toBe(1);
    expect(v('seven-deuce-wins', { holeCards: hole('7s 2s') })).toBe(0);
    expect(v('seven-deuce-wins', { holeCards: hole('7s 3d') })).toBe(0);
    expect(v('seven-deuce-wins', { holeCards: hole('7s 2d'), ...steal })).toBe(0);
  });

  it('counts cracked aces and rockets', () => {
    expect(v('aces-cracked', { holeCards: hole('As Ad'), ...lost })).toBe(1);
    expect(v('aces-cracked', { holeCards: hole('As Ad') })).toBe(0);
    expect(v('aces-cracked', { holeCards: hole('As Ad'), ...lost, wentToShowdown: false })).toBe(0);
    expect(v('aces-cracked', { holeCards: hole('As Kd'), ...lost })).toBe(0);
    expect(v('rockets-all-in-wins', { holeCards: hole('As Ad'), allInPreflop: true })).toBe(1);
    expect(v('rockets-all-in-wins', { holeCards: hole('As Ad'), allInPreflop: false, wasAllIn: true })).toBe(0);
    expect(v('rockets-all-in-wins', { holeCards: hole('As Ad'), allInPreflop: true, ...lost })).toBe(0);
    expect(v('rockets-all-in-wins', { holeCards: hole('As Kd'), allInPreflop: true })).toBe(0);
    expect(v('rockets-all-in-wins', { holeCards: hole('As Ad'), allInPreflop: true, ...steal })).toBe(0);
  });
});

describe('card privacy', () => {
  // Unlocks and activity are public, so without a showdown no metric may depend on the hole cards.
  const hands: HandFact['holeCards'][] = [hole('As Ad'), hole('7s 2d'), hole('Js 4s'), hole('9h 9c'), null, undefined];
  const noShowdown: Partial<HandFact>[] = [
    { ...steal, allInPreflop: true, wasAllIn: true },
    { ...steal, finalStreet: 'pre-flop', allInPreflop: true, knockouts: 1 },
    { ...folded, netResult: -100, chipsWon: 0 },
    { ...folded, finalStreet: 'river', allInPreflop: true, checkRaise: true },
    { ...lost, wentToShowdown: false, finalStreet: 'river', handCategory: null },
  ];
  const boards = [parseCards('Ah Ac 3h 4c 5d'), parseCards('Kh Qh Jh Th 9d'), []];

  it('gives every hand metric the same value for a non-showdown fact whatever the hole cards', () => {
    for (const m of HAND_METRICS) {
      for (const base of noShowdown) {
        for (const board of boards) {
          const values = hands.map((holeCards) => m.hand(fact({ ...base, board, holeCards })));
          expect(new Set(values), `${m.id} ${JSON.stringify(base)}`).toHaveProperty('size', 1);
        }
      }
    }
  });
});

describe('luck', () => {
  it('counts suckouts and all-in suckouts', () => {
    expect(v('suckouts', { behindOnTurn: true })).toBe(1);
    expect(v('suckouts')).toBe(0);
    expect(v('suckouts', { behindOnTurn: true, ...lost })).toBe(0);
    expect(v('all-in-suckouts', { behindOnTurn: true })).toBe(0);
    expect(v('all-in-suckouts', { behindOnTurn: true, wasAllIn: true })).toBe(1);
  });

  it('counts bad beats with a full house or better', () => {
    expect(v('bad-beats', { handCategory: 'full-house', ...lost })).toBe(1);
    expect(v('bad-beats', { handCategory: 'flush', ...lost })).toBe(0);
    expect(v('bad-beats', { handCategory: 'four-of-a-kind' })).toBe(0);
  });

  it('counts split pots at showdown', () => {
    expect(v('split-pots', { splitPot: true })).toBe(1);
    expect(v('split-pots', { splitPot: true, wentToShowdown: false })).toBe(0);
    expect(v('split-pots')).toBe(0);
  });

  it('counts multiway showdown wins', () => {
    expect(v('multiway-showdown-wins', { showdownOpponents: 3 })).toBe(1);
    expect(v('multiway-showdown-wins', { showdownOpponents: 2 })).toBe(0);
    expect(v('multiway-showdown-wins')).toBe(0);
    expect(v('multiway-showdown-wins', { showdownOpponents: 3, ...lost })).toBe(0);
  });
});

describe('streaks', () => {
  it('reports a hit or a miss per hand', () => {
    expect(METRICS['win-streak'].mode).toBe('streak');
    expect(v('win-streak')).toBe(1);
    expect(v('win-streak', lost)).toBe(0);
    expect(v('fold-streak', folded)).toBe(1);
    expect(v('fold-streak', lost)).toBe(0);
  });
});
