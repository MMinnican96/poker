import { useEffect, useRef } from 'react';
import type { TableView } from '@poker/shared';
import { INITIAL_CUE_STATE, soundCues, type CueState } from './cues';
import { createSoundManager, type SoundManager } from './SoundManager';
import { getSoundSettings, subscribeSoundSettings } from './soundStore';

let shared: SoundManager | null = null;
/** One sound manager (and AudioContext) for the app. */
export function tableSoundManager(): SoundManager {
  if (!shared) shared = createSoundManager();
  return shared;
}

/**
 * Plays table sounds for each new table view (see `soundCues`). Unlocks audio on
 * the first pointer or key press, and follows the mute/volume settings.
 */
export function useTableSounds(view: TableView | null, manager: SoundManager = tableSoundManager()): void {
  const prev = useRef<TableView | null>(null);
  const state = useRef<CueState>(INITIAL_CUE_STATE);

  useEffect(() => {
    manager.setSettings(getSoundSettings());
    const unsub = subscribeSoundSettings(() => manager.setSettings(getSoundSettings()));
    const unlock = () => manager.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return () => {
      unsub();
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };
  }, [manager]);

  useEffect(() => {
    if (view === prev.current) return;
    // The first view after mounting only sets the baseline (no replayed sounds).
    if (prev.current === null) {
      prev.current = view;
      return;
    }
    const { cues, state: nextState } = soundCues(prev.current, view, state.current);
    state.current = nextState;
    prev.current = view;
    for (const cue of cues) manager.play(cue.name, { rate: cue.rate, gain: cue.gain });
  }, [view, manager]);
}
