import type { PlayerAction, TableFx, TableLeft, TableRules, TableView } from './table.js';
import type {
  ActivityEvent,
  ChannelId,
  ChatMessage,
  LobbyState,
  Notice,
  PlayerSelf,
} from './social.js';

/** Every client command is acknowledged with this. */
export type Ack = { ok: true } | { ok: false; error: string };
export type AckFn = (result: Ack) => void;

export interface ServerToClientEvents {
  /** Your own profile/balance changed. */
  me: (me: PlayerSelf) => void;
  lobby_state: (state: LobbyState) => void;
  /** The table as you may see it; sent while you are a table member. */
  table_state: (view: TableView) => void;
  /** You are no longer at the table (left, closed, removed), or never were (`not-member`). */
  table_left: (data: TableLeft) => void;
  table_fx: (fx: TableFx) => void;
  chat_message: (msg: ChatMessage) => void;
  chat_history: (data: { channel: ChannelId; messages: ChatMessage[] }) => void;
  activity: (event: ActivityEvent) => void;
  activity_history: (events: ActivityEvent[]) => void;
  notice: (notice: Notice) => void;
}

export type ChatTarget = { room: true } | { dm: string };

export interface ClientToServerEvents {
  join_room: (data: { instanceId: string }, ack: AckFn) => void;
  open_table: (data: { rules: Partial<TableRules> }, ack: AckFn) => void;
  update_rules: (data: { rules: Partial<TableRules> }, ack: AckFn) => void;
  start_table: (ack: AckFn) => void;
  close_table: (ack: AckFn) => void;
  watch_table: (ack: AckFn) => void;
  take_seat: (data: { seat: number; buyIn: number }, ack: AckFn) => void;
  top_up: (data: { amount: number }, ack: AckFn) => void;
  stand_up: (ack: AckFn) => void;
  leave_table: (ack: AckFn) => void;
  sit_out: (data: { sittingOut: boolean }, ack: AckFn) => void;
  cancel_pending: (ack: AckFn) => void;
  act: (action: PlayerAction, ack: AckFn) => void;
  /**
   * Show (or hide again) your hole cards to the whole table once the hand is
   * complete. Any player dealt into the hand may ask, folded or not, from the
   * deal until the result clears; mid-hand it is a pre-selection that reveals
   * nothing until the end. Cards tabled at showdown can't be hidden. Pass
   * `handNumber` so a late request can't apply to the next hand.
   */
  show_cards: (data: { show: boolean; handNumber?: number }, ack: AckFn) => void;
  emote: (data: { emote: string }, ack: AckFn) => void;
  throw_item: (data: { itemId: string; targetId: string }, ack: AckFn) => void;
  chat_send: (data: { to: ChatTarget; body: string }, ack: AckFn) => void;
  chat_read: (data: { channel: ChannelId }) => void;
  request_state: () => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  playerId: string;
  name: string;
  avatarUrl: string;
  instanceId?: string;
}
