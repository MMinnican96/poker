import { overdraws } from '../db/chip-rules.js';
import type { ChipService } from './game.js';

/**
 * Authoritative in-memory chip ledger for dev/mock mode (no DATABASE_URL).
 * Tracks each player's real balance (seeded from their identity balance),
 * enforces the same non-negative + idempotency rules as the DB ledger, and
 * returns the true post-adjust balance so live chip data is correct without a DB.
 */
export class InMemoryChipService implements ChipService {
  private readonly balances = new Map<string, number>();
  private readonly applied = new Set<string>();

  /** Set the starting balance the first time we see a player; ignored afterwards. */
  seed(playerId: string, balance: number): void {
    if (!this.balances.has(playerId)) this.balances.set(playerId, balance);
  }

  balanceOf(playerId: string): number {
    return this.balances.get(playerId) ?? 0;
  }

  async adjust(input: {
    playerId: string;
    amount: number;
    type: string;
    idempotencyKey: string;
  }): Promise<{ applied: boolean; balance: number }> {
    const current = this.balances.get(input.playerId) ?? 0;
    if (this.applied.has(input.idempotencyKey)) return { applied: false, balance: current };
    if (overdraws(current, input.amount)) return { applied: false, balance: current };
    this.applied.add(input.idempotencyKey);
    const next = current + input.amount;
    this.balances.set(input.playerId, next);
    return { applied: true, balance: next };
  }
}
