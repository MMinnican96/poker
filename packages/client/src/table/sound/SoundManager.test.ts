import { describe, it, expect } from 'vitest';
import { createSoundManager } from './SoundManager';

describe('SoundManager (jsdom, no AudioContext)', () => {
  it('constructs and no-ops without throwing when Web Audio is unavailable', () => {
    const m = createSoundManager();
    m.setSettings({ muted: false, volume: 0.5 });
    expect(() => m.unlock()).not.toThrow();
    expect(() => m.play('bet')).not.toThrow();
    expect(() => m.play('suspense', { rate: 1.2 })).not.toThrow();
  });

  it('does not throw when muted', () => {
    const m = createSoundManager();
    m.setSettings({ muted: true, volume: 0.5 });
    expect(() => m.play('win')).not.toThrow();
  });
});
