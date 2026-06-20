import type { ActionType, GamePhase, WonHandCategory } from '@poker/shared';
import { rankValue } from '../engine/cards.js';
import type { HandRank } from '../engine/hand-evaluator.js';

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
