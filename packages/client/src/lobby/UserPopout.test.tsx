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

describe('UserPopout seat actions', () => {
  it('shows Spectate and Leave Table when seated and playing', () => {
    const onSpectate = vi.fn();
    render(
      <UserPopout
        identity={identity}
        stats={null}
        onClose={() => {}}
        seat={{
          mode: 'playing', buyIn: 3000, canJoin: true, joinReason: '', pending: null,
          leaveHint: 'Back to the lobby', onSpectate, onJoin: () => {}, onLeave: () => {}, onCancelPending: () => {},
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Spectate/i }));
    expect(onSpectate).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Leave Table/i })).toBeInTheDocument();
  });

  it('disables Join with a reason when canJoin is false', () => {
    render(
      <UserPopout
        identity={identity}
        stats={null}
        onClose={() => {}}
        seat={{
          mode: 'spectating', buyIn: 3000, canJoin: false, joinReason: 'Not enough chips', pending: null,
          leaveHint: 'Any time', onSpectate: () => {}, onJoin: () => {}, onLeave: () => {}, onCancelPending: () => {},
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /Join Table/i })).toBeDisabled();
    expect(screen.getByText('Not enough chips')).toBeInTheDocument();
  });
});
