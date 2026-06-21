import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const handlers: Record<string, (arg?: unknown) => void> = {};
const fakeSocket = {
  on: (e: string, h: (arg?: unknown) => void) => { handlers[e] = h; },
  off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(),
};
vi.mock('./socket', () => ({ createSocket: () => fakeSocket }));
vi.mock('./discord', () => ({
  setupDiscord: () => Promise.resolve({
    identity: { discordUserId: 'a', displayName: 'A', avatarUrl: '', chipBalance: 3000 },
    instanceId: 'I',
  }),
}));
vi.mock('./GameCanvas', () => ({ GameCanvas: () => <div>TABLE VIEW</div> }));
vi.mock('./lobby/LobbyScreen', () => ({ LobbyScreen: () => <div>LOBBY VIEW</div> }));

import { App } from './App';

afterEach(() => {
  cleanup();
  for (const k of Object.keys(handlers)) delete handlers[k];
  fakeSocket.emit.mockClear();
  fakeSocket.off.mockClear();
  fakeSocket.disconnect.mockClear();
});

/** Render App and wait until its membership effect has registered socket handlers. */
async function renderAppReady() {
  render(<App />);
  await screen.findByText('LOBBY VIEW');
  await waitFor(() => expect(handlers['joined_table']).toBeTypeOf('function'));
}

it('switches to the table on joined_table and back on left_table', async () => {
  await renderAppReady();
  act(() => handlers['joined_table']!({ gameId: 'G', role: 'seated' }));
  expect(screen.getByText('TABLE VIEW')).toBeInTheDocument();
  act(() => handlers['left_table']!());
  expect(screen.getByText('LOBBY VIEW')).toBeInTheDocument();
});

it('requests the current game state when joining the table', async () => {
  await renderAppReady();
  act(() => handlers['joined_table']!({ gameId: 'G', role: 'seated' }));
  expect(fakeSocket.emit).toHaveBeenCalledWith('request_game_state');
});
