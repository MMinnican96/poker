/**
 * The metric registry: what career challenges, feats and daily/weekly
 * challenges count. Each metric is defined once here and shared by all three.
 *
 * - `sum`: each hand (or event) adds a value to progress.
 * - `max`: progress = max(progress, value), for values read from state.
 * - `streak`: a per-hand hit (1) or miss (0). `current` counts consecutive
 *   hits and resets on a miss; progress is the best `current` ever.
 *
 * Card privacy: unlocks, completions and activity are public, so a metric may
 * read hole cards (or anything derived from them, like `behindOnTurn` or the
 * best five) only for hands that reached showdown, where the cards were
 * tabled. `metrics.test.ts` checks this for every hand metric.
 *
 * Hand metrics evaluate a `HandFact`. Event metrics (level, daily streak, ...)
 * have no hand evaluator; the server feeds them from the matching action.
 */
import { rankValue, type Card } from './cards.js';
import { categoryAtLeast, evaluateBest, type HandCategory } from './hand-eval.js';
import type { PlayerHandStat } from './social.js';

/**
 * One player's outcome for one hand, as the metrics see it. The optional
 * fields are newer than the stored facts: missing means false / 0, and the
 * hole-card and board metrics count nothing without hole cards.
 */
export interface HandFact extends PlayerHandStat {
  /** The player's hole cards (from hand history; not stored in the fact row). */
  holeCards?: [Card, Card] | null;
  /** The final board. */
  board?: Card[];
  /** Players dealt in. */
  playersDealt?: number;
  /** Stack at the deal, before blinds. */
  startingStack?: number;
  /** Opponents busted in a pot this player won a share of. */
  knockouts?: number;
  /** Checked, then raised later on the same street. */
  checkRaise?: boolean;
  /** Pre-flop aggression after another player had raised (blinds aren't raises). */
  threeBet?: boolean;
  /**
   * In a pre-flop all-in: went all-in pre-flop (action or blind), or called or
   * covered an opponent's pre-flop all-in and stayed in the hand.
   */
  allInPreflop?: boolean;
  /** Reached showdown behind at least one showdown opponent with four board cards. */
  behindOnTurn?: boolean;
  /** Won a share of a pot that had more than one winner. */
  splitPot?: boolean;
  /** Other players who reached showdown. */
  showdownOpponents?: number;
}

export type MetricMode = 'sum' | 'max' | 'streak';

export type HandMetricId =
  | 'hands-played' | 'hands-won' | 'showdowns-won' | 'flops-seen' | 'steals'
  | 'preflop-raises' | 'three-bets' | 'check-raises' | 'all-in-wins' | 'knockouts'
  | 'double-ups' | 'quadruple-ups'
  | 'pots-30bb' | 'pots-50bb' | 'pots-100bb' | 'pots-250bb'
  | 'bb-won' | 'net-bb' | 'minutes-played'
  | 'wins-two-pair-plus' | 'wins-trips-plus' | 'wins-straight-plus' | 'wins-flush-plus' | 'wins-full-house-plus'
  | 'wins-straight' | 'wins-flush' | 'wins-full-house' | 'wins-quads' | 'wins-straight-flush' | 'wins-royal-flush'
  | 'wins-four-aces' | 'wins-wheel'
  | 'pocket-pair-wins' | 'suited-wins' | 'suckouts' | 'all-in-suckouts' | 'seven-deuce-wins'
  | 'aces-cracked' | 'bad-beats' | 'split-pots' | 'rockets-all-in-wins'
  | 'multiway-showdown-wins' | 'multi-knockouts'
  | 'win-streak' | 'fold-streak';

export type EventMetricId = 'level' | 'daily-streak' | 'challenges-claimed' | 'items-owned' | 'tier-v-count';

export type MetricId = HandMetricId | EventMetricId;

export interface HandMetricDef {
  id: HandMetricId;
  source: 'hand';
  mode: 'sum' | 'streak';
  /** Sum metrics: the value this hand adds. Streak metrics: 1 for a hit, 0 for a miss. */
  hand: (f: HandFact) => number;
}

export interface EventMetricDef {
  id: EventMetricId;
  source: 'event';
  mode: 'sum' | 'max';
}

