import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS, parseCards, type Card, type HandView, type LegalActions, type SeatPlayer, type TableView } from '@poker/shared';
import { makeMe, makeTableView, renderWithClient, type FakeSocket } from '../test/harness';
import { TableScreen } from './TableScreen';

function seatPlayer(id: string, name: string, patch: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    id, name, avatarUrl: '', level: 1, cosmetics: DEFAULT_COSMETICS, stack: 5000, state: 'playing', connected: true,
    inHand: false, folded: false, allIn: false, committed: 0, holeCards: null, hasHiddenCards: false, lastAction: null,
    pending: null, sittingOut: false, pendingTopUp: 0, ...patch,
  };
}

function hand(patch: Partial<HandView> = {}): HandView {
  return {
    handNumber: 7, street: 'pre-flop', board: [], pots: [], potTotal: 75, buttonSeat: 0, smallBlindSeat: 2, bigBlindSeat: 4,
    toActSeat: 0, actionEndsAt: null, currentBet: 50, result: null, ...patch,
  };
}

const cards = (s: string) => parseCards(s) as [Card, Card];

const LEGAL: LegalActions = { canFold: true, canCheck: false, callAmount: 50, canRaise: true, minRaiseTo: 100, maxRaiseTo: 5000, allInTo: 5000 };

/** A running 3-handed table where you (Alice, p1) sit in seat 0 of 6. */
function running(opts: { you?: Partial<TableView['you']>; hand?: Partial<HandView>; players?: Partial<Record<string, Partial<SeatPlayer>>> } = {}): TableView {
  const base = makeTableView({ status: 'running', hostId: 'p1' });
  const ps = opts.players ?? {};
  const seats = base.seats.map((s) => {
    if (s.seat === 0) return { seat: 0, player: seatPlayer('p1', 'Alice', { inHand: true, holeCards: cards('Ah Kh'), ...ps.p1 }) };
    if (s.seat === 2) return { seat: 2, player: seatPlayer('p2', 'Bob', { inHand: true, hasHiddenCards: true, committed: 25, ...ps.p2 }) };
    if (s.seat === 4) return { seat: 4, player: seatPlayer('p3', 'Cara', { inHand: true, hasHiddenCards: true, committed: 50, ...ps.p3 }) };
    return s;
  });
  return {
    ...base,
    seats,
    hand: hand(opts.hand),
    you: { ...base.you, role: 'seated', seat: 0, legal: null, ...opts.you },
  };
}

function setup(view: TableView) {
  const r = renderWithClient(<TableScreen />);
  act(() => r.socket.serverEmit('table_state', view));
  return r;
}

const push = (socket: FakeSocket, view: TableView) => act(() => socket.serverEmit('table_state', view));
const acts = (socket: FakeSocket) => socket.events('act').map((e) => e.args[0]);

