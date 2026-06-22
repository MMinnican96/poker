import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CenterCluster } from './CenterCluster';
import type { Card, Pot } from '@poker/shared';

const board: Card[] = [
  { rank: 'A', suit: 'hearts' }, { rank: '10', suit: 'diamonds' }, { rank: '4', suit: 'clubs' },
];

describe('CenterCluster', () => {
  it('renders the flop cards and the main pot total', () => {
    const pots: Pot[] = [{ amount: 1450, eligiblePlayerIds: ['a', 'b'] }];
    render(<CenterCluster phase="flop" community={board} pots={pots} />);
    expect(screen.getAllByTestId('card-face')).toHaveLength(3);
    expect(screen.getByText('1,450')).toBeInTheDocument();
  });

  it('shows a side-pot pill when there is more than one pot', () => {
    const pots: Pot[] = [
      { amount: 1450, eligiblePlayerIds: ['a', 'b'] },
      { amount: 600, eligiblePlayerIds: ['a'] },
    ];
    render(<CenterCluster phase="river" community={board} pots={pots} />);
    expect(screen.getByText(/SIDE/)).toBeInTheDocument();
    expect(screen.getByText('600')).toBeInTheDocument();
  });

  it('renders a winner banner when provided', () => {
    render(<CenterCluster phase="hand-complete" community={board} pots={[{ amount: 100, eligiblePlayerIds: ['a'] }]} banner="Alice wins with a Flush" />);
    expect(screen.getByText('Alice wins with a Flush')).toBeInTheDocument();
  });
});
