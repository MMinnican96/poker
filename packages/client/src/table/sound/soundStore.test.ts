import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  DEFAULT_SOUND_SETTINGS,
  getSoundSettings,
  setMuted,
  setVolume,
  useSoundSettings,
} from './soundStore';

beforeEach(() => {
  localStorage.clear();
  // Reset to defaults between tests.
  setMuted(DEFAULT_SOUND_SETTINGS.muted);
  setVolume(DEFAULT_SOUND_SETTINGS.volume);
});

describe('soundStore', () => {
  it('defaults to unmuted at 0.7 volume', () => {
    localStorage.clear();
    expect(getSoundSettings().muted).toBe(false);
    expect(getSoundSettings().volume).toBeCloseTo(0.7);
  });

  it('persists mute + volume to localStorage and clamps volume to [0,1]', () => {
    setMuted(true);
    setVolume(1.5);
    expect(getSoundSettings().muted).toBe(true);
    expect(getSoundSettings().volume).toBe(1);
    setVolume(-3);
    expect(getSoundSettings().volume).toBe(0);
    const raw = JSON.parse(localStorage.getItem('poker.sound')!);
    expect(raw.muted).toBe(true);
    expect(raw.volume).toBe(0);
  });

  it('useSoundSettings re-renders subscribers on change', () => {
    const { result } = renderHook(() => useSoundSettings());
    expect(result.current.muted).toBe(false);
    act(() => result.current.setMuted(true));
    expect(result.current.muted).toBe(true);
    act(() => result.current.setVolume(0.3));
    expect(result.current.volume).toBeCloseTo(0.3);
  });
});
