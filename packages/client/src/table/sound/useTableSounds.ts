import { useEffect, useRef } from 'react';
import type { GameState } from '@poker/shared';
import type { SoundManager } from './SoundManager';

const STEP = 0.07;
const MAX_RATE = 1.6;

/** Playback rate for the Nth consecutive raise (step 1 = base pitch). */
export function rateForRaiseStep(step: number): number {
  if (step <= 1) return 1.0;
  return Math.min(1.0 + (step - 1) * STEP, MAX_RATE);
}

/**
 * Fire table sound effects by diffing successive game states. The server
 * broadcasts exactly one applied action per state update, and closes a betting
 * round by resetting every lastAction to null in the same frame that deals the
 * next street — so the street-closing call/check is never visible. We therefore
 * detect aggression by a rise in callAmount (robust to the same player
 * re-raising, whose lastAction stays 'raise'), reset the suspense streak at each
 * new street, and read passive/terminal actions from lastAction transitions.
 * @param manager must be a stable reference across renders (e.g. created via useRef/useMemo); it is in the effect dependency array.
 */
export function useTableSounds(view: GameState | null, manager: SoundManager): void {
  const prevRef = useRef<GameState | null>(null);
  const raiseStep = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = view;
    if (!view) return;

    // First view or a brand-new hand: reset the streak, stay silent.
    if (!prev || view.handNumber !== prev.handNumber) {
      raiseStep.current = 0;
      return;
    }

    // Showdown just resolved: celebrate, and skip diffing so the cardless
    // waiting→reveal rebroadcast can't replay deal/bet sounds.
    if (view.showdown && !prev.showdown) {
      manager.play('win');
      return;
    }

    // New street: deal sound, and the betting streak resets. This frame carries
    // no actionable lastAction (the engine nulls them when it advances).
    if (view.communityCards.length > prev.communityCards.length) {
      manager.play('deal');
      raiseStep.current = 0;
      return;
    }

    // A raise/bet (incl. a raising all-in) is the only thing that lifts
    // callAmount within a street — and it catches the same player re-raising,
    // whose lastAction never changes from 'raise'.
    if (view.callAmount > prev.callAmount) {
      manager.play('bet');
      raiseStep.current += 1;
      manager.play('suspense', { rate: rateForRaiseStep(raiseStep.current) });
      return;
    }

    // Otherwise: a passive/terminal action (one per frame). Chips moving on a
    // call (or a non-raising all-in) settle the streak; a check settles it too.
    for (const p of view.players) {
      const before = prev.players.find((q) => q.discordUserId === p.discordUserId)?.lastAction;
      const now = p.lastAction;
      if (!now || now === before) continue;
      switch (now) {
        case 'call':
        case 'all-in':
          manager.play('bet');
          raiseStep.current = 0;
          break;
        case 'check':
          manager.play('check');
          raiseStep.current = 0;
          break;
        case 'fold':
          manager.play('fold');
          break;
        // 'raise' without a callAmount rise shouldn't occur; ignore.
      }
    }
  }, [view, manager]);
}
