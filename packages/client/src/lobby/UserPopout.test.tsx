import { render, screen, fireEvent } from '@testing-library/react';
import type { DiscordIdentity } from '@poker/shared';
import { UserPopout } from './UserPopout';

const identity: DiscordIdentity = {
  discordUserId: 'u1',
  displayName: 'You',
  avatarUrl: 'http://x/a.png',
  chipBalance: 42500,
};

it('shows Profile stats by default and switches to a Coming Soon Settings tab', () => {
  render(<UserPopout identity={identity} stats={null} onClose={vi.fn()} />);
  expect(screen.getByText('WIN RATE')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
});
