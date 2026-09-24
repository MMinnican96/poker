import { useSyncExternalStore } from 'react';

/** Sounds are mixed in these groups; each has its own volume. */
export const SOUND_CATEGORIES = ['actions', 'cards', 'alerts', 'wins', 'messages'] as const;
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<SoundCategory, string> = {
  actions: 'Chips and actions',
  cards: 'Cards',
  alerts: 'Your turn and timer',
  wins: 'Wins and stings',
  messages: 'Messages',
};

export interface SoundSettings {
  muted: boolean;
  /** Overall volume, 0..1 (slider position; the mixer applies a loudness curve). */
  master: number;
  /** Per-group volume, 0..1. */
  categories: Record<SoundCategory, number>;
  /** Tick in the last seconds of your turn. */
  timerTicks: boolean;
}

/** Balanced and on the quiet side: the table shares your ears with voice chat. */
export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  muted: false,
  master: 0.7,
  categories: { actions: 0.8, cards: 0.75, alerts: 0.8, wins: 0.8, messages: 0.7 },
  timerTicks: true,
};

const KEY = 'poker.sound';
const VERSION = 2;

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function defaults(): SoundSettings {
  return { ...DEFAULT_SOUND_SETTINGS, categories: { ...DEFAULT_SOUND_SETTINGS.categories } };
}

const vol = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/**
 * Settings from a stored value, field by field: anything missing or malformed
 * falls back to its default. Reads the v1 shape `{ muted, volume }` too: v1
 * used `volume` as a linear gain, and the mixer now squares the slider, so
 * the master becomes √volume to keep the same loudness.
 */
export function parseSoundSettings(raw: unknown): SoundSettings {
  const d = defaults();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const cats = r.categories && typeof r.categories === 'object' && !Array.isArray(r.categories) ? (r.categories as Record<string, unknown>) : {};
  const categories = { ...d.categories };
  for (const c of SOUND_CATEGORIES) categories[c] = vol(cats[c], d.categories[c]);
  return {
    muted: bool(r.muted, d.muted),
    master: 'master' in r ? vol(r.master, d.master) : typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.sqrt(clamp01(r.volume)) : d.master,
    categories,
    timerTicks: bool(r.timerTicks, d.timerTicks),
  };
}

function load(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSoundSettings(JSON.parse(raw)) : defaults();
  } catch {
    return defaults();
  }
}

let current: SoundSettings = load();
const listeners = new Set<() => void>();

function persistAndNotify(next: SoundSettings): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...current }));
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

export function setMaster(master: number): void {
  persistAndNotify({ ...current, master: clamp01(master) });
}

export function setCategoryVolume(category: SoundCategory, volume: number): void {
  persistAndNotify({ ...current, categories: { ...current.categories, [category]: clamp01(volume) } });
}

export function setTimerTicks(on: boolean): void {
  persistAndNotify({ ...current, timerTicks: on });
}

export function resetSoundSettings(): void {
  persistAndNotify(defaults());
}

/** Re-read storage (tests, or another tab changed it). */
export function reloadSoundSettings(): void {
  current = load();
  for (const cb of listeners) cb();
}

// Another tab (or window) of the app changed the settings: follow it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) reloadSoundSettings();
  });
}

export function subscribeSoundSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const actions = { setMuted, setMaster, setCategoryVolume, setTimerTicks, reset: resetSoundSettings };

export function useSoundSettings(): SoundSettings & typeof actions {
  const settings = useSyncExternalStore(subscribeSoundSettings, getSoundSettings, getSoundSettings);
  return { ...settings, ...actions };
}
