import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@poker/shared';
import { ClientProvider } from '../app/client';
import { makeClient } from '../test/harness';
import { useUnseenRoomMessages } from './RoomPanel';

const CH = 'room:room-1';
const msg = (id: string, minute: number, senderId = 'p2'): ChatMessage => ({
  id, channel: CH, senderId, senderName: senderId === 'p1' ? 'Alice' : 'Bob', senderAvatar: '', body: id,
  createdAt: new Date(Date.UTC(2026, 8, 24, 9, minute)).toISOString(),
});

function setup(visible = false) {
  const { client } = makeClient();
  const wrapper = ({ children }: { children: ReactNode }) => <ClientProvider client={client}>{children}</ClientProvider>;
  const hook = renderHook(({ v }) => useUnseenRoomMessages(v), { wrapper, initialProps: { v: visible } });
  return { ...hook, store: client.store };
}

describe('useUnseenRoomMessages', () => {
  it('counts the first live message in a room with no history', () => {
    const { result, store } = setup();
    act(() => store.dispatch({ type: 'chat_history', channel: CH, messages: [] }));
    expect(result.current).toBe(0);
    act(() => store.dispatch({ type: 'chat_message', message: msg('a', 1) }));
    expect(result.current).toBe(1);
    act(() => store.dispatch({ type: 'chat_message', message: msg('b', 2) }));
    expect(result.current).toBe(2);
  });

  it('treats the history on join as seen and counts what follows', () => {
    const { result, store } = setup();
    act(() => store.dispatch({ type: 'chat_history', channel: CH, messages: [msg('h1', 1), msg('h2', 2)] }));
    expect(result.current).toBe(0);
    act(() => store.dispatch({ type: 'chat_message', message: msg('live', 3) }));
    expect(result.current).toBe(1);
  });

  it("ignores your own messages and resets when the chat is shown", () => {
    const { result, store, rerender } = setup();
    act(() => store.dispatch({ type: 'chat_history', channel: CH, messages: [] }));
    act(() => store.dispatch({ type: 'chat_message', message: msg('mine', 1, 'p1') }));
    expect(result.current).toBe(0);
    act(() => store.dispatch({ type: 'chat_message', message: msg('theirs', 2) }));
    expect(result.current).toBe(1);
    rerender({ v: true });
    expect(result.current).toBe(0);
    rerender({ v: false });
    expect(result.current).toBe(0);
    act(() => store.dispatch({ type: 'chat_message', message: msg('later', 3) }));
    expect(result.current).toBe(1);
  });
});
