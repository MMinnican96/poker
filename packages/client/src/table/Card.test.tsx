import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayingCard } from './Card';

describe('PlayingCard', () => {
  it('renders the rank and a red suit for hearts when face-up', () => {
    render(<PlayingCard card={{ rank: 'A', suit: 'hearts' }} reveal />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByTestId('card-face')).toHaveAttribute('data-red', 'true');
  });

  it('renders a card back when card is null', () => {
    render(<PlayingCard card={null} />);
    expect(screen.getByTestId('card-back')).toBeInTheDocument();
  });
});
