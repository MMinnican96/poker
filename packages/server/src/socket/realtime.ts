import type { Server, Socket } from 'socket.io';
import {
  DEFAULT_RULES,
  dmChannel,
  dmPartner,
  roomChannel,
  type Ack,
  type AckFn,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
  type TableLeft,
  type TableRules,
} from '@poker/shared';
import type { Auth } from '../auth.js';
import type { Services } from '../services/index.js';
import { getPlayerRow, toPublic } from '../services/players.js';
import { RoomManager, type Outbox, type RoomDeps } from '../rooms/instance-room.js';
import { RateLimiter } from '../rooms/serial.js';
import type { Result } from '../rooms/table-room.js';

export type Io = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const instRoom = (instanceId: string) => `inst:${instanceId}`;
const memberRoom = (instanceId: string, playerId: string) => `inst:${instanceId}:user:${playerId}`;
const userRoom = (playerId: string) => `user:${playerId}`;

const NOT_MEMBER: TableLeft = { code: 'not-member', reason: "You're no longer at the table." };

/** A number from the wire, or NaN for anything else (so `null`, `''` or `true` never become 0 or 1). */
const num = (v: unknown): number => (typeof v === 'number' ? v : NaN);

/** Only the known rule fields: unknown keys would otherwise ride along in every viewer's table state. */
function pickRules(raw: unknown): Partial<TableRules> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_RULES)) {
    if (Object.hasOwn(raw, key)) out[key] = (raw as Record<string, unknown>)[key];
  }
  return out as Partial<TableRules>;
}

/** True when `channel` is exactly the (canonical) DM channel between `playerId` and someone else. */
export function isOwnDm(playerId: string, channel: string): boolean {
  const partner = dmPartner(channel, playerId);
  return !!partner && partner !== playerId && channel === dmChannel(playerId, partner);
}

export interface Realtime {
  rooms: RoomManager;
  /** Push a player's fresh profile/balance to their sockets and rooms. */
  refreshMe(playerId: string): void;
  dispose(): void;
}

export interface RealtimeOptions {
  services: Services;
  auth: Auth;
  timing?: RoomDeps['timing'];
  random?: RoomDeps['random'];
  clock?: RoomDeps['clock'];
  /** Optional check that a player really is in a Discord Activity instance. */
  verifyInstance?: (playerId: string, instanceId: string) => Promise<boolean>;
}

