import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundManager } from './SoundManager';
import { SoundSettingsDialog } from './SoundSettingsDialog';
import { DEFAULT_SOUND_SETTINGS, getSoundSettings, resetSoundSettings, setMuted } from './soundStore';

function setup() {
  const played: string[] = [];
  const manager: SoundManager = { unlock: vi.fn(), setSettings: vi.fn(), play: vi.fn((n) => void played.push(n)) };
  const onClose = vi.fn();
  render(<SoundSettingsDialog open onClose={onClose} manager={manager} />);
  return { played, manager, onClose };
}

beforeEach(() => {
  localStorage.clear();
  resetSoundSettings();
});

describe('SoundSettingsDialog', () => {
  it('sets the overall and per-group volumes', () => {
    setup();
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '40' } });
    expect(getSoundSettings().master).toBeCloseTo(0.4);
    fireEvent.change(screen.getByRole('slider', { name: 'Cards' }), { target: { value: '15' } });
    expect(getSoundSettings().categories.cards).toBeCloseTo(0.15);
    expect(screen.getByRole('slider', { name: 'Your turn and timer' })).toHaveAttribute('aria-valuetext', '80%');
  });

  it('plays a sample of each group', async () => {
    const { played, manager } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Play a sample: chips and actions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play a sample: messages' }));
    expect(played).toEqual(['bet', 'message']);
    // Samples are player-requested, so a slow first load doesn't drop them.
    expect(manager.play).toHaveBeenCalledWith('bet', { requested: true });
    expect(manager.unlock).toHaveBeenCalled();
  });

  it('switches timer ticks off and on', async () => {
    setup();
    const ticks = screen.getByRole('switch', { name: 'Timer ticks' });
    expect(ticks).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(ticks);
    expect(getSoundSettings().timerTicks).toBe(false);
    expect(ticks).toHaveAttribute('aria-checked', 'false');
  });

  it('makes muting obvious and offers to turn sound back on', async () => {
    setMuted(true);
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('All sound is muted.');
    expect(screen.getByRole('button', { name: 'Play a sample: cards' })).toBeDisabled();
    // One toggle with a fixed name and a pressed state, and one "Turn sound on".
    expect(screen.getByRole('button', { name: 'Mute all sound' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Turn sound on' }));
    expect(getSoundSettings().muted).toBe(false);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'Mute all sound' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('moving the volume while muted unmutes', () => {
    setMuted(true);
    setup();
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '50' } });
    expect(getSoundSettings().muted).toBe(false);
  });

  it('resets to defaults and closes with Done', async () => {
    const { onClose } = setup();
    fireEvent.change(screen.getByRole('slider', { name: 'Wins and stings' }), { target: { value: '0' } });
    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(getSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
