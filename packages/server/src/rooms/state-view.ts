import type { GameState } from '@poker/shared';

function isRevealPhase(state: GameState): boolean {
  return state.phase === 'showdown' || state.phase === 'hand-complete';
}

/**
 * Produce the version of the game state a given viewer is allowed to see.
 * A player always sees their own hole cards; opponents' hole cards are hidden
 * until showdown, and folded players' cards are never revealed.
 *
 * Pass `viewerId = null` for the public showdown view (used in HAND_RESULT).
 */
export function viewFor(state: GameState, viewerId: string | null): GameState {
  const reveal = isRevealPhase(state);
  return {
    ...state,
    players: state.players.map((p) => {
      const own = viewerId !== null && p.discordUserId === viewerId;
      const shown = own || (reveal && p.status !== 'folded');
      return shown ? p : { ...p, holeCards: null };
    }),
  };
}
