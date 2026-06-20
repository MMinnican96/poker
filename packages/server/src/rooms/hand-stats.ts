import type { ActionType, GamePhase, WonHandCategory, GameState, PlayerHandStat } from '@poker/shared';
import { rankValue } from '../engine/cards.js';
import type { HandRank } from '../engine/hand-evaluator.js';
import type { ShowdownResult } from '../engine/showdown.js';

interface RecordedAction {
  playerId: string;
  street: GamePhase;
  type: ActionType;
}

/**
 * Accumulates the per-action facts a hand's final state cannot reconstruct
 * (VPIP, PFR, aggression, fold street). Pure: no I/O, fully unit-tested.
 * Create one per hand; call `record` after each *applied* action.
 */
export class HandStatsTracker {
  readonly startedAt: number;
  private readonly actions: RecordedAction[] = [];

  constructor(startedAt: number) {
    this.startedAt = startedAt;
  }

  record(playerId: string, street: GamePhase, type: ActionType): void {
    this.actions.push({ playerId, street, type });
  }

  private forPlayer(playerId: string): RecordedAction[] {
    return this.actions.filter((a) => a.playerId === playerId);
  }

  /** Voluntarily put money in pre-flop (call/raise/all-in; blinds aren't recorded). */
  vpip(playerId: string): boolean {
    return this.forPlayer(playerId).some(
      (a) => a.street === 'pre-flop' && (a.type === 'call' || a.type === 'raise' || a.type === 'all-in'),
    );
  }

  /** Raised pre-flop. (An all-in pre-flop is treated as a raise.) */
  pfr(playerId: string): boolean {
    return this.forPlayer(playerId).some(
      (a) => a.street === 'pre-flop' && (a.type === 'raise' || a.type === 'all-in'),
    );
  }

  aggressiveActions(playerId: string): number {
    return this.forPlayer(playerId).filter((a) => a.type === 'raise' || a.type === 'all-in').length;
  }

  passiveActions(playerId: string): number {
    return this.forPlayer(playerId).filter((a) => a.type === 'call').length;
  }

  wasAllIn(playerId: string): boolean {
    return this.forPlayer(playerId).some((a) => a.type === 'all-in');
  }

  foldStreet(playerId: string): GamePhase | null {
    const fold = this.forPlayer(playerId).find((a) => a.type === 'fold');
    return fold ? fold.street : null;
  }
}

/**
 * Map an engine hand rank to a stat category, upgrading an ace-high straight
 * flush (10-J-Q-K-A) to `royal-flush`. The engine itself has no royal-flush tier.
 */
export function royalAwareCategory(rank: HandRank): WonHandCategory {
  if (rank.category === 'straight-flush') {
    const values = rank.cards.map((c) => rankValue(c.rank)).sort((a, b) => a - b);
    if (values[0] === 10 && values[values.length - 1] === 14) return 'royal-flush';
  }
  return rank.category;
}

/** Map a completed board's card count to the street it reached. */
function streetFromBoard(cardCount: number): GamePhase {
  if (cardCount >= 5) return 'river';
  if (cardCount === 4) return 'turn';
  if (cardCount === 3) return 'flop';
  return 'pre-flop';
}

/**
 * Assemble one PlayerHandStat per dealt-in player from the final state, the
 * showdown result, and the per-hand action tracker. Pure: `now` is injected.
 */
export function buildHandFacts(input: {
  state: GameState;
  result: ShowdownResult;
  tracker: HandStatsTracker;
  gameId: string;
  handNumber: number;
  now: number;
}): PlayerHandStat[] {
  const { state, result, tracker, gameId, handNumber, now } = input;
  const seatCount = state.players.length;
  const potTotal = result.awards.reduce((sum, a) => sum + a.amount, 0);
  const facts: PlayerHandStat[] = [];

  for (const p of state.players) {
    if (p.status === 'sitting-out') continue;

    const chipsWon = result.winningsByPlayer[p.discordUserId] ?? 0;
    const chipsContributed = p.totalBetThisHand;
    const folded = p.status === 'folded';
    const wentToShowdown = p.discordUserId in result.hands;
    const resultKind: PlayerHandStat['result'] = chipsWon > 0 ? 'won' : folded ? 'folded' : 'lost';
    const handCategory = wentToShowdown ? royalAwareCategory(result.hands[p.discordUserId]) : null;

    const foldStreet = tracker.foldStreet(p.discordUserId);
    const finalStreet: GamePhase =
      folded && foldStreet ? foldStreet
      : wentToShowdown ? 'showdown'
      : streetFromBoard(state.communityCards.length);

    facts.push({
      gameId,
      playerId: p.discordUserId,
      handNumber,
      seatIndex: p.seatIndex,
      position: (p.seatIndex - state.dealerIndex + seatCount) % seatCount,
      chipsContributed,
      chipsWon,
      netResult: chipsWon - chipsContributed,
      result: resultKind,
      handCategory,
      potTotal,
      wentToShowdown,
      vpip: tracker.vpip(p.discordUserId),
      pfr: tracker.pfr(p.discordUserId),
      aggressiveActions: tracker.aggressiveActions(p.discordUserId),
      passiveActions: tracker.passiveActions(p.discordUserId),
      wasAllIn: tracker.wasAllIn(p.discordUserId) || p.status === 'all-in',
      finalStreet,
      durationMs: now - tracker.startedAt,
    });
  }

  return facts;
}
