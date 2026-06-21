import { render, screen } from '@testing-library/react';
import type { TableConfig } from '@poker/shared';
import { TableSettings, currentBlindIndex, BLIND_LADDER } from './TableSettings';

const config: TableConfig = {
  buyIn: 3000,
  smallBlind: 25,
  bigBlind: 50,
  maxPlayers: 9,
  turnSeconds: 30,
};

function props(overrides: Partial<React.ComponentProps<typeof TableSettings>> = {}) {
  return {
    config,
    canEditConfig: true,
    isHost: true,
    status: 'waiting' as const,
    readyCount: 0,
    playerCount: 3,
    secondsLeft: 0,
    meIsReady: false,
    canStart: true,
    insufficientChips: false,
    onUpdateConfig: vi.fn(),
    onReadyToggle: vi.fn(),
    onStartCountdown: vi.fn(),
    onCancelCountdown: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
}

describe('currentBlindIndex', () => {
  it('finds the matching ladder entry', () => {
    expect(currentBlindIndex(25, 50)).toBe(1);
  });
  it('defaults to the [25,50] entry when no match', () => {
    expect(currentBlindIndex(7, 9)).toBe(1);
  });
});

describe('TableSettings', () => {
  it('emits a buy-in increase when host clicks +', () => {
    const p = props();
    render(<TableSettings {...p} />);
    screen.getByRole('button', { name: 'Increase buy-in' }).click();
    expect(p.onUpdateConfig).toHaveBeenCalledWith({ buyIn: 3500 });
  });

  it('emits both blinds when stepping the ladder up', () => {
    const p = props();
    render(<TableSettings {...p} />);
    screen.getByRole('button', { name: 'Increase blinds' }).click();
    expect(p.onUpdateConfig).toHaveBeenCalledWith({
      smallBlind: BLIND_LADDER[2][0],
      bigBlind: BLIND_LADDER[2][1],
    });
  });

  it('emits a clamped turn timer increase', () => {
    const p = props();
    render(<TableSettings {...p} />);
    screen.getByRole('button', { name: 'Increase turn timer' }).click();
    expect(p.onUpdateConfig).toHaveBeenCalledWith({ turnSeconds: 35 });
  });

  it('hides steppers for a non-host (read-only)', () => {
    const p = props({ canEditConfig: false, isHost: false });
    render(<TableSettings {...p} />);
    expect(screen.queryByRole('button', { name: 'Increase buy-in' })).toBeNull();
  });

  it('fires onStartCountdown for the host when idle', () => {
    const p = props();
    render(<TableSettings {...p} />);
    screen.getByRole('button', { name: /start game/i }).click();
    expect(p.onStartCountdown).toHaveBeenCalledOnce();
  });

  it('shows the insufficient-chips notice', () => {
    const p = props({ insufficientChips: true });
    render(<TableSettings {...p} />);
    expect(screen.getByText(/need .* chips/i)).toBeInTheDocument();
  });
});
