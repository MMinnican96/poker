import type { SoundCategory } from './soundStore';

/**
 * Every sound the app plays. The clips are synthesized by
 * `packages/client/scripts/gen-sounds.mjs` into `public/audio/`; a sound with
 * several files picks one at random each time so repeats don't grate.
 */
export type SoundName =
  | 'deal'
  | 'flop'
  | 'card'
  | 'flip'
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'allin'
  | 'turn'
  | 'tick'
  | 'tickUrgent'
  | 'pot'
  | 'win'
  | 'suspense'
  | 'message'
  | 'achievement';

export interface SoundDef {
  category: SoundCategory;
  /** Paths under the site root, e.g. `/audio/bet-1.wav`. */
  files: readonly string[];
  /** Random pitch spread (fraction; 0.03 = ±3%) so repeats sound natural. Musical cues stay in tune. */
  jitter: number;
}

const variants = (stem: string, n: number): string[] =>
  n === 1 ? [`/audio/${stem}.wav`] : Array.from({ length: n }, (_, i) => `/audio/${stem}-${i + 1}.wav`);

export const SOUNDS: Record<SoundName, SoundDef> = {
  // Chips and actions
  check: { category: 'actions', files: variants('check', 3), jitter: 0.03 },
  call: { category: 'actions', files: variants('call', 3), jitter: 0.04 },
  bet: { category: 'actions', files: variants('bet', 3), jitter: 0.04 },
  raise: { category: 'actions', files: variants('raise', 2), jitter: 0.03 },
  allin: { category: 'actions', files: variants('allin', 2), jitter: 0.02 },
  // Cards
  deal: { category: 'cards', files: variants('deal', 3), jitter: 0.04 },
  flop: { category: 'cards', files: variants('flop', 2), jitter: 0.03 },
  card: { category: 'cards', files: variants('card', 2), jitter: 0.04 },
  flip: { category: 'cards', files: variants('flip', 2), jitter: 0.05 },
  fold: { category: 'cards', files: variants('fold', 2), jitter: 0.04 },
  // Your turn and timer
  turn: { category: 'alerts', files: variants('turn', 1), jitter: 0 },
  tick: { category: 'alerts', files: variants('tick', 1), jitter: 0 },
  tickUrgent: { category: 'alerts', files: variants('tick-urgent', 1), jitter: 0 },
  // Wins and stings
  pot: { category: 'wins', files: variants('pot', 2), jitter: 0.03 },
  win: { category: 'wins', files: variants('win', 1), jitter: 0 },
  suspense: { category: 'wins', files: variants('suspense', 1), jitter: 0 },
  achievement: { category: 'wins', files: variants('achievement', 1), jitter: 0 },
  // Messages
  message: { category: 'messages', files: variants('message', 1), jitter: 0.02 },
};

/** What "Play a sample" plays for each group. */
export const CATEGORY_SAMPLE: Record<SoundCategory, SoundName> = {
  actions: 'bet',
  cards: 'deal',
  alerts: 'turn',
  wins: 'win',
  messages: 'message',
};

export const ALL_SOUND_FILES: readonly string[] = [...new Set(Object.values(SOUNDS).flatMap((s) => s.files))];