export type MetricDef = HandMetricDef | EventMetricDef;

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

const b = (v: boolean): number => (v ? 1 : 0);
const won = (f: HandFact) => f.result === 'won';
const sdWon = (f: HandFact) => won(f) && f.wentToShowdown;
const lostAtShowdown = (f: HandFact) => f.result === 'lost' && f.wentToShowdown;

function hole(f: HandFact): [Card, Card] | null {
  return f.holeCards && f.holeCards.length === 2 ? f.holeCards : null;
}

const pocketPair = (f: HandFact) => { const h = hole(f); return !!h && h[0].rank === h[1].rank; };
const suited = (f: HandFact) => { const h = hole(f); return !!h && h[0].suit === h[1].suit; };
const pocketAces = (f: HandFact) => { const h = hole(f); return !!h && h[0].rank === 'A' && h[1].rank === 'A'; };
const sevenDeuceOff = (f: HandFact) => {
  const h = hole(f);
  if (!h || h[0].suit === h[1].suit) return false;
  const ranks = [h[0].rank, h[1].rank].sort().join();
  return ranks === '2,7';
};

/** Best five from hole + board, or null when there aren't five cards to make one. */
function bestFive(f: HandFact) {
  const h = hole(f);
  const board = f.board ?? [];
  if (!h || h.length + board.length < 5) return null;
  return evaluateBest([...h, ...board]);
}

function isWheel(f: HandFact): boolean {
  const best = bestFive(f);
  if (!best || best.category !== 'straight') return false;
  const values = best.cards.map((c) => rankValue(c.rank)).sort((x, y) => x - y);
  return values.join() === '2,3,4,5,14';
}

function isFourAces(f: HandFact): boolean {
  const best = bestFive(f);
  return !!best && best.category === 'four-of-a-kind' && best.cards.filter((c) => c.rank === 'A').length === 4;
}

const catAtLeast = (f: HandFact, c: HandCategory) => !!f.handCategory && categoryAtLeast(f.handCategory, c);

const multiplied = (f: HandFact, times: number) => {
  const start = f.startingStack ?? 0;
  return start > 0 && start + f.netResult >= times * start;
};

const bigPot = (f: HandFact, bbs: number) => won(f) && f.bigBlind > 0 && f.potTotal >= bbs * f.bigBlind;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const hand = (id: HandMetricId, fn: (f: HandFact) => number, mode: 'sum' | 'streak' = 'sum'): HandMetricDef =>
  ({ id, source: 'hand', mode, hand: fn });
const event = (id: EventMetricId, mode: 'sum' | 'max'): EventMetricDef => ({ id, source: 'event', mode });

