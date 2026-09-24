import { useEffect } from 'react';
import { useStore, useTable } from '../../app/client';
import { appCues } from './appCues';
import type { SoundManager } from './SoundManager';
import { useTableSounds } from './useTableSounds';
import { appSoundManager, useSoundManager } from './useSoundManager';

/**
 * Every sound in the app, from the store: table cues and your turn timer (from
 * the table view, whichever section you're on) and app sounds (messages, good
 * news). Mount once, inside the client provider.
 */
export function useAppSounds(manager: SoundManager = appSoundManager()): void {
  const store = useStore();
  const table = useTable();
  useSoundManager(manager);
  useTableSounds(table, manager, store.serverNow);
  useEffect(() => {
    let prev = store.getState();
    return store.subscribe(() => {
      const next = store.getState();
      if (next === prev) return;
      for (const name of appCues(prev, next)) manager.play(name);
      prev = next;
    });
  }, [store, manager]);
}

/** Renders nothing; runs `useAppSounds`. */
export function AppSounds() {
  useAppSounds();
  return null;
}
