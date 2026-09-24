import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  DEFAULT_SOUND_SETTINGS,
  SOUND_CATEGORIES,
  getSoundSettings,
  parseSoundSettings,
  reloadSoundSettings,
  resetSoundSettings,
  setCategoryVolume,
  setMaster,
  setMuted,
  setTimerTicks,
  useSoundSettings,
} from './soundStore';

const stored = () => JSON.parse(localStorage.getItem('poker.sound')!);

beforeEach(() => {
  localStorage.clear();
  resetSoundSettings();
  localStorage.clear();
});

describe('soundStore', () => {
  it('defaults to sound on, a moderate master volume, every group set, and timer ticks on', () => {
    reloadSoundSettings();
    const s = getSoundSettings();
    expect(s).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(s.muted).toBe(false);
    expect(s.master).toBeGreaterThan(0.4);
    expect(s.master).toBeLessThanOrEqual(0.8);
    for (const c of SOUND_CATEGORIES) expect(s.categories[c]).toBeGreaterThan(0);
    expect(s.timerTicks).toBe(true);
  });

  it('persists every setting and clamps volumes to [0, 1]', () => {
    setMuted(true);
    setMaster(1.5);
    expect(getSoundSettings().master).toBe(1);
    setMaster(-3);
    expect(getSoundSettings().master).toBe(0);
    setMaster(Number.NaN);
    expect(getSoundSettings().master).toBe(0);
    setCategoryVolume('cards', 0.25);
    setCategoryVolume('alerts', 7);
    setTimerTicks(false);
    const raw = stored();
    expect(raw).toMatchObject({ version: 2, muted: true, master: 0, timerTicks: false });
    expect(raw.categories.cards).toBe(0.25);
    expect(raw.categories.alerts).toBe(1);
    // And it reads back the same.
    reloadSoundSettings();
    expect(getSoundSettings()).toMatchObject({ muted: true, master: 0, timerTicks: false });
    expect(getSoundSettings().categories.cards).toBe(0.25);
  });

  it('migrates the v1 value at the same loudness: master = √volume (the mixer squares it), mute kept', () => {
    localStorage.setItem('poker.sound', JSON.stringify({ muted: true, volume: 0.36 }));
    reloadSoundSettings();
    expect(getSoundSettings()).toEqual({ ...DEFAULT_SOUND_SETTINGS, muted: true, master: 0.6 });
    expect(parseSoundSettings({ volume: 4 }).master).toBe(1);
    expect(parseSoundSettings({ volume: -1 }).master).toBe(0);
  });

  it('follows a change made in another tab', () => {
    localStorage.setItem('poker.sound', JSON.stringify({ version: 2, muted: true }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'poker.sound' }));
    expect(getSoundSettings().muted).toBe(true);
  });

  it('falls back field by field on bad values', () => {
    expect(parseSoundSettings(null)).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(parseSoundSettings('loud')).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(parseSoundSettings([1, 2])).toEqual(DEFAULT_SOUND_SETTINGS);
    const s = parseSoundSettings({ muted: 'yes', master: 'max', categories: { actions: 0.2, cards: 'x', wins: -1, bogus: 1 }, timerTicks: 1 });
    expect(s.muted).toBe(DEFAULT_SOUND_SETTINGS.muted);
    expect(s.master).toBe(DEFAULT_SOUND_SETTINGS.master);
    expect(s.categories.actions).toBe(0.2);
    expect(s.categories.cards).toBe(DEFAULT_SOUND_SETTINGS.categories.cards);
    expect(s.categories.wins).toBe(0);
    expect(s.categories).not.toHaveProperty('bogus');
    expect(s.timerTicks).toBe(DEFAULT_SOUND_SETTINGS.timerTicks);
    // A master of the wrong type isn't rescued by a v1 volume.
    expect(parseSoundSettings({ master: null, volume: 0.1 }).master).toBe(DEFAULT_SOUND_SETTINGS.master);
  });

  it('survives unparseable storage', () => {
    localStorage.setItem('poker.sound', '{nope');
    reloadSoundSettings();
    expect(getSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
  });

  it('resets to defaults', () => {
    setMuted(true);
    setCategoryVolume('messages', 0);
    resetSoundSettings();
    expect(getSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(stored().categories.messages).toBe(DEFAULT_SOUND_SETTINGS.categories.messages);
  });

  it('useSoundSettings re-renders subscribers on change', () => {
    const { result } = renderHook(() => useSoundSettings());
    expect(result.current.muted).toBe(false);
    act(() => result.current.setMuted(true));
    expect(result.current.muted).toBe(true);
    act(() => result.current.setMaster(0.3));
    expect(result.current.master).toBeCloseTo(0.3);
    act(() => result.current.setCategoryVolume('wins', 0.1));
    expect(result.current.categories.wins).toBeCloseTo(0.1);
  });
});
