import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { ActivityEvent, ChannelId, ChatMessage, LobbyState, Notice, PlayerSelf, TableFx, TableView } from '@poker/shared';
import { createApi, type Api } from './api';
import type { Session } from './session';
import { connectSocket } from './socket';
import { AppStore, bindSocket, createCommands, type AppState, type Commands, type SocketLike } from './store';

/** Everything a signed-in screen needs: identity, REST, realtime commands and state. */
export interface Client {
  session: Session;
  store: AppStore;
  api: Api;
  commands: Commands;
  /** Disconnect and unbind (on unmount / sign-out). */
  dispose(): void;
}

/** Wire a session to a socket, the REST client and a fresh store. */
export function createClient(session: Session, socket: SocketLike = connectSocket(session.token) as unknown as SocketLike): Client {
  const store = new AppStore(session.me, session.instanceId);
  const commands = createCommands(socket, store);
  const unbind = bindSocket(socket, store, commands);
  return {
    session,
    store,
    // A 401 from REST means the session expired: show the same "reload" screen the socket does.
    api: createApi(session.token, { onUnauthorized: () => store.dispatch({ type: 'connection', status: 'unauthorized' }) }),
    commands,
    dispose() {
      unbind();
      (socket as unknown as { disconnect?: () => void }).disconnect?.();
    },
  };
}

const ClientContext = createContext<Client | null>(null);

export function ClientProvider({ client, children }: { client: Client; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): Client {
  const c = useContext(ClientContext);
  if (!c) throw new Error('useClient must be used inside <ClientProvider>');
  return c;
}

export const useStore = (): AppStore => useClient().store;
export const useApi = (): Api => useClient().api;
export const useCommands = (): Commands => useClient().commands;

/**
 * Subscribe to a slice of app state. The selector must return a value that is
 * stable while the state is unchanged (a field of state, not a new object).
 */
export function useAppState<T>(selector: (s: AppState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export const useMe = (): PlayerSelf => useAppState((s) => s.me);
export const useLobby = (): LobbyState | null => useAppState((s) => s.lobby);
export const useTable = (): TableView | null => useAppState((s) => s.table);
export const useActivity = (): ActivityEvent[] => useAppState((s) => s.activity);
export const useNotices = (): Notice[] => useAppState((s) => s.notices);

const EMPTY: ChatMessage[] = [];
/** Messages for one channel, oldest first. */
export const useChannel = (channel: ChannelId): ChatMessage[] => useAppState((s) => s.chat[channel] ?? EMPTY);
/** This room's chat, oldest first. */
export function useRoomChat(): ChatMessage[] {
  const store = useStore();
  return useChannel(store.roomChannel);
}

/** Call `listener` for every table effect (emote/throwable) while mounted. */
export function useTableFx(listener: (fx: TableFx) => void): void {
  const store = useStore();
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => store.onTableFx((fx) => ref.current(fx)), [store]);
}
