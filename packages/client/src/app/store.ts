import {
  roomChannel,
  type Ack,
  type ActivityEvent,
  type ChannelId,
  type ChatMessage,
  type ChatTarget,
  type LobbyState,
  type Notice,
  type PlayerAction,
  type PlayerSelf,
  type TableFx,
  type TableLeft,
  type TableRules,
  type TableView,
} from '@poker/shared';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Socket status. `unauthorized` means the session expired: reload to sign in again. */
export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'unauthorized';

export interface AppState {
  instanceId: string;
  connection: ConnectionStatus;
  /** Set when `join_room` is refused (e.g. not in this activity). */
  roomError: string | null;
  /** You. Seeded from the sign-in response, then replaced on every `me` event. */
  me: PlayerSelf;
  /** Who's in the room and the table summary; null until the first `lobby_state`. */
  lobby: LobbyState | null;
  /** The table as you see it while you're a member (seated or watching); null otherwise. */
  table: TableView | null;
  /** Why you last left the table (`code` for logic, `reason` for people); cleared when you rejoin one. */
  tableLeft: TableLeft | null;
  /**
   * Tables the lobby has shown to be gone. A late `table_state` for one of
   * them is stale and ignored.
   */
  closedTables: string[];
  /** Messages per channel, oldest first (room: `room:<instanceId>`, DMs: `dm:<a>:<b>`). */
  chat: Record<ChannelId, ChatMessage[]>;
  /** Channels whose history has arrived at least once (so later messages are new). */
  chatLoaded: Record<ChannelId, true>;
  /** Room activity feed, newest first. */
  activity: ActivityEvent[];
  /** Pending toasts (server `notice` events and local `notify()` calls), oldest first. */
  notices: Notice[];
  /** `serverNow - Date.now()` at the last table_state, for correcting countdowns. */
  clockOffset: number;
}

export const CHAT_KEEP = 200;
export const ACTIVITY_KEEP = 50;
export const NOTICES_KEEP = 4;
const CLOSED_KEEP = 10;

/** What the host who closed the table is told, instead of "the host closed it". */
export const YOU_CLOSED = 'You closed the table.';

export function initialState(me: PlayerSelf, instanceId: string): AppState {
  return {
    instanceId,
    connection: 'connecting',
    roomError: null,
    me,
    lobby: null,
    table: null,
    tableLeft: null,
    closedTables: [],
    chat: {},
    chatLoaded: {},
    activity: [],
    notices: [],
    clockOffset: 0,
  };
}

/** Everything that can change the store. Server events mirror `ServerToClientEvents`. */
export type StoreEvent =
  | { type: 'me'; me: PlayerSelf }
  | { type: 'lobby_state'; lobby: LobbyState }
  | { type: 'table_state'; view: TableView; receivedAt: number }
  | { type: 'table_left'; left: TableLeft }
  | { type: 'chat_message'; message: ChatMessage }
  | { type: 'chat_history'; channel: ChannelId; messages: ChatMessage[] }
  | { type: 'activity'; event: ActivityEvent }
  | { type: 'activity_history'; events: ActivityEvent[] }
  | { type: 'notice'; notice: Notice }
  | { type: 'dismiss_notice'; id: string }
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'room_error'; error: string | null };

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(existing.map((m) => m.id));
  const out = existing.concat(incoming.filter((m) => !seen.has(m.id)));
  return out.length > CHAT_KEEP ? out.slice(out.length - CHAT_KEEP) : out;
}

