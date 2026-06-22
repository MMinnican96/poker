import { useSyncExternalStore } from 'react';

export interface SoundSettings {
  muted: boolean;
  volume: number; // 0..1
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { muted: false, volume: 0.7 };

const KEY = 'poker.sound';

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function load(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SOUND_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SOUND_SETTINGS.muted,
      volume: typeof parsed.volume === 'number' ? clamp01(parsed.volume) : DEFAULT_SOUND_SETTINGS.volume,
    };
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
}

let current: SoundSettings = load();
const listeners = new Set<() => void>();

function persistAndNotify(next: SoundSettings): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore quota / unavailable storage */
  }
  for (const cb of listeners) cb();
}

export function getSoundSettings(): SoundSettings {
  return current;
}

export function setMuted(muted: boolean): void {
  persistAndNotify({ ...current, muted });
}

export function setVolume(volume: number): void {
  persistAndNotify({ ...current, volume: clamp01(volume) });
}

export function subscribeSoundSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSoundSettings() {
  const settings = useSyncExternalStore(subscribeSoundSettings, getSoundSettings, getSoundSettings);
  return { ...settings, setMuted, setVolume };
}
