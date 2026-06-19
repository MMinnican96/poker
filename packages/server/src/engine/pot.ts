import type { GamePlayer, Pot } from '@poker/shared';

export interface Contribution {
  playerId: string;
  /** Total chips this player put into the pot this hand. */
  contributed: number;
  /** Folded players still contribute chips but can't win. */
  folded: boolean;
}

/**
 * Build the main pot + any side pots from each player's total contribution.
 *
 * Works by slicing the pot into horizontal layers at each distinct contribution
 * level. A player is eligible to win every layer they fully paid into (and
 * hasn't folded). Adjacent layers with an identical eligible set are merged so
 * the result is the conventional "main pot + N side pots".
 */
export function collectPots(contributions: Contribution[]): Pot[] {
  const positive = contributions.filter((c) => c.contributed > 0);
  if (positive.length === 0) return [];

  const levels = Array.from(new Set(positive.map((c) => c.contributed))).sort(
    (a, b) => a - b,
  );

  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const layer = level - prev;
    const contributors = positive.filter((c) => c.contributed >= level);
    const amount = layer * contributors.length;
    const eligiblePlayerIds = contributors.filter((c) => !c.folded).map((c) => c.playerId);

    const last = pots[pots.length - 1];
    if (last && sameSet(last.eligiblePlayerIds, eligiblePlayerIds)) {
      last.amount += amount;
    } else {
      pots.push({ amount, eligiblePlayerIds });
    }
    prev = level;
  }
  return pots;
}

/** Convenience: derive contributions straight from game players. */
export function potsFromPlayers(players: GamePlayer[]): Pot[] {
  return collectPots(
    players.map((p) => ({
      playerId: p.discordUserId,
      contributed: p.totalBetThisHand,
      folded: p.status === 'folded',
    })),
  );
}

export function totalPot(pots: Pot[]): number {
  return pots.reduce((sum, p) => sum + p.amount, 0);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}
