import Phaser from 'phaser';
import type { GameState } from '@poker/shared';

/** Payload carrying a viewer-sanitized game state into the Phaser scene. */
export interface StatePayload {
  state: GameState;
  viewerId: string;
}

export interface TimerPayload {
  playerId: string;
  remainingMs: number;
}

export const BRIDGE = {
  State: 'state',
  Timer: 'timer',
} as const;

/**
 * A standalone event emitter shared between React and the Phaser scene. React
 * pushes `state`/`timer` updates in; the scene listens and re-renders the table.
 */
export class GameBridge extends Phaser.Events.EventEmitter {
  pushState(payload: StatePayload): void {
    this.emit(BRIDGE.State, payload);
  }
  pushTimer(payload: TimerPayload): void {
    this.emit(BRIDGE.Timer, payload);
  }
}
