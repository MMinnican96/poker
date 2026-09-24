import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { TableView } from '@poker/shared';
import { INITIAL_CUE_STATE, soundCues, type CueState } from './cues';
import type { SoundManager } from './SoundManager';
import { getSoundSettings, subscribeSoundSettings } from './soundStore';
import { useTurnTicks } from './turnTicks';

const timerTicksOn = () => getSoundSettings().timerTicks;

/**
 * Plays table sounds for each new table view (see `soundCues`) and ticks the
 * last seconds of your turn (see `useTurnTicks`). `serverNow` reads the server
 * clock. Mounted once at app level (`useAppSounds`), so your turn still sounds
 * while you browse another section. The first view (after mounting, or after
 * the view was gone) only sets a baseline: nothing is replayed.
 */
export function useTableSounds(view: TableView | null, manager: SoundManager, serverNow: () => number = Date.now): void {
  const prev = useRef<TableView | null>(null);
  const state = useRef<CueState>(INITIAL_CUE_STATE);
  const timerTicks = useSyncExternalStore(subscribeSoundSettings, timerTicksOn, timerTicksOn);
  useTurnTicks(view, manager, timerTicks, serverNow);

  useEffect(() => {
    if (view === prev.current) return;
    if (prev.current === null || view === null) {
      prev.current = view;
      state.current = INITIAL_CUE_STATE;
      return;
    }
    const { cues, state: nextState } = soundCues(prev.current, view, state.current);
    state.current = nextState;
    prev.current = view;
    for (const cue of cues) manager.play(cue.name, { rate: cue.rate, gain: cue.gain, delay: cue.delay });
  }, [view, manager]);
}
