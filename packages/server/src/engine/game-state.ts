import type {
  Card,
  GamePlayer,
  GameState,
  PlayerAction,
  TableConfig,
} from '@poker/shared';
import { deal, freshShuffledDeck, type Rng } from './deck.js';
import { assignBlindPositions, postBlinds, nextActiveSeat } from './blinds.js';
import { potsFromPlayers } from './pot.js';
import { validateAction, applyActionToState } from './actions.js';

/**
 * Server-side hand context: the public `GameState` (safe to broadcast after
 * sanitization) plus the private `deck`, which must never reach clients.
 */
export interface HandContext {
  state: GameState;
  deck: Card[];
}

export interface PlayerSeed {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  seatIndex: number;
  chipStack: number;
}

export interface StartHandOptions {
  gameId: string;
  instanceId: string;
  handNumber: number;
  dealerIndex: number;
  seeds: PlayerSeed[];
  config: TableConfig;
  /** Provide a pre-built deck (e.g. for tests); otherwise a fresh shuffle is used. */
  deck?: Card[];
  rng?: Rng;
}

/** Deal a fresh hand: hole cards, blinds, and first action. */
export function startHand(opts: StartHandOptions): HandContext {
  const deck = opts.deck ?? freshShuffledDeck(opts.rng);

  const players: GamePlayer[] = opts.seeds.map((s) => ({
    discordUserId: s.discordUserId,
    displayName: s.displayName,
    avatarUrl: s.avatarUrl,
    seatIndex: s.seatIndex,
    chipStack: s.chipStack,
    betThisRound: 0,
    totalBetThisHand: 0,
    holeCards: null,
    status: s.chipStack > 0 ? 'active' : 'sitting-out',
    hasActed: false,
  }));

  for (const p of players) {
    if (p.status !== 'sitting-out') {
      const [a, b] = deal(deck, 2);
      p.holeCards = [a, b];
    }
  }

  const state: GameState = {
    gameId: opts.gameId,
    instanceId: opts.instanceId,
    phase: 'pre-flop',
    players,
    communityCards: [],
    pots: [],
    currentPlayerIndex: 0,
    dealerIndex: opts.dealerIndex,
    smallBlindIndex: 0,
    bigBlindIndex: 0,
    callAmount: 0,
    minRaise: opts.config.bigBlind,
    handNumber: opts.handNumber,
    config: opts.config,
  };

  assignBlindPositions(state);
  postBlinds(state);

  // First to act pre-flop is left of the big blind; heads-up it is the button.
  const eligible = players.filter((p) => p.status === 'active').length;
  state.currentPlayerIndex =
    eligible <= 2 ? state.dealerIndex : nextActiveSeat(state, state.bigBlindIndex);

  state.pots = potsFromPlayers(players);
  return { state, deck };
}

/** Players still contesting the pot (not folded, not sitting out). */
export function contenders(state: GameState): GamePlayer[] {
  return state.players.filter((p) => p.status !== 'folded' && p.status !== 'sitting-out');
}

/** Players who can still voluntarily act this street. */
function activePlayers(state: GameState): GamePlayer[] {
  return state.players.filter((p) => p.status === 'active');
}

export function isBettingRoundComplete(state: GameState): boolean {
  const active = activePlayers(state);
  if (active.length === 0) return true;
  return active.every((p) => p.hasActed && p.betThisRound === state.callAmount);
}

/** Next seat (cyclic) whose player can still act. */
function nextToAct(state: GameState, from: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (state.players[idx].status === 'active') return idx;
  }
  return from;
}

function dealNextStreet(ctx: HandContext): void {
  const { state, deck } = ctx;
  switch (state.phase) {
    case 'pre-flop':
      state.communityCards.push(...deal(deck, 3));
      state.phase = 'flop';
      break;
    case 'flop':
      state.communityCards.push(...deal(deck, 1));
      state.phase = 'turn';
      break;
    case 'turn':
      state.communityCards.push(...deal(deck, 1));
      state.phase = 'river';
      break;
    case 'river':
      state.phase = 'showdown';
      break;
  }
}

/**
 * Close the current betting round and open the next street. If betting can no
 * longer happen (everyone is all-in), the board is run out to showdown.
 */
export function advanceStreet(ctx: HandContext): void {
  const { state } = ctx;
  for (const p of state.players) {
    p.betThisRound = 0;
    p.hasActed = false;
  }
  state.callAmount = 0;
  state.minRaise = state.config.bigBlind;

  dealNextStreet(ctx);
  if (state.phase === 'showdown') return;

  state.currentPlayerIndex = nextToAct(state, state.dealerIndex);

  // No one left to bet — run the remaining streets out.
  if (activePlayers(state).length < 2) {
    advanceStreet(ctx);
  }
}

export type ActOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Validate and apply a player action, then progress the hand: detect a fold-out
 * win, advance the street when the round closes, or pass the turn.
 */
export function act(ctx: HandContext, playerId: string, action: PlayerAction): ActOutcome {
  const { state } = ctx;
  const validation = validateAction(state, playerId, action);
  if (!validation.valid) return { ok: false, reason: validation.reason! };

  applyActionToState(state, playerId, action);
  state.pots = potsFromPlayers(state.players);

  if (contenders(state).length <= 1) {
    state.phase = 'hand-complete';
    return { ok: true };
  }

  if (isBettingRoundComplete(state)) {
    advanceStreet(ctx);
  } else {
    state.currentPlayerIndex = nextToAct(state, state.currentPlayerIndex);
  }
  return { ok: true };
}
