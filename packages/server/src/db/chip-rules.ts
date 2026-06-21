/**
 * True when applying `amount` to `current` would drive the balance below zero.
 * Credits (amount >= 0) never overdraw. Shared by the DB ledger and the
 * in-memory mock ledger so the non-negative invariant is identical in both.
 */
export function overdraws(current: number, amount: number): boolean {
  return amount < 0 && current + amount < 0;
}
