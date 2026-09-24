import { describe, it, expect, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_COSMETICS, type ChatMessage } from '@poker/shared';
import { frameVisual } from '../../cosmetics';
import { makeLobby, makeMember, renderWithClient } from '../../test/harness';
import { makeConversation, makeMessage, makeProfile, makePublic } from '../fixtures';
import { MessagesScreen, PAGE_SIZE } from './MessagesScreen';

const CH = 'dm:p1:p2';
const page = (n: number, startMinute: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) =>
    makeMessage(CH, i % 2 ? 'p1' : 'p2', `msg ${startMinute + i}`, new Date(Date.UTC(2026, 8, 24, 9, startMinute + i)).toISOString()),
  );

describe('MessagesScreen', () => {
  it('lists conversations with preview and unread count, and opens one (history + markRead)', async () => {
    const history = vi.fn(async () => page(3, 0));
    const { socket, store } = renderWithClient(<MessagesScreen />, {
      api: { conversations: async () => [makeConversation()], history },
    });
    const list = await screen.findByRole('navigation', { name: 'Conversations' });
    const row = within(list).getByRole('button', { name: /Bob/ });
    expect(row).toHaveTextContent('nice hand');
    expect(row).toHaveTextContent('2 unread');

    await userEvent.click(row);
    expect(history).toHaveBeenCalledWith(CH);
    const thread = await screen.findByRole('list', { name: 'Messages with Bob' });
    expect(await within(thread).findByText('msg 2')).toBeInTheDocument();
    expect(store.getState().chat[CH]).toHaveLength(3);
    expect(socket.events('chat_read').map((e) => e.args[0])).toContainEqual({ channel: CH });
    // Narrow (single pane): back to the list, where the conversation now reads as read.
    await userEvent.click(screen.getByRole('button', { name: 'Back to conversations' }));
    const again = screen.getByRole('navigation', { name: 'Conversations' });
    expect(within(again).getByRole('button', { name: /Bob/ })).not.toHaveTextContent('unread');
  });

  it('opens straight into a DM from initialPartnerId, sends with a counter, and marks new messages read', async () => {
    const { socket, store } = renderWithClient(<MessagesScreen initialPartnerId="p2" />, {
      api: { conversations: async () => [], history: async () => [], profile: async () => makeProfile() },
    });
    const input = await screen.findByRole('textbox', { name: 'Message Bob' });
    expect(screen.getByText('Say hello to Bob')).toBeInTheDocument();
    expect(screen.getByText('280 characters left')).toBeInTheDocument();
    await userEvent.type(input, 'gg');
    expect(screen.getByText('278 characters left')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(socket.events('chat_send')[0].args[0]).toEqual({ to: { dm: 'p2' }, body: 'gg' });
    expect(input).toHaveValue('');

    const readsBefore = socket.events('chat_read').length;
    act(() => store.dispatch({ type: 'chat_message', message: makeMessage(CH, 'p2', 'wp', new Date().toISOString()) }));
    expect(screen.getByText('wp')).toBeInTheDocument();
    expect(socket.events('chat_read').length).toBeGreaterThan(readsBefore);
  });

  it('shows the server error when a send is refused', async () => {
    const { socket } = renderWithClient(<MessagesScreen initialPartnerId="p2" />, {
      api: { conversations: async () => [], history: async () => [], profile: async () => makeProfile() },
    });
    socket.respond = () => ({ ok: false, error: "You're sending messages too quickly." });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message Bob' }), 'spam{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent("You're sending messages too quickly.");
    expect(screen.getByRole('textbox', { name: 'Message Bob' })).toHaveValue('spam');
  });

  it('loads older messages with `before` = the oldest loaded message', async () => {
    const latest = page(PAGE_SIZE, 100);
    const older = page(4, 90);
    const history = vi.fn(async (_c: string, before?: string) => (before ? older : latest));
    renderWithClient(<MessagesScreen initialPartnerId="p2" />, {
      api: { conversations: async () => [makeConversation()], history },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Load older messages' }));
    expect(history).toHaveBeenLastCalledWith(CH, latest[0].createdAt);
    expect(await screen.findByText('msg 90')).toBeInTheDocument();
    expect(screen.getByText('msg 149')).toBeInTheDocument();
    // A short page means there is nothing older.
    expect(screen.queryByRole('button', { name: 'Load older messages' })).not.toBeInTheDocument();
  });

  it('starts a new conversation with someone in the room', async () => {
    const history = vi.fn(async () => []);
    const { store } = renderWithClient(<MessagesScreen />, { api: { conversations: async () => [], history } });
    act(() => store.dispatch({ type: 'lobby_state', lobby: makeLobby({ members: [makeMember('p1', 'Alice'), makeMember('p3', 'Carol')] }) }));
    expect(await screen.findByRole('heading', { name: 'No messages yet' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New message' }));
    const dialog = screen.getByRole('dialog', { name: 'New message' });
    expect(within(dialog).queryByText('Alice')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Carol/ }));
    expect(await screen.findByRole('textbox', { name: 'Message Carol' })).toBeInTheDocument();
    expect(history).toHaveBeenCalledWith('dm:p1:p3');
  });

  it('names a new conversation after its partner before they reply', async () => {
    const { store } = renderWithClient(<MessagesScreen initialPartnerId="p2" />, {
      api: { conversations: async () => [], history: async () => [], profile: async () => makeProfile() },
    });
    await screen.findByRole('textbox', { name: 'Message Bob' });
    // Our own message comes back from the server; Bob hasn't said anything yet.
    act(() => store.dispatch({ type: 'chat_message', message: makeMessage(CH, 'p1', 'hi Bob', new Date().toISOString()) }));
    await userEvent.click(screen.getByRole('button', { name: 'Back to conversations' }));
    const list = screen.getByRole('navigation', { name: 'Conversations' });
    const row = within(list).getByRole('button', { name: /hi Bob/ });
    expect(row).toHaveTextContent('Bob');
    expect(row).not.toHaveTextContent('Player');
  });

  it("draws a partner's frame from the conversation list when they aren't in the room", async () => {
    const partner = makePublic('p2', 'Bob', { level: 9, cosmetics: { ...DEFAULT_COSMETICS, frame: 'frame-brass' } });
    renderWithClient(<MessagesScreen />, { api: { conversations: async () => [makeConversation({ partner })] } });
    const list = await screen.findByRole('navigation', { name: 'Conversations' });
    const row = within(list).getByRole('button', { name: /Bob/ });
    expect(row.querySelector('[data-frame]')).toHaveAttribute('data-frame', frameVisual('frame-brass').style);
    expect(frameVisual('frame-brass').style).not.toBe(frameVisual(DEFAULT_COSMETICS.frame).style);
  });

  it('prefers the live room frame for partners who are here', async () => {
    const partner = makePublic('p2', 'Bob', { cosmetics: { ...DEFAULT_COSMETICS, frame: 'frame-brass' } });
    const { store } = renderWithClient(<MessagesScreen />, { api: { conversations: async () => [makeConversation({ partner })] } });
    act(() => store.dispatch({ type: 'lobby_state', lobby: makeLobby({ members: [makeMember('p1', 'Alice'), makeMember('p2', 'Bob')] }) }));
    const list = await screen.findByRole('navigation', { name: 'Conversations' });
    const row = within(list).getByRole('button', { name: /Bob/ });
    expect(row.querySelector('[data-frame]')).toHaveAttribute('data-frame', frameVisual(DEFAULT_COSMETICS.frame).style);
  });

  it('names a live conversation with a room member from the room', async () => {
    const { store } = renderWithClient(<MessagesScreen />, { api: { conversations: async () => [] } });
    act(() => store.dispatch({ type: 'lobby_state', lobby: makeLobby({ members: [makeMember('p1', 'Alice'), makeMember('p3', 'Carol')] }) }));
    await screen.findByRole('heading', { name: 'No messages yet' });
    act(() => store.dispatch({ type: 'chat_message', message: makeMessage('dm:p1:p3', 'p1', 'you there?', new Date().toISOString()) }));
    const list = screen.getByRole('navigation', { name: 'Conversations' });
    expect(within(list).getByRole('button', { name: /you there/ })).toHaveTextContent('Carol');
  });

  it('adds a conversation when a DM arrives live', async () => {
    const { store } = renderWithClient(<MessagesScreen />, { api: { conversations: async () => [] } });
    await screen.findByRole('heading', { name: 'No messages yet' });
    act(() => store.dispatch({ type: 'chat_message', message: makeMessage('dm:p1:p9', 'p9', 'psst', new Date().toISOString()) }));
    const list = screen.getByRole('navigation', { name: 'Conversations' });
    expect(within(list).getByRole('button', { name: /psst/ })).toBeInTheDocument();
  });
});