const DEFS: readonly MetricDef[] = [
  hand('hands-played', () => 1),
  hand('hands-won', (f) => b(won(f))),
  hand('showdowns-won', (f) => b(sdWon(f))),
  hand('flops-seen', (f) => b(f.finalStreet !== 'pre-flop')),
  hand('steals', (f) => b(won(f) && !f.wentToShowdown)),
  hand('preflop-raises', (f) => b(f.pfr)),
  hand('three-bets', (f) => b(!!f.threeBet)),
  hand('check-raises', (f) => b(!!f.checkRaise)),
  hand('all-in-wins', (f) => b(won(f) && f.wasAllIn)),
  hand('knockouts', (f) => Math.max(0, f.knockouts ?? 0)),
  hand('double-ups', (f) => b(multiplied(f, 2))),
  hand('quadruple-ups', (f) => b(multiplied(f, 4))),
  hand('pots-30bb', (f) => b(bigPot(f, 30))),
  hand('pots-50bb', (f) => b(bigPot(f, 50))),
  hand('pots-100bb', (f) => b(bigPot(f, 100))),
  hand('pots-250bb', (f) => b(bigPot(f, 250))),
  hand('bb-won', (f) => (f.bigBlind > 0 ? Math.max(0, f.netResult) / f.bigBlind : 0)),
  hand('net-bb', (f) => (f.bigBlind > 0 ? f.netResult / f.bigBlind : 0)),
  hand('minutes-played', (f) => Math.max(0, f.durationMs) / 60_000),
  hand('wins-two-pair-plus', (f) => b(sdWon(f) && catAtLeast(f, 'two-pair'))),
  hand('wins-trips-plus', (f) => b(sdWon(f) && catAtLeast(f, 'three-of-a-kind'))),
  hand('wins-straight-plus', (f) => b(sdWon(f) && catAtLeast(f, 'straight'))),
  hand('wins-flush-plus', (f) => b(sdWon(f) && catAtLeast(f, 'flush'))),
  hand('wins-full-house-plus', (f) => b(sdWon(f) && catAtLeast(f, 'full-house'))),
  hand('wins-straight', (f) => b(sdWon(f) && f.handCategory === 'straight')),
  hand('wins-flush', (f) => b(sdWon(f) && f.handCategory === 'flush')),
  hand('wins-full-house', (f) => b(sdWon(f) && f.handCategory === 'full-house')),
  hand('wins-quads', (f) => b(sdWon(f) && f.handCategory === 'four-of-a-kind')),
  hand('wins-straight-flush', (f) => b(sdWon(f) && f.handCategory === 'straight-flush')),
  hand('wins-royal-flush', (f) => b(sdWon(f) && f.handCategory === 'royal-flush')),
  hand('wins-four-aces', (f) => b(sdWon(f) && isFourAces(f))),
  hand('wins-wheel', (f) => b(sdWon(f) && isWheel(f))),
  hand('pocket-pair-wins', (f) => b(sdWon(f) && pocketPair(f))),
  hand('suited-wins', (f) => b(sdWon(f) && suited(f))),
  hand('suckouts', (f) => b(sdWon(f) && !!f.behindOnTurn)),
  hand('all-in-suckouts', (f) => b(sdWon(f) && !!f.behindOnTurn && f.wasAllIn)),
  hand('seven-deuce-wins', (f) => b(sdWon(f) && sevenDeuceOff(f))),
  hand('aces-cracked', (f) => b(lostAtShowdown(f) && pocketAces(f))),
  hand('bad-beats', (f) => b(lostAtShowdown(f) && catAtLeast(f, 'full-house'))),
  hand('split-pots', (f) => b(!!f.splitPot && f.wentToShowdown)),
  hand('rockets-all-in-wins', (f) => b(sdWon(f) && pocketAces(f) && !!f.allInPreflop)),
  hand('multiway-showdown-wins', (f) => b(sdWon(f) && (f.showdownOpponents ?? 0) >= 3)),
  hand('multi-knockouts', (f) => b((f.knockouts ?? 0) >= 2)),
  hand('win-streak', (f) => b(won(f)), 'streak'),
  hand('fold-streak', (f) => b(f.result === 'folded'), 'streak'),
  event('level', 'max'),
  event('daily-streak', 'max'),
  event('challenges-claimed', 'sum'),
  event('items-owned', 'max'),
  event('tier-v-count', 'max'),
];

export const METRICS: Readonly<Record<MetricId, MetricDef>> =
  Object.fromEntries(DEFS.map((d) => [d.id, d])) as Record<MetricId, MetricDef>;

/** Every metric id, in registry order. */
export const METRIC_IDS: readonly MetricId[] = DEFS.map((d) => d.id);

/** Hand metrics only: the ones the recorder evaluates per fact. */
export const HAND_METRICS: readonly HandMetricDef[] = DEFS.filter((d): d is HandMetricDef => d.source === 'hand');

export function isMetricId(id: string): id is MetricId {
  return Object.prototype.hasOwnProperty.call(METRICS, id);
}

export function getMetric(id: string): MetricDef | undefined {
  return isMetricId(id) ? METRICS[id] : undefined;
}

export function isHandMetric(id: MetricId): id is HandMetricId {
  return METRICS[id].source === 'hand';
}

export function isEventMetric(id: MetricId): id is EventMetricId {
  return METRICS[id].source === 'event';
}

/** A hand metric's value for one fact (0 for event metrics). */
export function metricValue(id: MetricId, f: HandFact): number {
  const def = METRICS[id];
  return def.source === 'hand' ? def.hand(f) : 0;
}
