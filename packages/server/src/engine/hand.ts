import {
  evaluateBest,
  type ActionType,
  type Card,
  type HandRank,
  type LegalActions,
  type PlayerAction,
  type Street,
} from '@poker/shared';
import { draw, shuffle, createDeck, type RandomInt } from './deck.js';
import { buildPots, uncalledExcess, type Pot } from './pots.js';

export interface HandConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface EnginePlayer {
  id: string;
  seat: number;
  /** Chips behind (not yet committed). */
  stack: number;
  /** Chips committed on the current street. */
  committed: number;
  /** Chips committed this hand (antes, blinds and every street). */
  total: number;
  cards: [Card, Card];
  folded: boolean;
  allIn: boolean;
  /** Has made a voluntary action since the street started or betting was reopened. */
  acted: boolean;
  /** The bet level the player faced after their last action (for raise rights). */
  actedAtBet: number;
  lastAction: { type: ActionType; amount: number } | null;
}

export type HandEvent =
  | { type: 'ante' | 'small-blind' | 'big-blind'; playerId: string; amount: number }
  | { type: 'action'; playerId: string; street: Street; action: ActionType; amount: number; to: number }
  | { type: 'street'; street: Street; cards: Card[] }
  | { type: 'uncalled'; playerId: string; amount: number };

export interface PotAward {
  amount: number;
  eligibleIds: string[];
  winnerIds: string[];
  /** Winning hand label; null when uncontested. */
  handLabel: string | null;
}

export interface HandResult {
  pots: PotAward[];
  /** Chips each player collected from the pots. */
  payouts: Record<string, number>;
  /** Uncalled chips returned to a player. */
  returned: Record<string, number>;
  /** Hands tabled at showdown. Empty for a fold-out. */
  shown: Record<string, HandRank>;
  wentToShowdown: boolean;
}

/**
 * betting  — `toAct` must act.
 * dealing  — the betting round is over; call `progress` to deal on.
 * complete — the hand is settled; `result` is set.
 */
export type HandPhase = 'betting' | 'dealing' | 'complete';

export interface HandState {
  handNumber: number;
  config: HandConfig;
  /** Dealt-in players ordered by seat (clockwise). */
  players: EnginePlayer[];
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  street: Street;
  board: Card[];
  /** Highest total committed on this street. */
  currentBet: number;
  /** Size of the last full bet or raise (the minimum raise increment). */
  lastRaiseSize: number;
  /** Index into `players` of whoever must act, or null. */
  toAct: number | null;
  phase: HandPhase;
  result: HandResult | null;
  log: HandEvent[];
}

/** Server-side hand: the state plus the private deck, which never leaves the server. */
export interface Hand {
  state: HandState;
  deck: Card[];
}

export interface StartHandOptions {
  handNumber: number;
  buttonSeat: number;
  players: { id: string; seat: number; stack: number }[];
  config: HandConfig;
  /** A stacked deck (top first) for tests; otherwise a fresh shuffle. */
  deck?: Card[];
  random?: RandomInt;
}

const canAct = (p: EnginePlayer) => !p.folded && !p.allIn;

