import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Main } from '../App';
import { Toaster } from '../app/Toaster';
import { makeLobby, makeMe, makeMember, makeSummary, makeTableView, renderWithClient } from '../test/harness';

beforeAll(() => {
  // jsdom has no matchMedia: report a desktop viewport (rail + sidebar).
  window.matchMedia = ((query: string) => ({
    matches: /min-width: (640|1024)px/.test(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

describe('Shell', () => {
  it('navigates between sections', async () => {
    const { store } = renderWithClient(<><Main /><Toaster /></>);
    act(() => store.dispatch({ type: 'lobby_state', lobby: makeLobby() }));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('button', { name: /Table/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: "The table's empty" })).toBeInTheDocument();

    // Feature screens are lazy chunks: they appear once loaded.
    await userEvent.click(within(nav).getByRole('button', { name: /Leaderboard/ }));
    expect(await screen.findByRole('heading', { name: 'Leaderboard' })).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole('button', { name: /Shop/ }));
    expect(await screen.findByRole('heading', { name: 'Shop' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /Shop/ })).toHaveAttribute('aria-current', 'page');
  });

  it('shows unread message and unclaimed challenge badges from me', () => {
    const { store } = renderWithClient(<><Main /><Toaster /></>, { me: makeMe({ unreadMessages: 3, unclaimedChallenges: 1 }) });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('button', { name: /Messages/ })).toHaveTextContent('3 unread messages');
    expect(within(nav).getByRole('button', { name: /Challenges/ })).toHaveTextContent('1 challenge to claim');
    act(() => store.dispatch({ type: 'me', me: makeMe({ unreadMessages: 0, unclaimedChallenges: 0 }) }));
    expect(within(nav).getByRole('button', { name: /Messages/ })).not.toHaveTextContent('unread');
  });

  it('shows bankroll, and claims the daily bonus with a toast', async () => {
    const claimDaily = vi.fn(async () => ({ ok: true as const, amount: 750, balance: 10_750, streak: 2 }));
    renderWithClient(<><Main /><Toaster /></>, { me: makeMe({ daily: { available: true, streak: 2, nextAmount: 750 } }), api: { claimDaily } });
    expect(screen.getByText('10,000 chips')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Claim daily bonus' }));
    expect(claimDaily).toHaveBeenCalled();
    expect(await screen.findByText('Daily bonus claimed')).toBeInTheDocument();
  });

  it('lists who is here with presence in the room panel', async () => {
    const { store } = renderWithClient(<><Main /><Toaster /></>);
    act(() =>
      store.dispatch({
        type: 'lobby_state',
        lobby: makeLobby({ members: [makeMember('p1', 'Alice'), makeMember('p2', 'Bob', { presence: 'playing' })] }),
      }),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Here (2)' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Bob')).toBeInTheDocument();
    expect(within(panel).getByText('At the table')).toBeInTheDocument();
  });

  it('sends room chat', async () => {
    const { socket } = renderWithClient(<><Main /><Toaster /></>);
    await userEvent.type(screen.getByRole('textbox', { name: 'Message the room' }), 'gl all{Enter}');
    expect(socket.events('chat_send')[0].args[0]).toEqual({ to: { room: true }, body: 'gl all' });
  });

  it('explains why taking a seat is disabled', () => {
    const { store } = renderWithClient(<><Main /><Toaster /></>, { me: makeMe({ balance: 300 }) });
    act(() => store.dispatch({ type: 'lobby_state', lobby: makeLobby({ table: makeSummary() }) }));
    expect(screen.getByRole('button', { name: 'Take a seat' })).toBeDisabled();
    expect(screen.getByText('You need 1,000 chips to buy in. You have 300.')).toBeInTheDocument();
  });

  it('switches to the table screen when a table_state arrives and back on table_left', async () => {
    const { store } = renderWithClient(<><Main /><Toaster /></>);
    act(() => store.dispatch({ type: 'lobby_state', lobby: makeLobby({ table: makeSummary() }) }));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    act(() => store.dispatch({ type: 'table_state', view: makeTableView({ hostId: 'p2' }), receivedAt: Date.now() }));
    // The table screen is a lazy chunk.
    expect(await screen.findByRole('button', { name: 'Leave table' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    act(() => store.dispatch({ type: 'table_left', left: { code: 'host-closed', reason: 'The host closed the table.' } }));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByText('The host closed the table.')).toBeInTheDocument();
  });

  it('only toasts when you did not leave yourself', async () => {
    const { store } = renderWithClient(<><Main /><Toaster /></>);
    const sit = async () => {
      act(() => store.dispatch({ type: 'table_state', view: makeTableView({ hostId: 'p2' }), receivedAt: Date.now() }));
      await screen.findByRole('button', { name: 'Leave table' });
    };
    await sit();
    act(() => store.dispatch({ type: 'table_left', left: { code: 'left', reason: 'You left the table.' } }));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.queryByText('You left the table.')).not.toBeInTheDocument();

    await sit();
    act(() => store.dispatch({ type: 'table_left', left: { code: 'shutdown', reason: 'The server is restarting.' } }));
    expect(screen.getByText('The server is restarting.')).toBeInTheDocument();

    await sit();
    const interrupted = 'The table was interrupted by a server problem.';
    act(() => store.dispatch({ type: 'table_left', left: { code: 'interrupted', reason: interrupted } }));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByText(interrupted)).toBeInTheDocument();
  });
});
