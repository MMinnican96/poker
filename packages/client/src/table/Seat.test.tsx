import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Seat } from './Seat';
import type { GamePlayer } from '@poker/shared';

const pos = { leftPct: 50, topPct: 5, betLeftPct: 50, betTopPct: 30 };

function player(over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    discordUserId: 'b', displayName: 'Bandit', avatarUrl: 'http://x/y.png', seatIndex: 1,
    chipStack: 4200, betThisRound: 200, totalBetThisHand: 200, holeCards: null,
    status: 'active', hasActed: true, lastAction: 'call', ...over,
  };
}

function p(over: Partial<GamePlayer> = {}): GamePlayer {
  return { discordUserId: 'b', displayName: 'Bandit', avatarUrl: '', seatIndex: 1, chipStack: 1000, betThisRound: 0, totalBetThisHand: 0, holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }], status: 'active', hasActed: false, lastAction: null, ...over };
}

describe('Seat — showdown', () => {
  it('shows the hand label under revealed cards', () => {
    render(<Seat player={p()} pos={pos} role={null} isActive={false} timerPct={null} reveal handLabel="Two Pair" isWinner={false} onOpen={() => {}} />);
    expect(screen.getByText('Two Pair')).toBeInTheDocument();
  });

  it('marks the root with the seat id and a winner flag', () => {
    const { container } = render(<Seat player={p()} pos={pos} role={null} isActive={false} timerPct={null} reveal handLabel={null} isWinner onOpen={() => {}} />);
    const root = container.querySelector('[data-seat-id="b"]');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('data-winner', 'true');
  });
});

describe('Seat', () => {
  it('shows name, stack, the action pill and a role badge', () => {
    render(<Seat player={player()} pos={pos} role="BB" isActive={false} timerPct={null} reveal={false} onOpen={() => {}} />);
    expect(screen.getByText('Bandit')).toBeInTheDocument();
    expect(screen.getByText('4,200')).toBeInTheDocument();
    expect(screen.getByText('Call')).toBeInTheDocument();
    expect(screen.getByText('BB')).toBeInTheDocument();
  });

  it('labels an all-in player regardless of lastAction', () => {
    render(<Seat player={player({ status: 'all-in' })} pos={pos} role={null} isActive={false} timerPct={null} reveal={false} onOpen={() => {}} />);
    expect(screen.getByText('All-In')).toBeInTheDocument();
  });

  it('reveals hole-card faces when reveal is true', () => {
    const p = player({ holeCards: [{ rank: 'K', suit: 'hearts' }, { rank: 'Q', suit: 'hearts' }] });
    render(<Seat player={p} pos={pos} role={null} isActive={false} timerPct={null} reveal onOpen={() => {}} />);
    expect(screen.getAllByTestId('card-face').length).toBe(2);
  });

  it('calls onOpen when the avatar is clicked', () => {
    const onOpen = vi.fn();
    render(<Seat player={player()} pos={pos} role={null} isActive={false} timerPct={null} reveal={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Bandit/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