/** Deal a new hand: antes, blinds, hole cards, and the first player to act. */
export function startHand(opts: StartHandOptions): Hand {
  const seated = opts.players.filter((p) => p.stack > 0).sort((a, b) => a.seat - b.seat);
  if (seated.length < 2) throw new Error('A hand needs at least two players with chips');
  if (new Set(seated.map((p) => p.seat)).size !== seated.length) throw new Error('Duplicate seats');
  const buttonIdx = seated.findIndex((p) => p.seat === opts.buttonSeat);
  if (buttonIdx === -1) throw new Error('The button must be on a dealt-in seat');

  const deck = opts.deck ? opts.deck.slice() : shuffle(createDeck(), opts.random);
  const n = seated.length;
  const players: EnginePlayer[] = seated.map((p) => ({
    id: p.id, seat: p.seat, stack: p.stack, committed: 0, total: 0,
    cards: undefined as unknown as [Card, Card],
    folded: false, allIn: false, acted: false, actedAtBet: 0, lastAction: null,
  }));

  // One card at a time, starting left of the button.
  const dealOrder = Array.from({ length: n }, (_, i) => players[(buttonIdx + 1 + i) % n]);
  const first = dealOrder.map(() => draw(deck, 1)[0]);
  const second = dealOrder.map(() => draw(deck, 1)[0]);
  dealOrder.forEach((p, i) => { p.cards = [first[i], second[i]]; });

  // Heads-up the button is the small blind.
  const sbIdx = n === 2 ? buttonIdx : (buttonIdx + 1) % n;
  const bbIdx = (sbIdx + 1) % n;

  const state: HandState = {
    handNumber: opts.handNumber,
    config: opts.config,
    players,
    buttonSeat: opts.buttonSeat,
    smallBlindSeat: players[sbIdx].seat,
    bigBlindSeat: players[bbIdx].seat,
    street: 'pre-flop',
    board: [],
    currentBet: 0,
    lastRaiseSize: opts.config.bigBlind,
    toAct: null,
    phase: 'betting',
    result: null,
    log: [],
  };

  if (opts.config.ante > 0) {
    // Antes go to the pot but do not count toward the bet to call.
    for (const p of dealOrder) {
      const amount = Math.min(opts.config.ante, p.stack);
      p.stack -= amount;
      p.total += amount;
      if (p.stack === 0) p.allIn = true;
      state.log.push({ type: 'ante', playerId: p.id, amount });
    }
  }
  postBlind(state, players[sbIdx], opts.config.smallBlind, 'small-blind');
  postBlind(state, players[bbIdx], opts.config.bigBlind, 'big-blind');
  // The bet to call is the full big blind even if the big blind is short.
  state.currentBet = opts.config.bigBlind;

  // Pre-flop action starts left of the big blind (heads-up: the button/small blind).
  const firstIdx = (bbIdx + 1) % n;
  settleTurn(state, firstIdx);
  return { state, deck };
}

function postBlind(state: HandState, p: EnginePlayer, blind: number, type: 'small-blind' | 'big-blind'): void {
  const amount = Math.min(blind, p.stack);
  p.stack -= amount;
  p.committed += amount;
  p.total += amount;
  if (p.stack === 0) p.allIn = true;
  state.log.push({ type, playerId: p.id, amount });
}

/** The actions available to whoever is to act, or null if nobody is. */
export function legalActions(state: HandState): LegalActions | null {
  if (state.phase !== 'betting' || state.toAct === null) return null;
  const p = state.players[state.toAct];
  const toCall = Math.max(0, state.currentBet - p.committed);
  const allInTo = p.committed + p.stack;
  const responders = state.players.filter((o) => o !== p && canAct(o));
  const raiseRightsOpen = !p.acted || state.currentBet - p.actedAtBet >= state.lastRaiseSize;
  const canRaise = responders.length > 0 && raiseRightsOpen && allInTo > state.currentBet;
  const minRaiseTo = Math.min(state.currentBet + state.lastRaiseSize, allInTo);
  // Beyond what any opponent can match, extra chips would only be returned.
  const cover = Math.max(0, ...responders.map((o) => o.committed + o.stack));
  const maxRaiseTo = Math.min(allInTo, Math.max(cover, minRaiseTo));
  return {
    canFold: true,
    canCheck: toCall === 0,
    callAmount: Math.min(toCall, p.stack),
    canRaise,
    minRaiseTo: canRaise ? minRaiseTo : 0,
    maxRaiseTo: canRaise ? maxRaiseTo : 0,
    allInTo,
  };
}

export type ActResult = { ok: true } | { ok: false; error: string };

/**
 * Apply one action for the player to act. `all-in` means "as much as matters":
 * a raise to the most anyone can call, or a call when raising isn't possible.
 */
