import type { TableView } from '@poker/shared';
import type { SoundName } from './SoundManager';

export interface SoundCue {
  name: SoundName;
  /** Playback rate (pitch); 1 = normal. */
  rate?: number;
  /** Relative loudness 0..1 on top of the user's volume; 1 = full. */
  gain?: number;
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

export function suspenseRate(streak: number): number {
  return Math.min(SUSPENSE_MAX_RATE, 1 + (streak - SUSPENSE_FROM) * SUSPENSE_STEP);
}

/**
 * The sounds to play for the change from `prev` to `next` (pure; the hook plays
 * them). New hand or street → deal; each player's new last action → knock
 * (check), chips (call/bet/raise/all-in) or fold; your turn → a quiet cue; a
 * result → win. Raises in a row within a street build a rising suspense sting,
 * reset by a call, a check or a new street.
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
    if (nh.board.length > ph!.board.length) {
      cues.push({ name: 'deal' });
      streak = 0;
    } else if (nh.street !== ph!.street) {
      streak = 0;
    }

    const before = new Map(prev!.seats.flatMap((s) => (s.player ? [[s.player.id, s.player] as const] : [])));
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
          cues.push({ name: 'bet' });
          streak = 0;
          break;
        case 'bet':
        case 'raise':
        case 'all-in': {
          cues.push({ name: 'bet' });
          // An all-in that only calls doesn't raise the stakes.
          const raised = p.lastAction.type !== 'all-in' || nh.currentBet > ph!.currentBet;
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
      const youWon = (nh.result.payouts[next.you.id] ?? 0) > 0;
      if (nh.result.wentToShowdown || youWon) cues.push({ name: 'win', gain: youWon ? 1 : 0.6 });
    }
  }

  const yourTurnNow = !!next.you.legal && !nh.result;
  const yourTurnBefore = sameHand && !!prev!.you.legal;
  if (yourTurnNow && !yourTurnBefore) cues.push({ name: 'check', rate: 1.5, gain: 0.35 });

  return { cues, state: { raiseStreak: streak } };
}
