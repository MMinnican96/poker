import type { GamePlayer, GameState } from '@poker/shared';
import { potsFromPlayers } from './pot.js';
import { evaluateBest, type HandRank } from './hand-evaluator.js';

export interface PotAward {
  amount: number;
  winnerIds: string[];
}

export interface ShowdownResult {
  awards: PotAward[];
  /** playerId -> total chips won (to credit onto chipStack / DB balance). */
  winningsByPlayer: Record<string, number>;
  /** Best hand shown per player who reached showdown (for the reveal UI). */
  hands: Record<string, HandRank>;
}

/**
 * Determine winners for every (side) pot and how chips are distributed.
 * Handles ties (split pots) and odd-chip remainders, which go to the earliest
 * seat left of the button. Works for fold-outs too (a single eligible player
 * simply wins each pot they're in).
 */
export function resolveShowdown(state: GameState): ShowdownResult {
  const pots = state.pots.length ? state.pots : potsFromPlayers(state.players);
  const board = state.communityCards;
  const byId = new Map(state.players.map((p) => [p.discordUserId, p]));

  const winningsByPlayer: Record<string, number> = {};
  const hands: Record<string, HandRank> = {};
  const awards: PotAward[] = [];

  for (const pot of pots) {
    const eligible = pot.eligiblePlayerIds
      .map((id) => byId.get(id))
      .filter((p): p is GamePlayer => !!p && p.status !== 'folded' && p.holeCards !== null);
    if (eligible.length === 0) continue;

    // Uncontested (everyone else folded) — winner takes the pot with no showdown.
    // This also avoids evaluating an incomplete board on a pre-river fold-out.
    if (eligible.length === 1) {
      const w = eligible[0];
      winningsByPlayer[w.discordUserId] = (winningsByPlayer[w.discordUserId] ?? 0) + pot.amount;
      awards.push({ amount: pot.amount, winnerIds: [w.discordUserId] });
      continue;
    }

    let best = -1;
    let winners: GamePlayer[] = [];
    for (const p of eligible) {
      const rank = evaluateBest([...p.holeCards!, ...board]);
      hands[p.discordUserId] = rank;
      if (rank.score > best) {
        best = rank.score;
        winners = [p];
      } else if (rank.score === best) {
        winners.push(p);
      }
    }

    const perWinner = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - perWinner * winners.length;
    winners.sort((a, b) => seatOrder(state, a) - seatOrder(state, b));
    for (const w of winners) {
      let award = perWinner;
      if (remainder > 0) {
        award += 1;
        remainder -= 1;
      }
      winningsByPlayer[w.discordUserId] = (winningsByPlayer[w.discordUserId] ?? 0) + award;
    }
    awards.push({ amount: pot.amount, winnerIds: winners.map((w) => w.discordUserId) });
  }

  return { awards, winningsByPlayer, hands };
}

/** Credit winnings onto chip stacks and mark the hand complete. Returns the result. */
export function settleHand(state: GameState): ShowdownResult {
  const result = resolveShowdown(state);
  for (const p of state.players) {
    const won = result.winningsByPlayer[p.discordUserId];
    if (won) p.chipStack += won;
  }
  state.phase = 'hand-complete';
  return result;
}

/** Seat distance clockwise from the button — used to break odd-chip ties. */
function seatOrder(state: GameState, player: GamePlayer): number {
  const n = state.players.length;
  const idx = state.players.indexOf(player);
  return (idx - state.dealerIndex + n) % n;
}
