import { evaluateBest, type Card, type HandCategory, type HandFact, type PlayerHandStat } from '@poker/shared';
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

type ActionEvent = Extract<HandEvent, { type: 'action' }>;

/** Checked, then raised (a raise, or an all-in that raised) later on the same street. */
function checkRaised(mine: ActionEvent[], log: HandEvent[]): boolean {
  const checked = new Set<string>();
  for (const e of mine) {
    if (e.action === 'check') checked.add(e.street);
    else if (checked.has(e.street) && e.action !== 'bet' && isAggressive(e, log)) return true;
  }
  return false;
}

/** Pre-flop aggression after another player had already raised (blinds are not raises). */
function threeBet(playerId: string, log: HandEvent[]): boolean {
  let raisedBefore = false;
  for (const e of log) {
    if (e.type !== 'action' || e.street !== 'pre-flop') continue;
    const aggressive = isAggressive(e, log);
    if (e.playerId === playerId) {
      if (aggressive && raisedBefore) return true;
    } else if (aggressive) {
      raisedBefore = true;
    }
  }
  return false;
}

/**
 * Players who went all-in pre-flop: an all-in action on that street, or forced
 * bets (antes and blinds) that took their whole starting stack. The engine logs
 * a shove that only covers the others as a raise or a call, so it isn't here;
 * that player is credited by covering an opponent's all-in instead.
 */
function allInPreflop(state: HandState, payouts: Record<string, number>): Set<string> {
  const out = new Set<string>();
  for (const e of state.log) {
    if (e.type === 'action' && e.street === 'pre-flop' && e.action === 'all-in') out.add(e.playerId);
  }
  for (const p of state.players) {
    const forced = state.log.reduce((s, e) => (
      (e.type === 'ante' || e.type === 'small-blind' || e.type === 'big-blind') && e.playerId === p.id ? s + e.amount : s
    ), 0);
    const startingStack = p.stack + p.total - (payouts[p.id] ?? 0);
    if (forced > 0 && forced >= startingStack) out.add(p.id);
  }
  return out;
}

/**
 * One fact per dealt-in player from a completed hand. Pure: timestamps injected.
 * Hole cards and the board ride along for the achievement metrics; the fact
 * table doesn't store them (hand history does).
 */
export function buildHandFacts(input: {
  state: HandState;
  tableId: string;
  startedAt: number;
  now: number;
}): HandFact[] {
  const { state, tableId, startedAt, now } = input;
  const result = state.result;
  if (!result) throw new Error('Hand is not complete');
  const n = state.players.length;
  const buttonIdx = state.players.findIndex((p) => p.seat === state.buttonSeat);
  const potTotal = result.pots.reduce((s, p) => s + p.amount, 0);
  const showdownIds = Object.keys(result.shown);
  const busted = new Set(state.players.filter((p) => p.stack === 0).map((p) => p.id));
  const shovedPreflop = allInPreflop(state, result.payouts);
  // Each shown hand scored on the first four board cards (for "behind on the turn").
  const turnScores = result.wentToShowdown && state.board.length === 5
    ? new Map(state.players.filter((p) => p.id in result.shown)
      .map((p) => [p.id, evaluateBest([...p.cards, ...state.board.slice(0, 4)]).score]))
    : null;

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
    // Final stack = start - chips put in + chips collected (uncalled chips are already back).
    const startingStack = p.stack + p.total - chipsWon;
    const potsWon = result.pots.filter((pot) => pot.winnerIds.includes(p.id));
    const knockedOut = new Set(potsWon.flatMap((pot) => pot.eligibleIds.filter((id) => id !== p.id && busted.has(id))));
    const myTurnScore = turnScores?.get(p.id);
    const inPreflopAllIn = shovedPreflop.has(p.id)
      || (!folded && [...shovedPreflop].some((id) => id !== p.id));
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
      holeCards: [p.cards[0], p.cards[1]],
      board: state.board.slice(),
      playersDealt: n,
      startingStack,
      knockouts: knockedOut.size,
      checkRaise: checkRaised(mine, state.log),
      threeBet: threeBet(p.id, state.log),
      allInPreflop: inPreflopAllIn,
      behindOnTurn: myTurnScore !== undefined
        && [...turnScores!].some(([id, score]) => id !== p.id && score > myTurnScore),
      splitPot: potsWon.some((pot) => pot.winnerIds.length > 1),
      showdownOpponents: wentToShowdown ? showdownIds.filter((id) => id !== p.id).length : 0,
    };
  });
}

/** The columns of a fact as stored in `player_hand_stats` (hole cards and board live in hand history). */
export function factColumns(f: HandFact) {
  return {
    tableId: f.tableId, playerId: f.playerId, handNumber: f.handNumber, seat: f.seat,
    position: f.position, bigBlind: f.bigBlind, chipsContributed: f.chipsContributed,
    chipsWon: f.chipsWon, netResult: f.netResult, result: f.result, handCategory: f.handCategory,
    potTotal: f.potTotal, wentToShowdown: f.wentToShowdown, vpip: f.vpip, pfr: f.pfr,
    aggressiveActions: f.aggressiveActions, passiveActions: f.passiveActions,
    wasAllIn: f.wasAllIn, finalStreet: f.finalStreet, durationMs: f.durationMs,
    playersDealt: f.playersDealt ?? null,
    startingStack: f.startingStack ?? null,
    knockouts: f.knockouts ?? null,
    checkRaise: f.checkRaise ?? null,
    threeBet: f.threeBet ?? null,
    allInPreflop: f.allInPreflop ?? null,
    behindOnTurn: f.behindOnTurn ?? null,
    splitPot: f.splitPot ?? null,
    showdownOpponents: f.showdownOpponents ?? null,
  };
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
