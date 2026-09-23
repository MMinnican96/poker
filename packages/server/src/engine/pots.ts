export interface Contribution {
  playerId: string;
  /** Total chips this player put in this hand. */
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Players who can win this pot (contributed to its level and did not fold). */
  eligibleIds: string[];
}

/**
 * Build the main pot and side pots by slicing contributions into layers at each
 * distinct contribution level. Folded players' chips stay in the layers they
 * paid into but they are never eligible. Adjacent layers with the same eligible
 * set are merged, giving the conventional "main pot + side pots".
 *
 * Callers return uncalled chips first (see `uncalledExcess`), so the top layer
 * always has at least two contributors or a live sole contender.
 */
export function buildPots(contributions: Contribution[]): Pot[] {
  const positive = contributions.filter((c) => c.amount > 0);
  const levels = [...new Set(positive.map((c) => c.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const payers = positive.filter((c) => c.amount >= level);
    const amount = (level - prev) * payers.length;
    const eligibleIds = payers.filter((c) => !c.folded).map((c) => c.playerId);
    const last = pots[pots.length - 1];
    if (last && sameMembers(last.eligibleIds, eligibleIds)) last.amount += amount;
    else pots.push({ amount, eligibleIds });
    prev = level;
  }
  return pots;
}

/**
 * The uncalled part of the largest contribution: how much more the top
 * contributor put in than anyone else. Returns null when the top is shared.
 */
export function uncalledExcess(contributions: Contribution[]): { playerId: string; amount: number } | null {
  if (contributions.length === 0) return null;
  const sorted = contributions.slice().sort((a, b) => b.amount - a.amount);
  const top = sorted[0];
  const second = sorted[1]?.amount ?? 0;
  const amount = top.amount - second;
  return amount > 0 ? { playerId: top.playerId, amount } : null;
}

export function sumPots(pots: Pot[]): number {
  return pots.reduce((s, p) => s + p.amount, 0);
}

function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}
