import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroHud } from './HeroHud';
import type { Card, GamePlayer } from '@poker/shared';

const community: Card[] = [
  { rank: 'A', suit: 'hearts' }, { rank: '10', suit: 'diamonds' }, { rank: '4', suit: 'clubs' },
];

function me(over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    discordUserId: 'me', displayName: 'You', avatarUrl: '', seatIndex: 0,
    chipStack: 3000, betThisRound: 0, totalBetThisHand: 0,
    holeCards: [{ rank: 'A', suit: 'spades' }, { rank: '10', suit: 'spades' }],
    status: 'active', hasActed: false, lastAction: null, ...over,
  };
}

describe('HeroHud', () => {
  it('shows the hand name, table chips and bank when seated', () => {
    render(<HeroHud me={me()} community={community} bank={10000} isSpectating={false} isMyTurn={false} turnSecondsLeft={null} />);
    expect(screen.getByText('Two Pair')).toBeInTheDocument();
    expect(screen.getByText('3,000')).toBeInTheDocument();
    expect(screen.getByText('10,000')).toBeInTheDocument();
  });

  it('shows a turn timer when it is the hero turn', () => {
    render(<HeroHud me={me()} community={community} bank={10000} isSpectating={false} isMyTurn turnSecondsLeft={12} />);
    expect(screen.getByText('12s')).toBeInTheDocument();
  });

  it('shows the spectating panel when spectating', () => {
    render(<HeroHud me={null} community={[]} bank={10000} isSpectating isMyTurn={false} turnSecondsLeft={null} />);
    expect(screen.getByText(/Watching the table/i)).toBeInTheDocument();
  });

  it('shows Folded when the hero has folded', () => {
    render(<HeroHud me={me({ status: 'folded' })} community={community} bank={10000} isSpectating={false} isMyTurn={false} turnSecondsLeft={null} />);
    expect(screen.getByText('Folded')).toBeInTheDocument();
  });
});
