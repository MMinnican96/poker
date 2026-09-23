import type { Server, Socket } from 'socket.io';
import {
  dmChannel,
  roomChannel,
  type Ack,
  type AckFn,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
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

  const outbox: Outbox = {
    lobby: (instanceId, state) => io.to(instRoom(instanceId)).emit('lobby_state', state),
    tableView: (instanceId, playerId, view) => io.to(memberRoom(instanceId, playerId)).emit('table_state', view),
    tableLeft: (instanceId, playerId, reason) => io.to(memberRoom(instanceId, playerId)).emit('table_left', { reason }),
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
    void services.profiles.self(playerId).then((me) => me && socket.emit('me', me));

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

    socket.on('open_table', handle(async (data: { rules: object }) => {
      const r = room();
      if (!r) return { ok: false, error: 'Join the room first.' };
      return r.openTable(playerId, (data?.rules ?? {}) as object);
    }));
    socket.on('update_rules', handle((data: { rules: object }) => needTable((t) => t.updateRules(playerId, (data?.rules ?? {}) as object))));
    socket.on('start_table', handle(() => needTable((t) => t.start(playerId))));
    socket.on('close_table', handle(() => needTable((t) => t.close(playerId))));
    socket.on('watch_table', handle(async () => {
      const r = room();
      const t = table();
      if (!r || !t) return { ok: false, error: 'There is no table open.' };
      const row = await getPlayerRow(services.db, playerId);
      if (!row) return { ok: false, error: 'Unknown player.' };
      return t.watch(toPublic(row));
    }));
    socket.on('take_seat', handle(async (data: { seat: number; buyIn: number }) => {
      const t = table();
      if (!t) return { ok: false, error: 'There is no table open.' };
      if (!t.isMember(playerId)) {
        const row = await getPlayerRow(services.db, playerId);
        if (row) await t.watch(toPublic(row));
      }
      return t.takeSeat(playerId, Number(data?.seat), Number(data?.buyIn));
    }));
    socket.on('top_up', handle((data: { amount: number }) => needTable((t) => t.topUp(playerId, Number(data?.amount)))));
    socket.on('stand_up', handle(() => needTable((t) => t.standUp(playerId))));
    socket.on('leave_table', handle(() => needTable((t) => t.leave(playerId))));
    socket.on('sit_out', handle((data: { sittingOut: boolean }) => needTable((t) => t.setSittingOut(playerId, !!data?.sittingOut))));
    socket.on('cancel_pending', handle(() => needTable((t) => t.cancelPending(playerId))));
    socket.on('act', handle((action: { type: string; amount?: number }) =>
      needTable((t) => t.act(playerId, { type: action?.type as 'fold', amount: action?.amount }))));
    socket.on('emote', handle((data: { emote: string }) => needTable((t) => t.emote(playerId, String(data?.emote ?? '')))));
    socket.on('throw_item', handle((data: { itemId: string; targetId: string }) =>
      needTable((t) => t.throwItem(playerId, String(data?.itemId ?? ''), String(data?.targetId ?? '')))));
    socket.on('request_state', () => {
      const t = table();
      if (t?.isMember(playerId)) t.connect(playerId);
    });

    socket.on('chat_send', handle(async (data: { to: { room?: true; dm?: string }; body: string }) => {
      if (!chatLimit.allow(playerId)) return { ok: false, error: "You're sending messages too quickly." };
      if (data?.to && 'dm' in data.to && typeof data.to.dm === 'string') {
        const other = data.to.dm;
        if (other === playerId) return { ok: false, error: "You can't message yourself." };
        if (!(await getPlayerRow(services.db, other))) return { ok: false, error: 'That player does not exist.' };
        const res = await services.chat.send(dmChannel(playerId, other), playerId, data.body);
        if (!res.ok) return res;
        io.to([userRoom(playerId), userRoom(other)]).emit('chat_message', res.message);
        refreshMe(other);
        return { ok: true };
      }
      const instanceId = socket.data.instanceId;
      if (!instanceId) return { ok: false, error: 'Join the room first.' };
      const res = await services.chat.send(roomChannel(instanceId), playerId, data?.body);
      if (!res.ok) return res;
      io.to(instRoom(instanceId)).emit('chat_message', res.message);
      return { ok: true };
    }));
    socket.on('chat_read', (data) => {
      if (typeof data?.channel !== 'string') return;
      void services.chat.markRead(playerId, data.channel).then(() => refreshMe(playerId)).catch(() => undefined);
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
