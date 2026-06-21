import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { ActiveGameSummary } from '@poker/shared';
import { ActiveGameCard } from './ActiveGameCard';

const summary: ActiveGameSummary = {
  gameId: 'G', handNumber: 4, buyIn: 3000, maxPlayers: 9,
  playingCount: 2, spectatingCount: 1, waitingForPlayers: false,
  members: [
    { discordUserId: 'a', displayName: 'Alice', avatarUrl: '', role: 'seated', chipStack: 5000, seatIndex: 0 },
    { discordUserId: 'b', displayName: 'Bob', avatarUrl: '', role: 'seated', chipStack: 1000, seatIndex: 1 },
    { discordUserId: 'c', displayName: 'Cy', avatarUrl: '', role: 'spectator', chipStack: 0, seatIndex: null },
  ],
};

it('shows playing/watching counts and joins on click', () => {
  const onJoinTable = vi.fn();
  render(<ActiveGameCard activeGame={summary} onJoinTable={onJoinTable} />);
  expect(screen.getByText(/2 PLAYING/i)).toBeInTheDocument();
  expect(screen.getByText(/1 WATCHING/i)).toBeInTheDocument();
  screen.getByRole('button', { name: /Join Table/i }).click();
  expect(onJoinTable).toHaveBeenCalled();
});