/** Pure reducer: the whole store is `reduce`d from events, which keeps it testable. */
export function reduce(state: AppState, e: StoreEvent): AppState {
  switch (e.type) {
    case 'me':
      return { ...state, me: e.me };
    case 'lobby_state': {
      // The lobby is the source of truth for which table exists. If ours is
      // gone (it closed while we were away, e.g. across a reconnect, and the
      // server had no `table_left` to send), drop the dead view.
      const ours = state.table;
      if (ours && e.lobby.table?.tableId !== ours.tableId) {
        return {
          ...state,
          lobby: e.lobby,
          table: null,
          tableLeft: {
            code: 'not-member',
            reason: e.lobby.table ? 'The table you were at has closed.' : 'The table has closed.',
          },
          closedTables: [...state.closedTables, ours.tableId].slice(-CLOSED_KEEP),
        };
      }
      return { ...state, lobby: e.lobby };
    }
    case 'table_state':
      if (state.closedTables.includes(e.view.tableId)) return state;
      return {
        ...state,
        table: e.view,
        tableLeft: null,
        clockOffset: e.view.serverNow - e.receivedAt,
      };
    case 'table_left': {
      // "Not a member" answers a state request; with no table showing there's nothing to undo.
      if (e.left.code === 'not-member' && !state.table) return state;
      // The host who closed the table doesn't need telling who closed it.
      const closedByYou = e.left.code === 'host-closed' && state.table?.hostId === state.me.id;
      return { ...state, table: null, tableLeft: closedByYou ? { ...e.left, reason: YOU_CLOSED } : e.left };
    }
    case 'chat_message': {
      const list = state.chat[e.message.channel] ?? [];
      return { ...state, chat: { ...state.chat, [e.message.channel]: mergeMessages(list, [e.message]) } };
    }
    case 'chat_history': {
      // History replaces the channel, but keeps live messages that arrived after it.
      const last = e.messages[e.messages.length - 1];
      const newer = (state.chat[e.channel] ?? []).filter((m) => !last || m.createdAt > last.createdAt);
      return {
        ...state,
        chat: { ...state.chat, [e.channel]: mergeMessages(e.messages.slice(-CHAT_KEEP), newer) },
        chatLoaded: state.chatLoaded[e.channel] ? state.chatLoaded : { ...state.chatLoaded, [e.channel]: true },
      };
    }
    case 'activity':
      if (state.activity.some((a) => a.id === e.event.id)) return state;
      return { ...state, activity: [e.event, ...state.activity].slice(0, ACTIVITY_KEEP) };
    case 'activity_history':
      return { ...state, activity: e.events.slice().sort((a, b) => b.at - a.at).slice(0, ACTIVITY_KEEP) };
    case 'notice':
      if (state.notices.some((n) => n.id === e.notice.id)) return state;
      return { ...state, notices: [...state.notices, e.notice].slice(-NOTICES_KEEP) };
    case 'dismiss_notice':
      return { ...state, notices: state.notices.filter((n) => n.id !== e.id) };
    case 'connection':
      // An expired session stays expired until the page reloads, whatever the socket does next.
      if (state.connection === 'unauthorized' || state.connection === e.status) return state;
      return { ...state, connection: e.status };
    case 'room_error':
      return { ...state, roomError: e.error };
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let localId = 0;

/** A tiny external store for `useSyncExternalStore`. */
export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<() => void>();
  private readonly fxListeners = new Set<(fx: TableFx) => void>();

  constructor(me: PlayerSelf, instanceId: string) {
    this.state = initialState(me, instanceId);
  }

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch = (e: StoreEvent): void => {
    const next = reduce(this.state, e);
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  };

  /** Show a toast from the client (e.g. after a REST call). Returns its id. */
  notify = (notice: Omit<Notice, 'id'>): string => {
    const id = `local-${++localId}`;
    this.dispatch({ type: 'notice', notice: { id, ...notice } });
    return id;
  };

  dismissNotice = (id: string): void => this.dispatch({ type: 'dismiss_notice', id });

  /** Replace a channel's messages, e.g. DM history loaded over REST. */
  setChannelMessages = (channel: ChannelId, messages: ChatMessage[]): void =>
    this.dispatch({ type: 'chat_history', channel, messages });

  /** The room chat channel id for this instance. */
  get roomChannel(): ChannelId {
    return roomChannel(this.state.instanceId);
  }

  /** Current server time (epoch ms), corrected by the last table_state's clock. */
  serverNow = (): number => Date.now() + this.state.clockOffset;

  /** Subscribe to table effects (emotes, throwables). Returns an unsubscribe. */
  onTableFx = (listener: (fx: TableFx) => void): (() => void) => {
    this.fxListeners.add(listener);
    return () => this.fxListeners.delete(listener);
  };

  /** Deliver a table effect to subscribers (called by the socket binding). */
  emitTableFx = (fx: TableFx): void => {
    for (const l of this.fxListeners) l(fx);
  };
}

// ---------------------------------------------------------------------------
// Socket binding + commands
// ---------------------------------------------------------------------------

/** The subset of a socket.io client socket the store needs (fakeable in tests). */
export interface SocketLike {
  connected: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener?: (...args: any[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  timeout(ms: number): { emit(event: string, ...args: unknown[]): unknown };
  connect(): unknown;
}

export const ACK_TIMEOUT_MS = 10_000;

/** Every table/room command. Each resolves with the server's ack (never rejects). */
export interface Commands {
  joinRoom(): Promise<Ack>;
  openTable(rules: Partial<TableRules>): Promise<Ack>;
  /** Host only, while the table is open (not yet running). */
  updateRules(rules: Partial<TableRules>): Promise<Ack>;
  startTable(): Promise<Ack>;
  closeTable(): Promise<Ack>;
  watchTable(): Promise<Ack>;
  takeSeat(seat: number, buyIn: number): Promise<Ack>;
  topUp(amount: number): Promise<Ack>;
  standUp(): Promise<Ack>;
  leaveTable(): Promise<Ack>;
  sitOut(sittingOut: boolean): Promise<Ack>;
  cancelPending(): Promise<Ack>;
  act(action: PlayerAction): Promise<Ack>;
  emote(emote: string): Promise<Ack>;
  throwItem(itemId: string, targetId: string): Promise<Ack>;
  sendChat(to: ChatTarget, body: string): Promise<Ack>;
  /** Fire-and-forget: clears unread counts for a channel. */
  markRead(channel: ChannelId): void;
  /** Fire-and-forget: ask for a fresh table_state if you're a table member. */
  requestState(): void;
}

export function createCommands(socket: SocketLike, store: AppStore): Commands {
  const call = (event: string, ...args: unknown[]): Promise<Ack> => {
    if (!socket.connected) {
      return Promise.resolve({ ok: false, error: "You're offline. Reconnecting to the server." });
    }
    return new Promise<Ack>((resolve) => {
      socket.timeout(ACK_TIMEOUT_MS).emit(event, ...args, (err: unknown, ack: Ack | undefined) => {
        if (err || !ack) resolve({ ok: false, error: "The server didn't answer. Try again." });
        else resolve(ack);
      });
    });
  };
  return {
    joinRoom: () => call('join_room', { instanceId: store.getState().instanceId }),
    openTable: (rules) => call('open_table', { rules }),
    updateRules: (rules) => call('update_rules', { rules }),
    startTable: () => call('start_table'),
    closeTable: () => call('close_table'),
    watchTable: () => call('watch_table'),
    takeSeat: (seat, buyIn) => call('take_seat', { seat, buyIn }),
    topUp: (amount) => call('top_up', { amount }),
    standUp: () => call('stand_up'),
    leaveTable: () => call('leave_table'),
    sitOut: (sittingOut) => call('sit_out', { sittingOut }),
    cancelPending: () => call('cancel_pending'),
    act: (action) => call('act', action),
    emote: (emote) => call('emote', { emote }),
    throwItem: (itemId, targetId) => call('throw_item', { itemId, targetId }),
    sendChat: (to, body) => call('chat_send', { to, body }),
    markRead: (channel) => {
      if (socket.connected) socket.emit('chat_read', { channel });
    },
    requestState: () => {
      if (socket.connected) socket.emit('request_state');
    },
  };
}

/**
 * Route socket events into the store. On every (re)connect the client rejoins
 * its room and asks for the table state. Returns an unbind function.
 */
export function bindSocket(socket: SocketLike, store: AppStore, commands: Commands, clock: () => number = Date.now): () => void {
  const d = store.dispatch;
  const handlers: Record<string, (...args: any[]) => void> = {
    connect: () => {
      d({ type: 'connection', status: 'online' });
      void commands.joinRoom().then((ack) => {
        d({ type: 'room_error', error: ack.ok ? null : ack.error });
        if (ack.ok) commands.requestState();
      });
    },
    disconnect: (reason: string) => {
      d({ type: 'connection', status: 'offline' });
      // A server-side disconnect is not retried automatically.
      if (reason === 'io server disconnect') socket.connect();
    },
    connect_error: (err: Error) => {
      d({ type: 'connection', status: err?.message === 'unauthorized' ? 'unauthorized' : 'offline' });
    },
    me: (me: PlayerSelf) => d({ type: 'me', me }),
    lobby_state: (lobby: LobbyState) => d({ type: 'lobby_state', lobby }),
    table_state: (view: TableView) => d({ type: 'table_state', view, receivedAt: clock() }),
    table_left: (data: Partial<TableLeft> | undefined) =>
      d({ type: 'table_left', left: { code: data?.code ?? 'left', reason: data?.reason ?? '' } }),
    table_fx: (fx: TableFx) => store.emitTableFx(fx),
    chat_message: (message: ChatMessage) => d({ type: 'chat_message', message }),
    chat_history: (data: { channel: ChannelId; messages: ChatMessage[] }) =>
      d({ type: 'chat_history', channel: data.channel, messages: data.messages }),
    activity: (event: ActivityEvent) => d({ type: 'activity', event }),
    activity_history: (events: ActivityEvent[]) => d({ type: 'activity_history', events }),
    notice: (notice: Notice) => d({ type: 'notice', notice }),
  };
  for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn);
  if (socket.connected) handlers.connect();
  return () => {
    for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn);
  };
}
