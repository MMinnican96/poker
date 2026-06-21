import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroToken } from './HeroToken';
import type { GamePlayer } from '@poker/shared';

function hero(over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    discordUserId: 'me', displayName: 'You', avatarUrl: 'http://x/y.png', seatIndex: 0,
    chipStack: 3000, betThisRound: 0, totalBetThisHand: 0, holeCards: null,
    status: 'active', hasActed: false, lastAction: null, ...over,
  };
}

describe('HeroToken', () => {
  it('shows the YOU label, the avatar, the role badge and the action pill when seated', () => {
    render(<HeroToken player={hero({ lastAction: 'call' })} role="BB" isActive={false} timerPct={null} isSpectating={false} />);
    expect(screen.getByText('YOU')).toBeInTheDocument();
    expect(screen.getByText('BB')).toBeInTheDocument();
    expect(screen.getByText('Call')).toBeInTheDocument();
    expect(screen.getByTestId('hero-avatar').querySelector('img')).toHaveAttribute('src', 'http://x/y.png');
  });

  it('shows the SPECTATING variant when spectating', () => {
    render(<HeroToken player={null} role={null} isActive={false} timerPct={null} isSpectating />);
    expect(screen.getByText('SPECTATING')).toBeInTheDocument();
    expect(screen.queryByText('YOU')).not.toBeInTheDocument();
  });

  it('paints a countdown ring on the avatar when it is the hero turn', () => {
    render(<HeroToken player={hero()} role={null} isActive timerPct={70} isSpectating={false} />);
    expect(screen.getByTestId('hero-avatar')).toHaveAttribute('data-ring', 'true');
  });
});
