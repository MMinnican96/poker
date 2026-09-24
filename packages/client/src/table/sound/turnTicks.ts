import { useEffect, useRef } from 'react';
import type { TableView } from '@poker/shared';
import type { SoundManager } from './SoundManager';
import { getSoundSettings } from './soundStore';

/** Tick once a second for the last this-many seconds of your turn… */
export const TICK_FROM_SECONDS = 5;
/** …with the more urgent tick for the last this-many. */
export const URGENT_FROM_SECONDS = 3;

export interface TickPlan {
  /** Ms from now. */
  in: number;
  urgent: boolean;
}

/**
 * When to tick: at `TICK_FROM_SECONDS`, …, 2, 1 seconds left, for any turn
 * length. `endsAt` is the deadline and `serverNow` the current time, both on
 * the server's clock (the store's `serverNow()`: local time plus the offset
 * measured when the last table state arrived). Ticks already past are left out.
 */
export function planTurnTicks(endsAt: number, serverNow: number): TickPlan[] {
  const out: TickPlan[] = [];
  for (let s = TICK_FROM_SECONDS; s >= 1; s--) {
    const wait = endsAt - s * 1000 - serverNow;
    if (wait >= 0) out.push({ in: wait, urgent: s <= URGENT_FROM_SECONDS });
  }
  return out;
}

/** Your turn's deadline (server clock), or null when it isn't your turn. */
export function yourDeadline(view: TableView | null): number | null {
  const hand = view?.hand;
  if (!view || !hand || hand.result || !view.you.legal || hand.actionEndsAt === null) return null;
  if (view.you.seat !== null && hand.toActSeat !== null && hand.toActSeat !== view.you.seat) return null;
  return hand.actionEndsAt;
}

/**
 * Ticks the last seconds of your turn. `serverNow` reads the server clock now
 * (the store's `serverNow`), so a plan made late (a remount, ticks switched
 * back on mid-turn) still lands on the right seconds. Stops as soon as the
 * turn ends or moves on (a new deadline), when ticks are switched off, or on
 * unmount.
 */
export function useTurnTicks(view: TableView | null, manager: SoundManager, enabled: boolean, serverNow: () => number): void {
  const deadline = yourDeadline(view);
  const clock = useRef(serverNow);
  clock.current = serverNow;
  useEffect(() => {
    if (deadline === null || !enabled) return;
    const plan = planTurnTicks(deadline, clock.current());
    const timers = plan.map((t) =>
      setTimeout(() => {
        if (getSoundSettings().timerTicks) manager.play(t.urgent ? 'tickUrgent' : 'tick');
      }, t.in),
    );
    return () => timers.forEach(clearTimeout);
  }, [deadline, enabled, manager]);
}
