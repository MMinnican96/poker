import type { GamePlayer, GameState, PlayerAction } from '@poker/shared';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Pure validation of a player's intended action against the current state.
 * `raise` amounts are interpreted as the player's *total* bet for the round
 * (i.e. their new `betThisRound`), matching the rest of the engine.
 */
export function validateAction(
  state: GameState,
  playerId: string,
  action: PlayerAction,
): ValidationResult {
  const player = state.players[state.currentPlayerIndex];
  if (!player || player.discordUserId !== playerId) {
    return { valid: false, reason: 'Not your turn' };
  }
  if (player.status !== 'active') {
    return { valid: false, reason: 'You cannot act' };
  }

  const toCall = state.callAmount - player.betThisRound;

  switch (action.type) {
    case 'fold':
      return { valid: true };

    case 'check':
      return toCall === 0
        ? { valid: true }
        : { valid: false, reason: 'Cannot check facing a bet' };

    case 'call':
      return toCall > 0
        ? { valid: true }
        : { valid: false, reason: 'Nothing to call' };

    case 'all-in':
      return player.chipStack > 0
        ? { valid: true }
        : { valid: false, reason: 'No chips to push' };

    case 'raise': {
      if (action.amount == null) return { valid: false, reason: 'Raise requires an amount' };
      const target = action.amount;
      const maxTarget = player.betThisRound + player.chipStack;
      if (target <= state.callAmount) {
        return { valid: false, reason: 'Raise must exceed the current bet' };
      }
      if (target > maxTarget) return { valid: false, reason: 'Not enough chips' };
      const minTarget = state.callAmount + state.minRaise;
      // A short all-in (shoving your whole stack) is allowed below the min raise.
      if (target < minTarget && target !== maxTarget) {
        return { valid: false, reason: `Raise must be at least ${minTarget}` };
      }
      return { valid: true };
    }

    default:
      return { valid: false, reason: 'Unknown action' };
  }
}

function commit(player: GamePlayer, pay: number): void {
  player.chipStack -= pay;
  player.betThisRound += pay;
  player.totalBetThisHand += pay;
  if (player.chipStack === 0) player.status = 'all-in';
}

/** Apply a raise/bet to `newBet`, updating callAmount, minRaise and reopening action. */
function raiseTo(state: GameState, player: GamePlayer, newBet: number): void {
  const prevCall = state.callAmount;
  const raiseSize = newBet - prevCall;
  const fullRaise = prevCall === 0 || raiseSize >= state.minRaise;
  state.callAmount = newBet;
  if (raiseSize >= state.minRaise) state.minRaise = raiseSize;
  if (fullRaise) {
    // Everyone else who can still act must respond to the raise.
    for (const p of state.players) {
      if (p.discordUserId !== player.discordUserId && p.status === 'active') {
        p.hasActed = false;
      }
    }
  }
}

/**
 * Apply a *validated* action, mutating `state` in place. Call `validateAction`
 * first; this assumes the action is legal.
 */
export function applyActionToState(
  state: GameState,
  playerId: string,
  action: PlayerAction,
): void {
  const player = state.players[state.currentPlayerIndex];
  player.hasActed = true;
  player.lastAction = action.type;

  switch (action.type) {
    case 'fold':
      player.status = 'folded';
      break;

    case 'check':
      break;

    case 'call': {
      const toCall = state.callAmount - player.betThisRound;
      commit(player, Math.min(toCall, player.chipStack));
      break;
    }

    case 'raise': {
      const target = action.amount!;
      commit(player, target - player.betThisRound);
      raiseTo(state, player, player.betThisRound);
      break;
    }

    case 'all-in': {
      commit(player, player.chipStack);
      if (player.betThisRound > state.callAmount) {
        raiseTo(state, player, player.betThisRound);
      }
      break;
    }
  }
}