export function applyAction(hand: Hand, playerId: string, action: PlayerAction): ActResult {
  const { state } = hand;
  const legal = legalActions(state);
  if (!legal || state.toAct === null) return { ok: false, error: 'No action is expected right now.' };
  const p = state.players[state.toAct];
  if (p.id !== playerId) return { ok: false, error: "It isn't your turn." };

  let type = action.type;
  let raiseTo = 0;
  if (type === 'all-in') {
    if (legal.canRaise) { type = 'raise'; raiseTo = legal.maxRaiseTo; }
    else if (legal.callAmount > 0) type = 'call';
    else type = 'check';
  } else if (type === 'raise') {
    if (!legal.canRaise) return { ok: false, error: "You can't raise here." };
    if (typeof action.amount !== 'number' || !Number.isInteger(action.amount)) {
      return { ok: false, error: 'Raise amounts must be whole chips.' };
    }
    raiseTo = action.amount;
    if (raiseTo < legal.minRaiseTo) return { ok: false, error: `The minimum raise is to ${legal.minRaiseTo}.` };
    if (raiseTo > legal.maxRaiseTo) return { ok: false, error: `The maximum raise is to ${legal.maxRaiseTo}.` };
  }

  const betBefore = state.currentBet;
  const committedBefore = p.committed;
  let shown: ActionType;
  switch (type) {
    case 'fold':
      p.folded = true;
      shown = 'fold';
      break;
    case 'check':
      if (!legal.canCheck) return { ok: false, error: "You can't check facing a bet." };
      shown = 'check';
      break;
    case 'call':
      if (legal.callAmount === 0) return { ok: false, error: 'There is nothing to call.' };
      commit(p, legal.callAmount);
      shown = p.allIn ? 'all-in' : 'call';
      break;
    case 'raise': {
      commit(p, raiseTo - p.committed);
      const increment = raiseTo - betBefore;
      if (increment >= state.lastRaiseSize) {
        // A full bet/raise: reopens betting for everyone else.
        state.lastRaiseSize = increment;
        for (const o of state.players) if (o !== p && canAct(o)) o.acted = false;
      }
      state.currentBet = raiseTo;
      shown = p.allIn ? 'all-in' : betBefore === 0 ? 'bet' : 'raise';
      break;
    }
    default:
      return { ok: false, error: 'Unknown action.' };
  }

  p.acted = true;
  p.actedAtBet = state.currentBet;
  p.lastAction = { type: shown, amount: p.committed };
  state.log.push({
    type: 'action', playerId: p.id, street: state.street, action: shown,
    amount: p.committed - committedBefore, to: p.committed,
  });

  settleTurn(state, (state.toAct + 1) % state.players.length);
  return { ok: true };
}

function commit(p: EnginePlayer, amount: number): void {
  const pay = Math.min(amount, p.stack);
  p.stack -= pay;
  p.committed += pay;
  p.total += pay;
  if (p.stack === 0) p.allIn = true;
}

/** After an action (or at a street start), decide whether the hand ends, the round closes, or who acts next. */
function settleTurn(state: HandState, fromIdx: number): void {
  if (state.players.filter((p) => !p.folded).length === 1) {
    finish(state, false);
    return;
  }
  if (bettingRoundOver(state)) {
    state.toAct = null;
    state.phase = 'dealing';
    return;
  }
  state.toAct = nextActor(state, fromIdx);
  state.phase = 'betting';
}

function nextActor(state: HandState, fromIdx: number): number {
  const n = state.players.length;
  for (let step = 0; step < n; step++) {
    const idx = (fromIdx + step) % n;
    const p = state.players[idx];
    if (canAct(p) && needsToAct(state, p)) return idx;
  }
  throw new Error('No player can act but the round is not over');
}

function needsToAct(state: HandState, p: EnginePlayer): boolean {
  return !p.acted || p.committed < state.currentBet;
}

function bettingRoundOver(state: HandState): boolean {
  const live = state.players.filter((p) => !p.folded);
  const active = live.filter((p) => !p.allIn);
  if (active.length === 0) return true;
  if (active.length === 1) {
    // Nobody left to bet against: the lone active player only needs to match.
    const p = active[0];
    const othersMax = Math.max(0, ...live.filter((o) => o !== p).map((o) => o.committed));
    return p.committed >= othersMax;
  }
  return active.every((p) => !needsToAct(state, p));
}

/**
 * Advance a hand whose betting round is over: return uncalled chips, deal the
 * next street (with a burn), or settle at showdown.
 *
 * Returns what happens next: `betting` (someone must act), `runout` (a street
 * was dealt but nobody can bet — call again), or `complete`.
 */
