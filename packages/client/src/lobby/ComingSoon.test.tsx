import { render, screen } from '@testing-library/react';
import { ComingSoon } from './ComingSoon';

it('renders the title and a coming-soon badge', () => {
  render(<ComingSoon title="Leaderboard" />);
  expect(screen.getByText('Leaderboard')).toBeInTheDocument();
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
});
