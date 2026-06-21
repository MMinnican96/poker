import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableHeader } from './TableHeader';
import type { DiscordIdentity, TableConfig } from '@poker/shared';

const identity: DiscordIdentity = { discordUserId: 'me', displayName: 'You', avatarUrl: '', chipBalance: 10000 };
const config: TableConfig = { buyIn: 3000, smallBlind: 50, bigBlind: 100, maxPlayers: 9, turnSeconds: 30 };

describe('TableHeader', () => {
  it('shows the hand number, blinds and spectator count', () => {
    render(
      <TableHeader identity={identity} handNumber={1284} config={config}
        spectators={[{ discordUserId: 's', displayName: 'Squeak', avatarUrl: '' }]}
        heroStack={3000} onOpenUser={() => {}} />,
    );
    expect(screen.getByText(/Hand #1,284/)).toBeInTheDocument();
    expect(screen.getByText(/50 \/ 100/)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // spectator count
  });

  it('opens the user menu when the user button is clicked', () => {
    const onOpenUser = vi.fn();
    render(
      <TableHeader identity={identity} handNumber={1} config={config} spectators={[]}
        heroStack={null} onOpenUser={onOpenUser} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /You/ }));
    expect(onOpenUser).toHaveBeenCalledOnce();
  });
});