export function progress(hand: Hand): 'betting' | 'runout' | 'complete' {
  const { state, deck } = hand;
  if (state.phase === 'complete') return 'complete';
  if (state.phase !== 'dealing') return 'betting';

  returnUncalled(state);
  for (const p of state.players) {
    p.committed = 0;
    p.acted = false;
    p.actedAtBet = 0;
    p.lastAction = null;
  }
  state.currentBet = 0;
  state.lastRaiseSize = state.config.bigBlind;

  const next: Record<Street, Street> = {
    'pre-flop': 'flop', flop: 'turn', turn: 'river', river: 'showdown', showdown: 'showdown',
  };
  const street = next[state.street];
  if (street === 'showdown') {
    finish(state, true);
    return 'complete';
  }
  draw(deck, 1); // burn
  const cards = draw(deck, street === 'flop' ? 3 : 1);
  state.board.push(...cards);
  state.street = street;
  state.log.push({ type: 'street', street, cards });

  const active = state.players.filter(canAct);
  if (active.length < 2) {
    state.phase = 'dealing';
    state.toAct = null;
    return 'runout';
  }
  // Post-flop action starts left of the button.
  const buttonIdx = state.players.findIndex((p) => p.seat === state.buttonSeat);
  state.phase = 'betting';
  state.toAct = nextActor(state, (buttonIdx + 1) % state.players.length);
  return 'betting';
}

function contributions(state: HandState) {
  return state.players.map((p) => ({ playerId: p.id, amount: p.total, folded: p.folded }));
}

function returnUncalled(state: HandState): void {
  const excess = uncalledExcess(contributions(state));
  if (!excess) return;
  const p = state.players.find((x) => x.id === excess.playerId)!;
  p.total -= excess.amount;
  p.committed -= excess.amount;
  p.stack += excess.amount;
  if (p.stack > 0) p.allIn = false;
  state.log.push({ type: 'uncalled', playerId: p.id, amount: excess.amount });
}

/** Settle the hand: award every pot and credit stacks. */
function finish(state: HandState, showdown: boolean): void {
  returnUncalled(state);
  const returned: Record<string, number> = {};
  for (const e of state.log) {
    if (e.type === 'uncalled') returned[e.playerId] = (returned[e.playerId] ?? 0) + e.amount;
  }

  const live = state.players.filter((p) => !p.folded);
  const pots: Pot[] = buildPots(contributions(state));
  const shown: Record<string, HandRank> = {};
  if (showdown) {
    for (const p of live) shown[p.id] = evaluateBest([...p.cards, ...state.board]);
  }

  // Odd chips go to winners in order clockwise from the button's left.
  const n = state.players.length;
  const buttonIdx = state.players.findIndex((p) => p.seat === state.buttonSeat);
  const order = (id: string) => {
    const idx = state.players.findIndex((p) => p.id === id);
    return (idx - buttonIdx - 1 + n) % n;
  };

  const payouts: Record<string, number> = {};
  const awards: PotAward[] = [];
  for (const pot of pots) {
    let eligible = pot.eligibleIds;
    if (eligible.length === 0) eligible = live.map((p) => p.id); // defensive; unreachable after uncalled return
    let winners: string[];
    let handLabel: string | null = null;
    if (eligible.length === 1 || !showdown) {
      winners = eligible.length === 1 ? eligible : [live[0].id];
    } else {
      const best = Math.max(...eligible.map((id) => shown[id].score));
      winners = eligible.filter((id) => shown[id].score === best);
      handLabel = shown[winners[0]].label;
    }
    winners.sort((a, b) => order(a) - order(b));
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const id of winners) {
      const amount = share + (odd > 0 ? 1 : 0);
      if (odd > 0) odd--;
      payouts[id] = (payouts[id] ?? 0) + amount;
    }
    awards.push({ amount: pot.amount, eligibleIds: pot.eligibleIds, winnerIds: winners, handLabel });
  }

  for (const p of state.players) {
    p.stack += payouts[p.id] ?? 0;
    p.committed = 0;
  }
  state.toAct = null;
  state.phase = 'complete';
  if (showdown) state.street = 'showdown';
  state.result = { pots: awards, payouts, returned, shown, wentToShowdown: showdown };
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** Pots from chips already gathered in the middle (excludes current-street bets). */
export function settledPots(state: HandState): Pot[] {
  return buildPots(state.players.map((p) => ({
    playerId: p.id, amount: p.total - p.committed, folded: p.folded,
  })));
}

/** Everything in the middle plus bets in front of players. */
export function potTotal(state: HandState): number {
  return state.players.reduce((s, p) => s + p.total, 0);
}

/** The next button: the first dealt-in seat clockwise after the previous one. */
export function nextButton(previous: number | null, seats: number[]): number {
  const sorted = [...seats].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('No seats');
  if (previous === null) return sorted[0];
  return sorted.find((s) => s > previous) ?? sorted[0];
}
