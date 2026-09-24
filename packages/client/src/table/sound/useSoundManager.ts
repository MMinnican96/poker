import { useEffect } from 'react';
import { createSoundManager, type SoundManager } from './SoundManager';
import { getSoundSettings, subscribeSoundSettings } from './soundStore';

let shared: SoundManager | null = null;

/** The app's one sound manager (and AudioContext). */
export function appSoundManager(): SoundManager {
  if (!shared) shared = createSoundManager();
  return shared;
}

/**
 * Keep `manager` in step with the sound settings, and unlock audio on the
 * first pointer or key press (browsers only start audio after a gesture).
 */
export function useSoundManager(manager: SoundManager): void {
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
}