describe('seats', () => {
  it('rotates the table so your seat is at the bottom centre', () => {
    const view = running();
    // Put yourself in seat 3 instead of 0.
    view.seats = view.seats.map((s) => (s.seat === 0 ? { seat: 0, player: null } : s.seat === 3 ? { seat: 3, player: seatPlayer('p1', 'Alice', { inHand: true, holeCards: cards('Ah Kh') }) } : s));
    view.you = { ...view.you, seat: 3 };
    const { container } = setup(view);
    const tops = [...container.querySelectorAll<HTMLElement>('li[data-seat]')].map((li) => ({ seat: li.dataset.seat, top: parseFloat(li.style.top), left: parseFloat(li.style.left) }));
    const lowest = tops.reduce((a, b) => (b.top > a.top ? b : a));
    expect(lowest.seat).toBe('3');
    const stage = { width: 1000 };
    expect(lowest.left).toBeCloseTo(stage.width / 2, 0);
  });

  it('shows watchers seat 1 at the bottom and "Sit here" on empty seats', () => {
    const view = running({ you: { role: 'spectator', seat: null } });
    view.seats = view.seats.map((s) => (s.seat === 0 ? { seat: 0, player: seatPlayer('p9', 'Dee', { inHand: true, hasHiddenCards: true }) } : s));
    const { container } = setup(view);
    const lis = [...container.querySelectorAll<HTMLElement>('li[data-seat]')];
    const lowest = lis.reduce((a, b) => (parseFloat(b.style.top) > parseFloat(a.style.top) ? b : a));
    expect(lowest.dataset.seat).toBe('0');
    expect(screen.getByRole('button', { name: 'Sit here, seat 2' })).toBeEnabled();
  });

  it("draws opponents' face-down cards and names your own", () => {
    setup(running());
    expect(screen.getByRole('group', { name: 'Your cards' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ace of hearts' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: "Bob's cards, face down" })).getAllByRole('img', { name: 'Face-down card' })).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Dealer button' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Bob bet 25 \(small blind\)/ })).toBeInTheDocument();
  });
});

describe('action bar', () => {
  it('shows fold, call and raise from the legal actions and sends them', async () => {
    const { socket } = setup(running({ you: { legal: LEGAL } }));
    const bar = screen.getByRole('group', { name: 'Your action' });
    expect(within(bar).getByRole('button', { name: /Fold/ })).toBeEnabled();
    expect(within(bar).getByRole('button', { name: /Call 50/ })).toBeEnabled();
    expect(within(bar).getByRole('button', { name: /Raise/ })).toBeEnabled();
    await userEvent.click(within(bar).getByRole('button', { name: /Call 50/ }));
    expect(acts(socket)).toEqual([{ type: 'call' }]);
  });

  it('offers check instead of call, and hides raise when raising is not allowed', () => {
    setup(running({ you: { legal: { ...LEGAL, canCheck: true, callAmount: 0, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0 } } }));
    const bar = screen.getByRole('group', { name: 'Your action' });
    expect(within(bar).getByRole('button', { name: /Check/ })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /Call/ })).toBeNull();
    expect(within(bar).queryByRole('button', { name: /Raise|Bet/ })).toBeNull();
  });

  it('keeps the raise inside the legal bounds and labels the top as all-in or max', async () => {
    const { socket } = setup(running({ you: { legal: { ...LEGAL, minRaiseTo: 100, maxRaiseTo: 800, allInTo: 5000 } } }));
    await userEvent.click(screen.getByRole('button', { name: /^Raise/ }));
    const tray = screen.getByRole('form', { name: 'Raise amount' });
    expect(within(tray).getByRole('button', { name: 'Max' })).toBeInTheDocument();
    expect(within(tray).queryByRole('button', { name: 'All-in' })).toBeNull();
    const slider = within(tray).getByRole('slider');
    expect(slider).toHaveAttribute('min', '100');
    expect(slider).toHaveAttribute('max', '800');
    const input = within(tray).getByRole('textbox', { name: 'Raise to' });
    await userEvent.clear(input);
    await userEvent.type(input, '99999{Enter}');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(acts(socket)).toEqual([{ type: 'raise', amount: 800 }]);
  });

  it('says all-in when the largest raise is your whole stack', async () => {
    setup(running({ you: { legal: { ...LEGAL, maxRaiseTo: 5000, allInTo: 5000 } } }));
    await userEvent.click(screen.getByRole('button', { name: /^Raise/ }));
    expect(screen.getByRole('button', { name: 'All-in' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All-in' }));
    expect(screen.getByRole('button', { name: 'All-in 5,000' })).toBeInTheDocument();
  });

  it('answers keyboard shortcuts', async () => {
    const { socket } = setup(running({ you: { legal: LEGAL } }));
    fireEvent.keyDown(window, { key: 'c' });
    await act(async () => {});
    expect(acts(socket)).toEqual([{ type: 'call' }]);
  });

  it('says "Bet" when nobody has bet this street', async () => {
    setup(running({ hand: { street: 'flop', currentBet: 0 }, you: { legal: { ...LEGAL, canCheck: true, callAmount: 0, minRaiseTo: 50 } } }));
    expect(screen.getByRole('button', { name: /^Bet/ })).toBeInTheDocument();
  });
});

describe('pre-actions', () => {
  it('fires a queued "Call any" when your turn arrives', async () => {
    const { socket } = setup(running({ hand: { toActSeat: 2 } }));
    await userEvent.click(screen.getByRole('button', { name: 'Call any' }));
    expect(screen.getByRole('button', { name: 'Call any' })).toHaveAttribute('aria-pressed', 'true');
    push(socket, running({ hand: { toActSeat: 0, currentBet: 300 }, you: { legal: { ...LEGAL, callAmount: 300 } } }));
    await act(async () => {});
    expect(acts(socket)).toEqual([{ type: 'call' }]);
  });

  it('clears a queued "Check" when the bet changes, and does not act', async () => {
    const start = running({ hand: { street: 'flop', currentBet: 0, toActSeat: 2 }, players: { p2: { committed: 0 }, p3: { committed: 0 } } });
    const { socket } = setup(start);
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('button', { name: 'Check' })).toHaveAttribute('aria-pressed', 'true');
    // Bob bets 200: "Check" is no longer offered or armed.
    push(socket, running({ hand: { street: 'flop', currentBet: 200, toActSeat: 4 }, players: { p2: { committed: 200, lastAction: { type: 'bet', amount: 200 } }, p3: { committed: 0 } } }));
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull();
    push(socket, running({ hand: { street: 'flop', currentBet: 200, toActSeat: 0 }, you: { legal: { ...LEGAL, callAmount: 200 } } }));
    await act(async () => {});
    expect(acts(socket)).toEqual([]);
    expect(screen.getByRole('group', { name: 'Your action' })).toBeInTheDocument();
  });

  it('keeps "Check/fold" through a bet and folds', async () => {
    const { socket } = setup(running({ hand: { street: 'flop', currentBet: 0, toActSeat: 2 }, players: { p2: { committed: 0 }, p3: { committed: 0 } } }));
    await userEvent.click(screen.getByRole('button', { name: 'Check/fold' }));
    push(socket, running({ hand: { street: 'flop', currentBet: 200, toActSeat: 4 }, players: { p2: { committed: 200 } } }));
    expect(screen.getByRole('button', { name: 'Fold' })).toHaveAttribute('aria-pressed', 'true');
    push(socket, running({ hand: { street: 'flop', currentBet: 200, toActSeat: 0 }, you: { legal: { ...LEGAL, callAmount: 200 } } }));
    await act(async () => {});
    expect(acts(socket)).toEqual([{ type: 'fold' }]);
  });

  it('resets on a new street', async () => {
    const { socket } = setup(running({ hand: { toActSeat: 2 } }));
    await userEvent.click(screen.getByRole('button', { name: 'Call any' }));
    push(socket, running({ hand: { street: 'flop', currentBet: 0, toActSeat: 2, board: parseCards('2c 7d 9s') } }));
    expect(screen.getByRole('button', { name: 'Call any' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('showdown', () => {
  it('names the winner and the hand, and keeps unshown cards hidden', () => {
    const board = parseCards('Ad Kd 7c 2s 9h');
    const view = running({
      hand: {
        street: 'showdown', board, toActSeat: null, potTotal: 1200, currentBet: 0,
        result: {
          payouts: { p2: 1200 },
          pots: [{ amount: 1200, winnerIds: ['p2'], handLabel: 'Two pair, aces and kings' }],
          shown: {
            p2: { cards: cards('As Ks'), category: 'two-pair', label: 'Two pair, aces and kings', best: parseCards('As Ad Ks Kd 9h') },
            p1: { cards: cards('Ah Qh'), category: 'pair', label: 'Pair of aces', best: parseCards('Ah Ad Qh Kd 9h') },
          },
          returned: {},
          wentToShowdown: true,
        },
      },
      players: {
        p1: { holeCards: cards('Ah Qh'), committed: 0 },
        p2: { holeCards: cards('As Ks'), hasHiddenCards: false, committed: 0, stack: 6200 },
        // Cara reached showdown but didn't table her hand.
        p3: { hasHiddenCards: true, committed: 0 },
      },
    });
    setup(view);
    expect(screen.getByText('Bob wins 1,200')).toBeInTheDocument();
    expect(screen.getAllByText('Two pair, aces and kings').length).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: "Bob's cards" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Seat 3, Bob, .*won 1,200/ })).toBeInTheDocument();
    const cara = screen.getByRole('group', { name: "Cara's cards, face down" });
    expect(within(cara).getAllByRole('img', { name: 'Face-down card' })).toHaveLength(2);
    expect(screen.queryByRole('group', { name: "Cara's cards" })).toBeNull();
  });

  it('shows a fold-out as "X wins N" without a hand', () => {
    setup(running({
      hand: {
        toActSeat: null,
        result: { payouts: { p3: 75 }, pots: [{ amount: 75, winnerIds: ['p3'], handLabel: null }], shown: {}, returned: { p3: 25 }, wentToShowdown: false },
      },
    }));
    expect(screen.getByText('Cara wins 75')).toBeInTheDocument();
  });

  it('says "You win" when it is you, and "split" for a chop', () => {
    setup(running({
      hand: {
        toActSeat: null,
        result: {
          payouts: { p1: 400, p2: 400 },
          pots: [{ amount: 800, winnerIds: ['p1', 'p2'], handLabel: 'Straight, ten high' }],
          shown: {}, returned: {}, wentToShowdown: true,
        },
      },
    }));
    expect(screen.getByText('You and Bob split 800')).toBeInTheDocument();
  });
});

describe('your seat', () => {
  it('shows a pending leave with a cancel that undoes it', async () => {
    const { socket } = setup(running({ you: { pending: 'leave' }, players: { p1: { pending: 'leave' } } }));
    const note = screen.getByText('Leaving after this hand').closest('[role="status"]') as HTMLElement;
    await userEvent.click(within(note).getByRole('button', { name: /^Cancel/ }));
    expect(socket.events('cancel_pending')).toHaveLength(1);
  });

  it('shows a queued top-up', () => {
    setup(running({ you: { pendingTopUp: 1500 } }));
    expect(screen.getByText('+1,500 top-up queued')).toBeInTheDocument();
  });

  it('shows a leave and a top-up as one note with one cancel that says it cancels both', async () => {
    const { socket } = setup(running({ you: { pending: 'leave', pendingTopUp: 1000 } }));
    const note = screen.getByText('Leaving after this hand · +1,000 top-up queued').closest('[role="status"]') as HTMLElement;
    const cancel = within(note).getByRole('button', { name: /Cancel all queued changes/ });
    expect(cancel).toHaveTextContent('Cancel all');
    await userEvent.click(cancel);
    expect(socket.events('cancel_pending')).toHaveLength(1);
    // The table menu shows the same single note.
    await userEvent.click(screen.getByRole('button', { name: /Table menu/ }));
    const menu = screen.getByRole('dialog', { name: 'Table menu' });
    expect(within(menu).getAllByRole('button', { name: /^Cancel/ })).toHaveLength(1);
  });

  it('lets a sat-out player come back', async () => {
    const view = running({ you: { sittingOut: true }, players: { p1: { sittingOut: true, state: 'sitting-out', inHand: false, holeCards: null } } });
    view.hand = null;
    const { socket } = setup(view);
    await userEvent.click(screen.getByRole('button', { name: "I'm back" }));
    expect(socket.events('sit_out').map((e) => e.args[0])).toEqual([{ sittingOut: false }]);
  });

  it('toasts a refused action', async () => {
    const { socket, store } = setup(running({ you: { legal: LEGAL } }));
    socket.respond = (event) => (event === 'act' ? { ok: false, error: "It isn't your turn." } : { ok: true });
    await userEvent.click(screen.getByRole('button', { name: /Fold/ }));
    expect(store.getState().notices.map((n) => n.title)).toContain("It isn't your turn.");
  });
});

describe('clicks and confirms', () => {
  it('lets clicks through the full-stage seat list to the felt', () => {
    const { container } = setup(running());
    const list = screen.getByRole('list', { name: 'Seats' });
    expect(list).toHaveClass('pointer-events-none');
    for (const li of container.querySelectorAll('ol[aria-label="Seats"] > li')) expect(li).toHaveClass('pointer-events-auto');
    // No other full-size layer over the felt takes clicks.
    const stage = screen.getByTestId('table-stage');
    for (const el of stage.querySelectorAll<HTMLElement>('.inset-0, .inset-x-0')) {
      expect(el.closest('.pointer-events-none')).not.toBeNull();
    }
  });

  it('keeps the idle "Start the game" button clickable above the seat list', () => {
    const v = running();
    setup({ ...v, status: 'open', hand: null, hostId: 'p1' });
    const start = screen.getByRole('button', { name: 'Start the game' });
    // Its own layer takes clicks even though the layers around it don't.
    expect(start.closest('.pointer-events-auto')).not.toBeNull();
    expect(screen.getByRole('list', { name: 'Seats' })).toHaveClass('pointer-events-none');
  });

  it('asks before folding when you could check, and folds on the second press', async () => {
    const { socket } = setup(running({ hand: { street: 'flop', currentBet: 0 }, you: { legal: { ...LEGAL, canCheck: true, callAmount: 0 } } }));
    await userEvent.click(screen.getByRole('button', { name: /^Fold/ }));
    expect(acts(socket)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: /Fold anyway/ }));
    await act(async () => {});
    expect(acts(socket)).toEqual([{ type: 'fold' }]);
  });

  it('does not fold on F when checking is free until F is pressed again', async () => {
    const { socket } = setup(running({ hand: { street: 'flop', currentBet: 0 }, you: { legal: { ...LEGAL, canCheck: true, callAmount: 0 } } }));
    fireEvent.keyDown(window, { key: 'f' });
    await act(async () => {});
    expect(acts(socket)).toEqual([]);
    expect(screen.getByRole('button', { name: /Fold anyway/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'f' });
    await act(async () => {});
    expect(acts(socket)).toEqual([{ type: 'fold' }]);
  });

  it('folds straight away when facing a bet', async () => {
    const { socket } = setup(running({ you: { legal: LEGAL } }));
    await userEvent.click(screen.getByRole('button', { name: /^Fold/ }));
    await act(async () => {});
    expect(acts(socket)).toEqual([{ type: 'fold' }]);
  });

  it('confirms before the top-bar leave button cashes a seated player out', async () => {
    const { socket } = setup(running());
    await userEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    expect(socket.events('leave_table')).toHaveLength(0);
    const ask = screen.getByRole('dialog', { name: 'Leave the table?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Stay' }));
    expect(socket.events('leave_table')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Leave the table?' })).getByRole('button', { name: /Leave after this hand/ }));
    expect(socket.events('leave_table')).toHaveLength(1);
  });

  it('lets a watcher leave without a confirm', async () => {
    const { socket } = setup(running({ you: { role: 'spectator', seat: null } }));
    await userEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    expect(socket.events('leave_table')).toHaveLength(1);
  });

  it('keeps your clock on top of the table menu on your turn, with a way back', async () => {
    setup(running({ hand: { actionEndsAt: Date.now() + 12_000 }, you: { legal: LEGAL } }));
    await userEvent.click(screen.getByRole('button', { name: /Table menu/ }));
    expect(screen.getByRole('dialog', { name: 'Table menu' })).toBeInTheDocument();
    const clock = screen.getAllByRole('timer').find((t) => /Your turn/.test(t.textContent ?? ''));
    expect(clock).toHaveTextContent(/Your turn · 1[12]s/);
    await userEvent.click(screen.getByRole('button', { name: /Back to the table/ }));
    expect(screen.queryByRole('dialog', { name: 'Table menu' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Your action' })).toBeInTheDocument();
  });

  it('toggles the seat menu shut when the same seat is clicked again', async () => {
    setup(running());
    const bob = screen.getByRole('button', { name: /Seat 3, Bob/ });
    await userEvent.click(bob);
    expect(screen.getByRole('menu', { name: 'Bob' })).toBeInTheDocument();
    await userEvent.click(bob);
    expect(screen.queryByRole('menu', { name: 'Bob' })).toBeNull();
  });

  it('moves through the seat menu with the arrow keys', async () => {
    setup(running());
    await userEvent.click(screen.getByRole('button', { name: /Seat 3, Bob/ }));
    const menu = screen.getByRole('menu', { name: 'Bob' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[1] ?? items[0]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(items[items.length - 1]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /Seat 3, Bob/ })).toHaveFocus();
  });

  it('badges the table menu with unread messages and challenges', async () => {
    const r = renderWithClient(<TableScreen />, { me: makeMe({ unreadMessages: 1, unclaimedChallenges: 2 }) });
    act(() => r.socket.serverEmit('table_state', running()));
    const menuButton = screen.getByRole('button', { name: /Table menu/ }).parentElement!;
    expect(menuButton).toHaveTextContent('1 unread message, 2 challenges to claim');
    await userEvent.click(screen.getByRole('button', { name: /Table menu/ }));
    const menu = screen.getByRole('dialog', { name: 'Table menu' });
    expect(within(menu).getByRole('button', { name: /Messages/ })).toHaveTextContent('1 unread message');
    expect(within(menu).getByRole('button', { name: /Challenges/ })).toHaveTextContent('2 challenges to claim');
  });
});

describe('host controls', () => {
  function openTable(hostId: string): TableView {
    const v = running({ hand: {} });
    return { ...v, status: 'open', hand: null, hostId, seats: v.seats.map((s) => (s.player ? { ...s, player: { ...s.player, inHand: false, holeCards: null, hasHiddenCards: false, committed: 0 } } : s)) };
  }

  it('lets the host start once two players are seated', async () => {
    const { socket } = setup(openTable('p1'));
    await userEvent.click(screen.getByRole('button', { name: 'Start the game' }));
    expect(socket.events('start_table')).toHaveLength(1);
  });

  it('tells everyone else to wait for the host', () => {
    setup(openTable('p2'));
    expect(screen.getByText('Waiting for the host to start')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start the game' })).toBeNull();
  });

  it('shows host tools in the table menu only for the host', async () => {
    setup(openTable('p1'));
    await userEvent.click(screen.getByRole('button', { name: 'Table menu' }));
    const menu = screen.getByRole('dialog', { name: 'Table menu' });
    expect(within(menu).getByRole('button', { name: 'Edit rules' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Close the table' })).toBeInTheDocument();
  });

  it('hides host tools from other players', async () => {
    setup(openTable('p2'));
    await userEvent.click(screen.getByRole('button', { name: 'Table menu' }));
    const menu = screen.getByRole('dialog', { name: 'Table menu' });
    expect(within(menu).queryByRole('button', { name: 'Edit rules' })).toBeNull();
    expect(within(menu).queryByRole('button', { name: 'Close the table' })).toBeNull();
  });

  it('shows the closing banner', () => {
    setup({ ...running(), closing: true });
    expect(screen.getByText('The host is closing the table after this hand.')).toBeInTheDocument();
  });
});
