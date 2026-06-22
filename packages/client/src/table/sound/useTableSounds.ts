import { useEffect, useRef } from 'react';
import type { GameState, ActionType } from '@poker/shared';
import type { SoundManager } from './SoundManager';

const STEP = 0.07;
const MAX_RATE = 1.6;

/** Playback rate for the Nth consecutive raise (step 1 = base pitch). */
export function rateForRaiseStep(step: number): number {
  if (step <= 1) return 1.0;
  return Math.min(1.0 + (step - 1) * STEP, MAX_RATE);
}

export function useTableSounds(view: GameState | null, manager: SoundManager): void {
  const prevRef = useRef<GameState | null>(null);
  const raiseStep = useRef(0);
  // After call/check, the next render clears processedRaisers so a player whose
  // lastAction is already 'raise' in the state (no raw diff change) can still
  // trigger the suspense sting at the freshly-reset pitch.
  const pendingResetRef = useRef(false);
  // Tracks which players we have counted as raisers in the current streak, so
  // we don't double-fire if the same raise appears across multiple broadcasts.
  const processedRaisersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = view;
    if (!view) return;

    // First view or a brand-new hand: reset, stay silent.
    if (!prev || view.handNumber !== prev.handNumber) {
      raiseStep.current = 0;
      pendingResetRef.current = false;
      processedRaisersRef.current = new Set();
      return;
    }

    // Showdown just resolved: celebrate, and skip diffing so the cardless
    // waiting→reveal rebroadcast doesn't replay deal/bet sounds.
    if (view.showdown && !prev.showdown) {
      manager.play('win');
      return;
    }

    // If the previous render saw a call/check, clear our raise-tracker so that
    // any player currently sitting at 'raise' fires the suspense sting again at
    // the reset pitch.
    if (pendingResetRef.current) {
      pendingResetRef.current = false;
      processedRaisersRef.current = new Set();
    }

    // Community cards revealed (flop/turn/river).
    if (view.communityCards.length > prev.communityCards.length) {
      manager.play('deal');
    }

    // Process each player's action.
    for (const p of view.players) {
      const prevAction = prev.players.find((q) => q.discordUserId === p.discordUserId)?.lastAction;
      const now = p.lastAction;
      const isNew = now !== prevAction; // changed in the raw state diff

      switch (now) {
        case 'raise':
        case 'all-in': {
          // Play the bet chip sound only when the raise is genuinely new in the
          // state diff.  Always fire the suspense sting when the player hasn't
          // been counted in the current streak (covers the post-reset re-open).
          if (!processedRaisersRef.current.has(p.discordUserId)) {
            if (isNew) manager.play('bet');
            raiseStep.current += 1;
            manager.play('suspense', { rate: rateForRaiseStep(raiseStep.current) });
            processedRaisersRef.current.add(p.discordUserId);
          }
          break;
        }
        case 'call': {
          if (isNew) {
            manager.play('bet');
            raiseStep.current = 0;
            pendingResetRef.current = true;
          }
          break;
        }
        case 'check': {
          if (isNew) {
            manager.play('check');
            raiseStep.current = 0;
            pendingResetRef.current = true;
          }
          break;
        }
        case 'fold': {
          if (isNew) {
            manager.play('fold');
          }
          break;
        }
        default:
          break;
      }
    }
  }, [view, manager]);
}
