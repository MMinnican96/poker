import type { Card, HandCategory, PlayerHandStat } from '@poker/shared';
import type { HandEvent, HandState } from '../engine/index.js';

type Street = PlayerHandStat['finalStreet'];

/** A stored hand for the history viewer. Cards of unshown opponents are filtered when served. */
export interface HandHistoryRecord {
  tableId: string;
  handNumber: number;
  board: Card[];
  pots: { amount: number; winnerIds: string[]; handLabel: string | null }[];
  players: {
    id: string;
    seat: number;
    cards: [Card, Card];
    shown: boolean;
    net: number;
    handLabel: string | null;
    result: 'won' | 'lost' | 'folded';
    /** Card-back item the player had equipped (absent on rows from before it was stored). */
    cardBack?: string;
  }[];
}

const VOLUNTARY = new Set(['call', 'bet', 'raise', 'all-in']);
const AGGRESSIVE = new Set(['bet', 'raise']);

function actions(log: HandEvent[], playerId: string) {
  return log.filter((e): e is Extract<HandEvent, { type: 'action' }> => e.type === 'action' && e.playerId === playerId);
}

/** An all-in counts as aggressive when it raised the bet, passive when it only called. */
function isAggressive(e: Extract<HandEvent, { type: 'action' }>, log: HandEvent[]): boolean {
  if (AGGRESSIVE.has(e.action)) return true;
  if (e.action !== 'all-in') return false;
  // Compare against the highest total on that street before this action.
  const idx = log.indexOf(e);
  let highest = 0;
  for (let i = 0; i < idx; i++) {
    const prior = log[i];
    if (prior.type === 'street') highest = 0;
    else if (prior.type === 'action' && prior.street === e.street) highest = Math.max(highest, prior.to);
    else if ((prior.type === 'small-blind' || prior.type === 'big-blind') && e.street === 'pre-flop') highest = Math.max(highest, prior.amount);
  }
  return e.to > highest;
}

/**
 * One fact per dealt-in player from a completed hand. Pure: timestamps injected.
 */
export function buildHandFacts(input: {
  state: HandState;
  tableId: string;
  startedAt: number;
  now: number;
}): PlayerHandStat[] {
  const { state, tableId, startedAt, now } = input;
  const result = state.result;
  if (!result) throw new Error('Hand is not complete');
  const n = state.players.length;
  const buttonIdx = state.players.findIndex((p) => p.seat === state.buttonSeat);
  const potTotal = result.pots.reduce((s, p) => s + p.amount, 0);

  return state.players.map((p, idx) => {
    const mine = actions(state.log, p.id);
    const chipsWon = result.payouts[p.id] ?? 0;
    const wentToShowdown = p.id in result.shown;
    const folded = p.folded;
    const foldEvent = mine.find((e) => e.action === 'fold');
    const lastStreet: Street = foldEvent
      ? (foldEvent.street as Street)
      : wentToShowdown ? 'showdown' : streetOf(state.board.length);
    const category: HandCategory | null = wentToShowdown ? result.shown[p.id].category : null;
    return {
      tableId,
      playerId: p.id,
      handNumber: state.handNumber,
      seat: p.seat,
      position: (idx - buttonIdx + n) % n,
      bigBlind: state.config.bigBlind,
      chipsContributed: p.total,
      chipsWon,
      netResult: chipsWon - p.total,
      result: chipsWon > 0 ? 'won' : folded ? 'folded' : 'lost',
      handCategory: category,
      potTotal,
      wentToShowdown,
      vpip: mine.some((e) => e.street === 'pre-flop' && VOLUNTARY.has(e.action)),
      pfr: mine.some((e) => e.street === 'pre-flop' && isAggressive(e, state.log)),
      aggressiveActions: mine.filter((e) => isAggressive(e, state.log)).length,
      passiveActions: mine.filter((e) => e.action === 'call' || (e.action === 'all-in' && !isAggressive(e, state.log))).length,
      wasAllIn: p.allIn || mine.some((e) => e.action === 'all-in') || p.stack === 0,
      finalStreet: lastStreet,
      durationMs: Math.max(0, now - startedAt),
    };
  });
}

function streetOf(boardCards: number): Street {
  if (boardCards >= 5) return 'river';
  if (boardCards === 4) return 'turn';
  if (boardCards === 3) return 'flop';
  return 'pre-flop';
}

/** `cardBacks` maps player id → equipped card-back item at hand time. */
export function buildHistory(state: HandState, tableId: string, cardBacks: Record<string, string> = {}): HandHistoryRecord {
  const result = state.result;
  if (!result) throw new Error('Hand is not complete');
  return {
    tableId,
    handNumber: state.handNumber,
    board: state.board,
    pots: result.pots.map((p) => ({ amount: p.amount, winnerIds: p.winnerIds, handLabel: p.handLabel })),
    players: state.players.map((p) => {
      const won = result.payouts[p.id] ?? 0;
      return {
        id: p.id,
        seat: p.seat,
        cards: p.cards,
        shown: p.id in result.shown,
        net: won - p.total,
        handLabel: result.shown[p.id]?.label ?? null,
        result: won > 0 ? 'won' : p.folded ? 'folded' : 'lost',
        ...(cardBacks[p.id] ? { cardBack: cardBacks[p.id] } : {}),
      };
    }),
  };
}
