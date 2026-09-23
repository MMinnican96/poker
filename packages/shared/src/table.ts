import type { Card } from './cards.js';
import type { HandCategory } from './hand-eval.js';
import type { Cosmetics } from './shop.js';

/** Table rules chosen by the host when opening the table. All amounts in chips. */
export interface TableRules {
  name: string;
  smallBlind: number;
  bigBlind: number;
  /** Per-player ante posted every hand; 0 for none. */
  ante: number;
  minBuyIn: number;
  maxBuyIn: number;
  /** Seats at the table, 2–9. */
  maxSeats: number;
  /** Seconds to act before the timer checks or folds; 10–120 in steps of 5. */
  turnSeconds: number;
  /** Shop felt item shown on the table. */
  feltId: string;
}

/** Blind levels the host can pick from (small, big). */
export const BLIND_LEVELS: readonly (readonly [number, number])[] = [
  [5, 10], [10, 20], [25, 50], [50, 100], [100, 200], [250, 500], [500, 1000],
];

export const DEFAULT_RULES: TableRules = {
  name: 'The back room',
  smallBlind: 25,
  bigBlind: 50,
  ante: 0,
  minBuyIn: 1000,
  maxBuyIn: 5000,
  maxSeats: 9,
  turnSeconds: 30,
  feltId: 'felt-classic',
};

export const RULE_LIMITS = {
  nameMax: 32,
  seatsMin: 2,
  seatsMax: 9,
  turnMin: 10,
  turnMax: 120,
  turnStep: 5,
  /** Buy-in bounds expressed in big blinds. */
  minBuyInBb: 10,
  maxBuyInBb: 500,
} as const;

export type RulesResult = { ok: true; rules: TableRules } | { ok: false; error: string };

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/**
 * Merge a patch onto base rules and validate the result as a whole. Unknown or
 * mistyped fields are rejected rather than silently ignored.
 */
export function validateRules(patch: Partial<TableRules>, base: TableRules = DEFAULT_RULES): RulesResult {
  const r: TableRules = { ...base, ...patch };
  const L = RULE_LIMITS;
  if (typeof r.name !== 'string') return { ok: false, error: 'Table name must be text.' };
  r.name = r.name.replace(/\s+/g, ' ').trim();
  if (r.name.length === 0 || r.name.length > L.nameMax) return { ok: false, error: `Table name must be 1–${L.nameMax} characters.` };
  if (!BLIND_LEVELS.some(([s, b]) => s === r.smallBlind && b === r.bigBlind)) {
    return { ok: false, error: 'Pick one of the listed blind levels.' };
  }
  if (!isInt(r.ante) || r.ante < 0 || r.ante > r.smallBlind) return { ok: false, error: 'The ante must be between 0 and the small blind.' };
  if (!isInt(r.minBuyIn) || !isInt(r.maxBuyIn)) return { ok: false, error: 'Buy-ins must be whole chip amounts.' };
  if (r.minBuyIn < r.bigBlind * L.minBuyInBb) return { ok: false, error: `The minimum buy-in must be at least ${L.minBuyInBb} big blinds.` };
  if (r.maxBuyIn > r.bigBlind * L.maxBuyInBb) return { ok: false, error: `The maximum buy-in can be at most ${L.maxBuyInBb} big blinds.` };
  if (r.maxBuyIn < r.minBuyIn) return { ok: false, error: 'The maximum buy-in must be at least the minimum.' };
  if (!isInt(r.maxSeats) || r.maxSeats < L.seatsMin || r.maxSeats > L.seatsMax) return { ok: false, error: `Seats must be ${L.seatsMin}–${L.seatsMax}.` };
  if (!isInt(r.turnSeconds) || r.turnSeconds < L.turnMin || r.turnSeconds > L.turnMax || r.turnSeconds % L.turnStep !== 0) {
    return { ok: false, error: `The turn timer must be ${L.turnMin}–${L.turnMax} seconds in steps of ${L.turnStep}.` };
  }
  if (typeof r.feltId !== 'string' || !r.feltId) return { ok: false, error: 'Pick a felt.' };
  return { ok: true, rules: r };
}

