import type { ActionType, GamePlayer } from '@poker/shared';

/** Action-pill colour families, shared by opponent seats and the hero token. */
export type Tone = 'fold' | 'call' | 'raise' | 'allin';

export const TONE_CLASS: Record<Tone, string> = {
  fold: 'text-[#ff8a8a] bg-red/15 border-red/40',
  call: 'text-mint-bright bg-mint/15 border-mint/40',
  raise: 'text-gold-soft bg-gold/15 border-gold/40',
  allin: 'text-[#d8b6ff] bg-purple/20 border-purple/45',
};

export const ROLE_CLASS: Record<'D' | 'SB' | 'BB', string> = {
  D: 'bg-gold', SB: 'bg-blue', BB: 'bg-mint',
};

/** The label + tone for a player's most recent action, or null when none applies. */
export function actionPill(player: GamePlayer): { text: string; tone: Tone } | null {
  if (player.status === 'all-in') return { text: 'All-In', tone: 'allin' };
  if (player.status === 'folded') return { text: 'Fold', tone: 'fold' };
  const map: Partial<Record<ActionType, { text: string; tone: Tone }>> = {
    check: { text: 'Check', tone: 'call' },
    call: { text: 'Call', tone: 'call' },
    raise: { text: 'Raise', tone: 'raise' },
    'all-in': { text: 'All-In', tone: 'allin' },
    fold: { text: 'Fold', tone: 'fold' },
  };
  return player.lastAction ? map[player.lastAction] ?? null : null;
}
