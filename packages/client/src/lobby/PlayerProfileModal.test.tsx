import { render, screen, fireEvent } from '@testing-library/react';
import type { LobbyPlayer } from '@poker/shared';
import { PlayerProfileModal } from './PlayerProfileModal';

vi.mock('./useStats', () => ({
  useStats: () => ({ stats: null, loading: false }),
}));

const player: LobbyPlayer = {
  discordUserId: 'u1',
  displayName: 'Maverick',
  avatarUrl: 'http://x/a.png',
  chipBalance: 88200,
  isReady: true,
  socketId: 's1',
};

it('shows the player name, chips, and stat labels', () => {
  render(<PlayerProfileModal player={player} lobbyStatus="waiting" onClose={vi.fn()} />);
  expect(screen.getByText('Maverick')).toBeInTheDocument();
  expect(screen.getByText('88,200')).toBeInTheDocument();
  expect(screen.getByText('WIN RATE')).toBeInTheDocument();
  expect(screen.getByText('HANDS WON')).toBeInTheDocument();
});

it('calls onClose when the close button is clicked', () => {
  const onClose = vi.fn();
  render(<PlayerProfileModal player={player} lobbyStatus="waiting" onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(onClose).toHaveBeenCalled();
});

it('calls onClose when the overlay is clicked', () => {
  const onClose = vi.fn();
  const { container } = render(<PlayerProfileModal player={player} lobbyStatus="waiting" onClose={onClose} />);
  fireEvent.click(container.firstChild as Element);
  expect(onClose).toHaveBeenCalled();
});

it('does NOT call onClose when clicking inside the card', () => {
  const onClose = vi.fn();
  render(<PlayerProfileModal player={player} lobbyStatus="waiting" onClose={onClose} />);
  fireEvent.click(screen.getByText('Maverick'));
  expect(onClose).not.toHaveBeenCalled();
});