/** Wires authentication, rooms, tables and chat onto a Socket.io server. */
export function attachRealtime(io: Io, opts: RealtimeOptions): Realtime {
  const { services, auth } = opts;
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const chatLimit = new RateLimiter(5, 5000);
  const queues = new Map<string, Promise<unknown>>();

  /** Run a player's membership commands one at a time, across all their sockets. */
  function exclusively<T>(playerId: string, task: () => Promise<T>): Promise<T> {
    const next = (queues.get(playerId) ?? Promise.resolve()).then(task, task);
    const tail = next.catch(() => undefined);
    queues.set(playerId, tail);
    void tail.then(() => {
      if (queues.get(playerId) === tail) queues.delete(playerId);
    });
    return next;
  }

  const outbox: Outbox = {
    lobby: (instanceId, state) => io.to(instRoom(instanceId)).emit('lobby_state', state),
    tableView: (instanceId, playerId, view) => io.to(memberRoom(instanceId, playerId)).emit('table_state', view),
    tableLeft: (instanceId, playerId, left) => io.to(memberRoom(instanceId, playerId)).emit('table_left', left),
    fx: (instanceId, fx) => io.to(instRoom(instanceId)).emit('table_fx', fx),
    activity: (instanceId, event) => io.to(instRoom(instanceId)).emit('activity', event),
    notice: (playerId, notice) => io.to(userRoom(playerId)).emit('notice', notice),
    refreshMe: (playerId) => refreshMe(playerId),
  };

  const rooms = new RoomManager({ services, outbox, timing: opts.timing, random: opts.random, clock: opts.clock });

  function refreshMe(playerId: string): void {
    // Coalesce bursts (a hand end touches every player several times).
    if (refreshTimers.has(playerId)) return;
    refreshTimers.set(playerId, setTimeout(async () => {
      refreshTimers.delete(playerId);
      try {
        const [me, row] = await Promise.all([services.profiles.self(playerId), getPlayerRow(services.db, playerId)]);
        if (!me || !row) return;
        io.to(userRoom(playerId)).emit('me', me);
        for (const room of rooms.roomsWith(playerId)) room.updatePlayer(toPublic(row), me.balance);
      } catch (err) {
        console.error('[realtime] refreshMe failed', err);
      }
    }, 40));
  }

  io.use(async (socket, next) => {
    const claims = auth.verify(socket.handshake.auth?.token);
    if (!claims) return next(new Error('unauthorized'));
    const row = await getPlayerRow(services.db, claims.sub).catch(() => null);
    if (!row) return next(new Error('unauthorized'));
    socket.data.playerId = row.discordUserId;
    socket.data.name = row.displayName;
    socket.data.avatarUrl = row.avatarUrl ?? '';
    next();
  });

  io.on('connection', (socket: ClientSocket) => {
    const playerId = socket.data.playerId;
    void socket.join(userRoom(playerId));
    services.profiles.self(playerId)
      .then((me) => me && socket.emit('me', me))
      .catch((err) => console.error('[realtime] initial profile failed', err));

    const respond = (ack: unknown, result: Result | Ack) => {
      if (typeof ack === 'function') (ack as AckFn)(result);
    };
    /** Run a handler with an ack, converting thrown errors into a failed ack. */
    const handle = <A extends unknown[]>(fn: (...args: A) => Promise<Result> | Result) =>
      async (...args: [...A, AckFn]) => {
        const ack = args[args.length - 1];
        try {
          respond(ack, await fn(...(args.slice(0, -1) as A)));
        } catch (err) {
          console.error('[realtime] handler failed', err);
          respond(ack, { ok: false, error: 'Something went wrong. Try again.' });
        }
      };

    const room = () => (socket.data.instanceId ? rooms.get(socket.data.instanceId) : undefined);
    const table = () => room()?.currentTable ?? null;
    const needTable = <T>(fn: (t: NonNullable<ReturnType<typeof table>>) => T): T | Result => {
      const t = table();
      return t ? fn(t) : { ok: false, error: 'There is no table open.' };
    };

    socket.on('join_room', handle(async (data: { instanceId: string }) => {
      const instanceId = typeof data?.instanceId === 'string' ? data.instanceId.trim() : '';
      if (!/^[\w:.-]{1,128}$/.test(instanceId)) return { ok: false, error: 'Invalid room.' };
      if (opts.verifyInstance && !(await opts.verifyInstance(playerId, instanceId))) {
        return { ok: false, error: "You're not in this activity." };
      }
      const previous = socket.data.instanceId;
      if (previous && previous !== instanceId) {
        rooms.get(previous)?.leaveSocket(playerId, socket.id);
        void socket.leave(instRoom(previous));
        void socket.leave(memberRoom(previous, playerId));
        rooms.prune(previous);
      }
      socket.data.instanceId = instanceId;
      await socket.join([instRoom(instanceId), memberRoom(instanceId, playerId)]);
      const row = await getPlayerRow(services.db, playerId);
      if (!row) return { ok: false, error: 'Unknown player.' };
      const r = rooms.getOrCreate(instanceId);
      r.join(toPublic(row), row.chipBalance, socket.id);
      socket.emit('lobby_state', r.state());
      socket.emit('activity_history', r.activityHistory());
      const channel = roomChannel(instanceId);
      socket.emit('chat_history', { channel, messages: await services.chat.history(channel) });
      return { ok: true };
    }));

    socket.on('open_table', handle(async (data: { rules: unknown }) => {
      const r = room();
      if (!r) return { ok: false, error: 'Join the room first.' };
      return r.openTable(playerId, pickRules(data?.rules));
    }));
    socket.on('update_rules', handle((data: { rules: unknown }) => needTable((t) => t.updateRules(playerId, pickRules(data?.rules)))));
    socket.on('start_table', handle(() => needTable((t) => t.start(playerId))));
    socket.on('close_table', handle(() => needTable((t) => t.close(playerId))));
    socket.on('watch_table', handle(() => exclusively(playerId, async () => {
      const r = room();
      const t = table();
      if (!r || !t) return { ok: false, error: 'There is no table open.' };
      const row = await getPlayerRow(services.db, playerId);
      if (!row) return { ok: false, error: 'Unknown player.' };
      return t.watch(toPublic(row));
    })));
    // Joining then buying in spans awaits: a double-tapped take_seat must not run
    // two joins at once (the second would replace the freshly seated member).
    socket.on('take_seat', handle((data: { seat: number; buyIn: number }) => exclusively(playerId, async () => {
      const t = table();
      if (!t) return { ok: false, error: 'There is no table open.' };
      if (!t.isMember(playerId)) {
        const row = await getPlayerRow(services.db, playerId);
        if (row) await t.watch(toPublic(row));
      }
      return t.takeSeat(playerId, num(data?.seat), num(data?.buyIn));
    })));
    socket.on('top_up', handle((data: { amount: number }) => needTable((t) => t.topUp(playerId, num(data?.amount)))));
    socket.on('stand_up', handle(() => needTable((t) => t.standUp(playerId))));
    socket.on('leave_table', handle(() => needTable((t) => t.leave(playerId))));
    socket.on('sit_out', handle((data: { sittingOut: boolean }) => needTable((t) => t.setSittingOut(playerId, !!data?.sittingOut))));
    socket.on('cancel_pending', handle(() => needTable((t) => t.cancelPending(playerId))));
    socket.on('act', handle((action: { type: string; amount?: number }) =>
      needTable((t) => t.act(playerId, { type: action?.type as 'fold', amount: action?.amount }))));
    socket.on('emote', handle((data: { emote: string }) => needTable((t) => t.emote(playerId, String(data?.emote ?? '')))));
    socket.on('throw_item', handle((data: { itemId: string; targetId: string }) =>
      needTable((t) => t.throwItem(playerId, String(data?.itemId ?? ''), String(data?.targetId ?? '')))));
    // A reconnecting client asks for its table; if it isn't at one (any more),
    // say so, so it never keeps showing a dead table.
    socket.on('request_state', () => {
      const t = table();
      if (t?.isMember(playerId)) t.connect(playerId);
      else socket.emit('table_left', NOT_MEMBER);
    });

    socket.on('chat_send', handle(async (data: { to: unknown; body: unknown }) => {
      if (!chatLimit.allow(playerId)) return { ok: false, error: "You're sending messages too quickly." };
      // A target that isn't clearly the room must never fall through to a room broadcast.
      const to = (data?.to && typeof data.to === 'object' ? data.to : {}) as { room?: unknown; dm?: unknown };
      if (to.dm !== undefined) {
        if (typeof to.dm !== 'string' || !to.dm) return { ok: false, error: 'That player does not exist.' };
        const other = to.dm;
        if (other === playerId) return { ok: false, error: "You can't message yourself." };
        if (!(await getPlayerRow(services.db, other))) return { ok: false, error: 'That player does not exist.' };
        const res = await services.chat.send(dmChannel(playerId, other), playerId, data.body);
        if (!res.ok) return res;
        io.to([userRoom(playerId), userRoom(other)]).emit('chat_message', res.message);
        refreshMe(other);
        return { ok: true };
      }
      if (to.room !== true) return { ok: false, error: 'Pick who to send that to.' };
      const instanceId = socket.data.instanceId;
      if (!instanceId) return { ok: false, error: 'Join the room first.' };
      const res = await services.chat.send(roomChannel(instanceId), playerId, data?.body);
      if (!res.ok) return res;
      io.to(instRoom(instanceId)).emit('chat_message', res.message);
      return { ok: true };
    }));
    socket.on('chat_read', (data) => {
      // Only your own DMs or the room you're in; anything else would just store junk rows.
      const channel = data?.channel;
      if (typeof channel !== 'string') return;
      const inRoom = !!socket.data.instanceId && channel === roomChannel(socket.data.instanceId);
      if (!inRoom && !isOwnDm(playerId, channel)) return;
      void services.chat.markRead(playerId, channel).then(() => refreshMe(playerId)).catch(() => undefined);
    });

    socket.on('disconnect', () => {
      const instanceId = socket.data.instanceId;
      if (!instanceId) return;
      rooms.get(instanceId)?.leaveSocket(playerId, socket.id);
      rooms.prune(instanceId);
    });
  });

  return {
    rooms,
    refreshMe,
    dispose() {
      for (const t of refreshTimers.values()) clearTimeout(t);
      rooms.dispose();
    },
  };
}
