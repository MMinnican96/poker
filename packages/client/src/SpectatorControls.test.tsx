import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { GameState } from '@poker/shared';
import { SpectatorControls } from './SpectatorControls';

function baseState(over: Partial<GameState> = {}): GameState {
  return {
    gameId: 'G', instanceId: 'I', phase: 'flop', players: [
      { discordUserId: 'a', displayName: 'A', avatarUrl: '', seatIndex: 0, chipStack: 3000, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false },
    ],
    communityCards: [], pots: [], currentPlayerIndex: 0, dealerIndex: 0, smallBlindIndex: 0,
    bigBlindIndex: 0, callAmount: 0, minRaise: 50, handNumber: 1,
    config: { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 },
    spectators: [{ discordUserId: 'c', displayName: 'Cy', avatarUrl: '' }],
    waitingForPlayers: false, viewerPending: null, ...over,
  };
}

it('spectator can Join Next Hand when funded and a seat is free', () => {
  const onSitIn = vi.fn();
  render(<SpectatorControls state={baseState()} myId="c" bankroll={3000} onSitIn={onSitIn} onSitOut={vi.fn()} onLeave={vi.fn()} onCancelPending={vi.fn()} />);
  const btn = screen.getByRole('button', { name: /Join Next Hand/i });
  expect(btn).not.toBeDisabled();
  btn.click();
  expect(onSitIn).toHaveBeenCalled();
});

it('Join Next Hand is disabled and explains why when underfunded', () => {
  render(<SpectatorControls state={baseState()} myId="c" bankroll={100} onSitIn={vi.fn()} onSitOut={vi.fn()} onLeave={vi.fn()} onCancelPending={vi.fn()} />);
  const btn = screen.getByRole('button', { name: /Join Next Hand/i });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('title', expect.stringMatching(/chips/i));
});

it('seated player with a pending leave shows a Cancel control', () => {
  const onCancel = vi.fn();
  render(<SpectatorControls state={baseState({ viewerPending: 'leave' })} myId="a" bankroll={0} onSitIn={vi.fn()} onSitOut={vi.fn()} onLeave={vi.fn()} onCancelPending={onCancel} />);
  screen.getByRole('button', { name: /Cancel/i }).click();
  expect(onCancel).toHaveBeenCalled();
});

it('spectator with a pending seat shows a Cancel — joining next hand control', () => {
  const onCancel = vi.fn();
  render(
    <SpectatorControls
      state={baseState({ viewerPending: 'seat' })}
      myId="c"
      bankroll={3000}
      onSitIn={vi.fn()}
      onSitOut={vi.fn()}
      onLeave={vi.fn()}
      onCancelPending={onCancel}
    />,
  );
  // Join Next Hand should NOT be shown while a seat is pending.
  expect(screen.queryByRole('button', { name: /Join Next Hand/i })).toBeNull();
  screen.getByRole('button', { name: /Cancel/i }).click();
  expect(onCancel).toHaveBeenCalled();
});

it('uses the live viewerBankroll to gate Join Next Hand', () => {
  // identity bankroll is high/stale (3000), but the live viewerBankroll is 100 → underfunded.
  const state = baseState({ viewerBankroll: 100 });
  render(<SpectatorControls state={state} myId="c" bankroll={3000} onSitIn={vi.fn()} onSitOut={vi.fn()} onLeave={vi.fn()} onCancelPending={vi.fn()} />);
  const btn = screen.getByRole('button', { name: /Join Next Hand/i });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('title', expect.stringMatching(/chips/i));
});

it('seated player with no pending shows Move to Spectate and Leave Table', () => {
  const onSitOut = vi.fn();
  const onLeave = vi.fn();
  render(
    <SpectatorControls
      state={baseState({ viewerPending: null })}
      myId="a"
      bankroll={0}
      onSitIn={vi.fn()}
      onSitOut={onSitOut}
      onLeave={onLeave}
      onCancelPending={vi.fn()}
    />,
  );
  screen.getByRole('button', { name: /Move to Spectate/i }).click();
  expect(onSitOut).toHaveBeenCalled();
  screen.getByRole('button', { name: /Leave Table/i }).click();
  expect(onLeave).toHaveBeenCalled();
});
