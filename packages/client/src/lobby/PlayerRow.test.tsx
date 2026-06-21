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
  it('maps no table role + not ready to In Lobby', () => {
    expect(playerStatus(base, null)).toBe('In Lobby');
  });
  it('maps no table role + ready to Ready', () => {
    expect(playerStatus({ ...base, isReady: true }, null)).toBe('Ready');
  });
  it('maps a seated table member to In-Game · At Table', () => {
    expect(playerStatus(base, 'seated')).toBe('In-Game · At Table');
  });
  it('maps a spectator table member to In-Game · Spectating', () => {
    expect(playerStatus(base, 'spectator')).toBe('In-Game · Spectating');
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
