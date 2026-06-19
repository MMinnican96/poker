import type { GamePlayer, GameState } from '@poker/shared';

/** Can this player still be dealt into / act in a hand? */
function inHand(p: GamePlayer): boolean {
  return p.chipStack > 0 && p.status !== 'sitting-out';
}

/** Next seat index (cyclic, exclusive of `from`) that is still in the hand. */
export function nextActiveSeat(state: GameState, from: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (inHand(state.players[idx])) return idx;
  }
  return from;
}

/**
 * Assign small/big blind seats relative to the dealer button. Heads-up uses the
 * special rule where the button posts the small blind.
 */
export function assignBlindPositions(state: GameState): void {
  const eligible = state.players.filter(inHand).length;
  if (eligible <= 2) {
    state.smallBlindIndex = state.dealerIndex;
    state.bigBlindIndex = nextActiveSeat(state, state.dealerIndex);
  } else {
    state.smallBlindIndex = nextActiveSeat(state, state.dealerIndex);
    state.bigBlindIndex = nextActiveSeat(state, state.smallBlindIndex);
  }
}

function postBlind(player: GamePlayer, amount: number): void {
  const pay = Math.min(amount, player.chipStack);
  player.chipStack -= pay;
  player.betThisRound += pay;
  player.totalBetThisHand += pay;
  if (player.chipStack === 0) player.status = 'all-in';
}

/** Post both blinds and prime the betting round (callAmount/minRaise). */
export function postBlinds(state: GameState): void {
  postBlind(state.players[state.smallBlindIndex], state.config.smallBlind);
  postBlind(state.players[state.bigBlindIndex], state.config.bigBlind);
  state.callAmount = state.config.bigBlind;
  state.minRaise = state.config.bigBlind;
}
