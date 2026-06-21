import { render, screen } from '@testing-library/react';
import type { LobbyPlayer } from '@poker/shared';
import { PlayerRow, playerStatus } from './PlayerRow';

const base: LobbyPlayer = {
  discordUserId: 'u1',
  displayName: 'Alice',
  avatarUrl: 'http://x/a.png',
  chipBalance: 5000,
  isReady: false,
  socketId: 's1',
};

describe('playerStatus', () => {
  it('maps not-ready to In Lobby', () => {
    expect(playerStatus(base, 'waiting')).toBe('In Lobby');
  });
  it('maps ready to Ready', () => {
    expect(playerStatus({ ...base, isReady: true }, 'waiting')).toBe('Ready');
  });
  it('maps in-game lobby status to In-Game regardless of ready', () => {
    expect(playerStatus(base, 'in-game')).toBe('In-Game');
  });
});

describe('PlayerRow', () => {
  it('renders the name and status and fires onSelect', async () => {
    const onSelect = vi.fn();
    render(<PlayerRow player={base} status="Ready" onSelect={onSelect} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    screen.getByRole('button').click();
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