// ---------------------------------------------------------------------------
// Table view (what one viewer receives)
// ---------------------------------------------------------------------------

export type Street = 'pre-flop' | 'flop' | 'turn' | 'river' | 'showdown';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';

export interface PlayerAction {
  type: 'fold' | 'check' | 'call' | 'raise' | 'all-in';
  /** For `raise`: the total this street the player raises *to*. */
  amount?: number;
}

/** open = waiting for the host to deal the first hand; running = hands are dealt. */
export type TableStatus = 'open' | 'running';

/** A queued change that applies when the current hand ends. */
export type PendingChange = 'leave' | 'stand' | 'sit-out' | 'close' | null;

export interface PublicPlayer {
  id: string;
  name: string;
  avatarUrl: string;
  level: number;
  cosmetics: Cosmetics;
}

export interface SeatPlayer extends PublicPlayer {
  stack: number;
  /** waiting = seated but not dealt into the current hand. */
  state: 'playing' | 'waiting' | 'sitting-out';
  connected: boolean;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Chips put in on the current street. */
  committed: number;
  /** Visible hole cards (own, or revealed at showdown); null when hidden or none. */
  holeCards: [Card, Card] | null;
  /** True when the player holds cards the viewer can't see. */
  hasHiddenCards: boolean;
  lastAction: { type: ActionType; amount: number } | null;
  pending: PendingChange;
  /** Chips queued to be added before the next hand. */
  pendingTopUp: number;
}

export interface SeatView {
  seat: number;
  player: SeatPlayer | null;
}

export interface PotView {
  amount: number;
  eligibleIds: string[];
}

export interface ShownHand {
  cards: [Card, Card];
  category: HandCategory;
  label: string;
  /** The five cards making the hand, for highlighting. */
  best: Card[];
}

export interface PotResult {
  amount: number;
  winnerIds: string[];
  /** Label of the winning hand; null when uncontested. */
  handLabel: string | null;
}

export interface HandResultView {
  /** Net chips each winner collected this hand. */
  payouts: Record<string, number>;
  pots: PotResult[];
  /** Hands tabled at showdown (empty on a fold-out). */
  shown: Record<string, ShownHand>;
  /** Uncalled chips handed back. */
  returned: Record<string, number>;
  wentToShowdown: boolean;
}

export interface HandView {
  handNumber: number;
  street: Street;
  board: Card[];
  /** Settled pots (bets from the current street are still in front of players). */
  pots: PotView[];
  /** Everything in the middle plus all current-street bets. */
  potTotal: number;
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  toActSeat: number | null;
  /** Epoch ms when the acting player's time runs out. */
  actionEndsAt: number | null;
  currentBet: number;
  result: HandResultView | null;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  /** Additional chips needed to call (0 when checking is possible). */
  callAmount: number;
  canRaise: boolean;
  /** Smallest legal raise-to total (a short all-in may be below the usual minimum). */
  minRaiseTo: number;
  /** Largest raise-to total that anyone can still call. */
  maxRaiseTo: number;
  /** The player's total if they put in their whole stack. */
  allInTo: number;
}

export interface ViewerInfo {
  id: string;
  role: 'seated' | 'spectator';
  seat: number | null;
  /** Off-table chips. */
  bankroll: number;
  pending: PendingChange;
  sittingOut: boolean;
  legal: LegalActions | null;
}

export interface TableView {
  tableId: string;
  instanceId: string;
  rules: TableRules;
  status: TableStatus;
  hostId: string | null;
  seats: SeatView[];
  spectators: PublicPlayer[];
  hand: HandView | null;
  /** Hands dealt so far at this table. */
  handsDealt: number;
  you: ViewerInfo;
  /** Server clock at send time, so clients can correct deadline countdowns. */
  serverNow: number;
}

/** Visual effect broadcast to the table. */
export interface TableFx {
  id: string;
  kind: 'emote' | 'throw';
  fromId: string;
  toId?: string;
  /** Emote glyph for emotes; shop item id for throwables. */
  value: string;
}
