import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { EventEmitter } from 'events';
import { TableScreen } from './TableScreen';
import type { DiscordIdentity, GameState } from '@poker/shared';

function fakeSocket() {
  const ee = new EventEmitter();
  return {
    on: (ev: string, fn: (...a: any[]) => void) => { ee.on(ev, fn); return undefined as any; },
    off: (ev: string, fn: (...a: any[]) => void) => { ee.off(ev, fn); return undefined as any; },
    emit: vi.fn((ev: string, ...a: any[]) => { ee.emit(ev, ...a); return undefined as any; }),
    __ee: ee,
  };
}

const identity: DiscordIdentity = { discordUserId: 'me', displayName: 'You', avatarUrl: '', chipBalance: 10000 };

function state(): GameState {
  return {
    gameId: 'g', instanceId: 'i', phase: 'flop',
    players: [
      { discordUserId: 'me', displayName: 'You', avatarUrl: '', seatIndex: 0, chipStack: 3000, betThisRound: 0, totalBetThisHand: 0, holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }], status: 'active', hasActed: false, lastAction: null },
      { discordUserId: 'b', displayName: 'Bandit', avatarUrl: '', seatIndex: 1, chipStack: 4200, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false, lastAction: 'call' },
    ],
    communityCards: [{ rank: 'A', suit: 'hearts' }, { rank: '10', suit: 'diamonds' }, { rank: '4', suit: 'clubs' }],
    pots: [{ amount: 1450, eligiblePlayerIds: ['me', 'b'] }],
    currentPlayerIndex: 0, dealerIndex: 0, smallBlindIndex: 0, bigBlindIndex: 1,
    callAmount: 0, minRaise: 50, handNumber: 7,
    config: { buyIn: 3000, smallBlind: 50, bigBlind: 100, maxPlayers: 9, turnSeconds: 30 },
    spectators: [], viewerBankroll: 10000,
  };
}

describe('TableScreen', () => {
  it('requests state on mount and renders seats + pot from an update', () => {
    const socket = fakeSocket();
    render(<TableScreen socket={socket as any} identity={identity} />);
    expect(socket.emit).toHaveBeenCalledWith('request_game_state');
    act(() => { socket.__ee.emit('game_state_update', state()); });
    expect(screen.getByText('Bandit')).toBeInTheDocument();
    expect(screen.getByText('1,450')).toBeInTheDocument();
    expect(screen.getByText(/Hand #7/)).toBeInTheDocument();
  });
});
