import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableActionBar } from './TableActionBar';
import type { GameState, GamePlayer } from '@poker/shared';

function hero(over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    discordUserId: 'me', displayName: 'You', avatarUrl: '', seatIndex: 0,
    chipStack: 3000, betThisRound: 0, totalBetThisHand: 0,
    holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }],
    status: 'active', hasActed: false, lastAction: null, ...over,
  };
}

function state(over: Partial<GameState> = {}): GameState {
  return {
    gameId: 'g', instanceId: 'i', phase: 'flop', players: [hero()],
    communityCards: [], pots: [{ amount: 400, eligiblePlayerIds: ['me'] }],
    currentPlayerIndex: 0, dealerIndex: 0, smallBlindIndex: 0, bigBlindIndex: 0,
    callAmount: 0, minRaise: 50, handNumber: 1,
    config: { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 },
    ...over,
  };
}

function other(over: Partial<GamePlayer> = {}): GamePlayer {
  return { ...hero(), discordUserId: 'opp', displayName: 'Opp', ...over };
}

describe('TableActionBar', () => {
  it('renders the bar with disabled actions when it is not the hero turn', () => {
    const onAction = vi.fn();
    const { container } = render(
      <TableActionBar
        state={state({ players: [hero(), other()], currentPlayerIndex: 1 })}
        myId="me"
        onAction={onAction}
      />,
    );
    expect(container.firstChild).not.toBeNull();
    const fold = screen.getByRole('button', { name: 'Fold' });
    expect(fold).toBeDisabled();
    fireEvent.click(fold);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('returns null only when the viewer is spectating (no seat / sitting out)', () => {
    const { container } = render(
      <TableActionBar state={state({ players: [hero({ status: 'sitting-out' })] })} myId="me" onAction={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('emits check when there is nothing to call', () => {
    const onAction = vi.fn();
    render(<TableActionBar state={state()} myId="me" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'check' });
  });

  it('emits a raise to the slider value', () => {
    const onAction = vi.fn();
    render(<TableActionBar state={state()} myId="me" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /^Raise/ }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'raise' }));
  });

  it('emits all-in', () => {
    const onAction = vi.fn();
    render(<TableActionBar state={state()} myId="me" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'All-In' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'all-in' });
  });
});
