import type { TableView } from '@poker/shared';
import type { SoundName } from './catalog';

export interface SoundCue {
  name: SoundName;
  /** Playback rate (pitch); 1 = normal. */
  rate?: number;
  /** Relative loudness 0..1 on top of the user's volume; 1 = full. */
  gain?: number;
  /** Seconds after the change (staggers several cues from one update). */
  delay?: number;
}

/** Carried between diffs: how many raises in a row this street. */
export interface CueState {
  raiseStreak: number;
}

export const INITIAL_CUE_STATE: CueState = { raiseStreak: 0 };

/** Suspense starts on the second raise in a row and rises a step per raise. */
export const SUSPENSE_FROM = 2;
export const SUSPENSE_STEP = 0.08;
export const SUSPENSE_MAX_RATE = 1.6;

/** At most this many flip sounds for cards turned up at once, this far apart. */
export const MAX_FLIPS = 3;
export const FLIP_STAGGER = 0.09;

export function suspenseRate(streak: number): number {
  return Math.min(SUSPENSE_MAX_RATE, 1 + (streak - SUSPENSE_FROM) * SUSPENSE_STEP);
}

/**
 * The sounds to play for the change from `prev` to `next` (pure; the hook plays
 * them):
 *
 * - a new hand: hole cards dealt; the board growing: the flop, or one card for
 *   the turn or river;
 * - another player's cards turning face up during the hand (showdown, all-in
 *   run-out, or shown by choice): a flip each;
 * - each player's new last action: knock (check), chips (call, bet, raise and a
 *   bigger shove for all-in) or the muck (fold);
 * - your turn: a chime; a result: the pot pushed, and a fanfare if you won.
 *
 * Raises in a row within a street build a rising suspense sting, reset by a
 * call, a check or a new street.
 */
export function soundCues(prev: TableView | null, next: TableView | null, state: CueState = INITIAL_CUE_STATE): { cues: SoundCue[]; state: CueState } {
  const cues: SoundCue[] = [];
  let streak = state.raiseStreak;
  const ph = prev?.hand ?? null;
  const nh = next?.hand ?? null;
  if (!next || !nh) return { cues, state: { raiseStreak: 0 } };

  const sameHand = !!ph && ph.handNumber === nh.handNumber && prev!.tableId === next.tableId;
  if (!sameHand) {
    cues.push({ name: 'deal' });
    streak = 0;
  } else {
    const added = nh.board.length - ph!.board.length;
    if (added > 0) {
      cues.push({ name: added >= 3 ? 'flop' : 'card' });
      streak = 0;
    } else if (nh.street !== ph!.street) {
      streak = 0;
    }

    const before = new Map(prev!.seats.flatMap((s) => (s.player ? [[s.player.id, s.player] as const] : [])));

    let flips = 0;
    for (const s of next.seats) {
      const p = s.player;
      if (!p || p.id === next.you.id || !p.holeCards || flips >= MAX_FLIPS) continue;
      const was = before.get(p.id);
      if (was && !was.holeCards) {
        cues.push({ name: 'flip', delay: flips * FLIP_STAGGER });
        flips += 1;
      }
    }

    for (const s of next.seats) {
      const p = s.player;
      if (!p?.lastAction) continue;
      const was = before.get(p.id)?.lastAction ?? null;
      if (was && was.type === p.lastAction.type && was.amount === p.lastAction.amount) continue;
      switch (p.lastAction.type) {
        case 'fold':
          cues.push({ name: 'fold' });
          break;
        case 'check':
          cues.push({ name: 'check' });
          streak = 0;
          break;
        case 'call':
          cues.push({ name: 'call' });
          streak = 0;
          break;
        case 'bet':
        case 'raise':
        case 'all-in': {
          const type = p.lastAction.type;
          cues.push({ name: type === 'all-in' ? 'allin' : type });
          // An all-in that only calls doesn't raise the stakes.
          const raised = type !== 'all-in' || nh.currentBet > ph!.currentBet;
          if (raised) {
            streak += 1;
            if (streak >= SUSPENSE_FROM) cues.push({ name: 'suspense', rate: suspenseRate(streak) });
          } else {
            streak = 0;
          }
          break;
        }
      }
    }

    if (nh.result && !ph!.result) {
      const paid = Object.values(nh.result.payouts).some((v) => v > 0);
      const youWon = (nh.result.payouts[next.you.id] ?? 0) > 0;
      if (paid) cues.push({ name: 'pot', delay: flips > 0 ? 0.25 : 0 });
      if (youWon) cues.push({ name: 'win', delay: 0.35 });
    }
  }

  const yourTurnNow = !!next.you.legal && !nh.result;
  const yourTurnBefore = sameHand && !!prev!.you.legal;
  if (yourTurnNow && !yourTurnBefore) cues.push({ name: 'turn' });

  return { cues, state: { raiseStreak: streak } };
}
