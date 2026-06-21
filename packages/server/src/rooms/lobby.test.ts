import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  DiscordIdentity,
  LobbyState,
  ServerToClientEvents,
} from '@poker/shared';
import { registerSocketHandlers } from './index.js';

const COUNTDOWN_MS = 60;

let httpServer: HttpServer;
let url: string;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  httpServer = createServer();
  const ioServer = new Server(httpServer);
  // Large game timers so the game started by the flow test doesn't auto-fold or
  // deal further hands during the (short) lobby assertions.
  registerSocketHandlers(ioServer as never, {
    countdownMs: COUNTDOWN_MS,
    gameTiming: { turnMs: 60_000, tickMs: 60_000, handDelayMs: 60_000 },
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const addr = httpServer.address();
  if (addr && typeof addr === 'object') url = `http://localhost:${addr.port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

type TypedClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function connect(): Promise<TypedClient> {
  const socket = Client(url, { transports: ['websocket'], forceNew: true }) as TypedClient;
  clients.push(socket as ClientSocket);
  return new Promise((resolve) => socket.on('connect', () => resolve(socket)));
}

function once<E extends keyof ServerToClientEvents>(
  socket: TypedClient,
  event: E,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => socket.once(event, resolve as never));
}

/** Resolve once a lobby_state_update satisfies the predicate (handles races). */
function waitForState(socket: TypedClient, predicate: (s: LobbyState) => boolean): Promise<LobbyState> {
  return new Promise((resolve) => {
    const handler = (s: LobbyState) => {
      if (predicate(s)) {
        socket.off('lobby_state_update', handler as never);
        resolve(s);
      }
    };
    socket.on('lobby_state_update', handler as never);
  });
}

const allReady = (n: number) => (s: LobbyState) =>
  s.players.length === n && s.players.every((p) => p.isReady);

function identity(id: string, chips: number): DiscordIdentity {
  return { discordUserId: id, displayName: id, avatarUrl: '', chipBalance: chips };
}

function fullConfig(buyIn = 3000) {
  return { buyIn, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 };
}

describe('lobby flow', () => {
  it('starts a game after a host creates it and a second player readies up', async () => {
    const instanceId = 'flow-start';
    const a = await connect();
    const b = await connect();
    a.emit('join_lobby', { instanceId, identity: identity('alice', 5000) });
    b.emit('join_lobby', { instanceId, identity: identity('bob', 5000) });
    await waitForState(a, (s) => s.players.length === 2);

    a.emit('create_game', fullConfig());
    await waitForState(a, (s) => s.hostId === 'alice');

    const bobReady = waitForState(a, (s) => s.players.find((p) => p.discordUserId === 'bob')?.isReady === true);
    b.emit('player_ready');
    await bobReady;

    const countdown = once(a, 'countdown_start');
    const gameStart = once(a, 'game_start');
    a.emit('player_ready'); // host readies implicitly (mirrors the client)
    a.emit('start_countdown');

    expect((await countdown).endsAt).toBeGreaterThan(Date.now());
    expect((await gameStart).gameId).toBeTruthy();
  });

  it('cancels the countdown if fewer than two players are funded at expiry', async () => {
    const instanceId = 'flow-underfunded';
    const a = await connect();
    const b = await connect();
    a.emit('join_lobby', { instanceId, identity: identity('rich', 5000) });
    b.emit('join_lobby', { instanceId, identity: identity('broke', 100) }); // < 3000 buy-in
    await waitForState(a, (s) => s.players.length === 2);

    a.emit('create_game', fullConfig());
    await waitForState(a, (s) => s.hostId === 'rich');

    const brokeReady = waitForState(a, (s) => s.players.find((p) => p.discordUserId === 'broke')?.isReady === true);
    b.emit('player_ready');
    await brokeReady;

    const cancelled = once(a, 'countdown_cancel');
    a.emit('player_ready');
    a.emit('start_countdown');
    await cancelled; // resolves => game did not start
  });

  it('only lets the host edit the table config after creating the game', async () => {
    const instanceId = 'flow-config';
    const host = await connect();
    const guest = await connect();
    host.emit('join_lobby', { instanceId, identity: identity('host', 5000) });
    guest.emit('join_lobby', { instanceId, identity: identity('guest', 5000) });
    await waitForState(host, (s) => s.players.length === 2);

    host.emit('create_game', fullConfig());
    await waitForState(host, (s) => s.hostId === 'host');

    const applied = waitForState(host, (s) => s.config.buyIn === 1000);
    host.emit('update_config', { buyIn: 1000 });
    expect((await applied).config.buyIn).toBe(1000);

    guest.emit('update_config', { buyIn: 99 }); // ignored: not the host
    const next = waitForState(host, (s) => s.config.smallBlind === 10);
    host.emit('update_config', { smallBlind: 10 });
    expect((await next).config.buyIn).toBe(1000);
  });

  it('accepts a valid turnSeconds from the host', async () => {
    const instanceId = 'flow-turnseconds-valid';
    const host = await connect();
    host.emit('join_lobby', { instanceId, identity: identity('host-ts', 5000) });
    await waitForState(host, (s) => s.players.length === 1);
    host.emit('create_game', fullConfig());
    await waitForState(host, (s) => s.hostId === 'host-ts');

    const applied = waitForState(host, (s) => s.config.turnSeconds === 45);
    host.emit('update_config', { turnSeconds: 45 });
    expect((await applied).config.turnSeconds).toBe(45);
  });

  it('keeps a join_table spectator in the player list and adds them to activeGame', async () => {
    const a = await connect(); const b = await connect(); const c = await connect();
    a.emit('join_lobby', { instanceId: 'spec', identity: identity('a', 5000) });
    b.emit('join_lobby', { instanceId: 'spec', identity: identity('b', 5000) });
    c.emit('join_lobby', { instanceId: 'spec', identity: identity('c', 5000) });
    await waitForState(c, (s) => s.players.length === 3);

    a.emit('create_game', fullConfig());
    await waitForState(c, (s) => s.hostId === 'a');
    b.emit('player_ready');
    await waitForState(c, (s) => s.players.find((p) => p.discordUserId === 'b')?.isReady === true);
    a.emit('player_ready');
    a.emit('start_countdown');
    await once(c, 'game_start');

    c.emit('join_table');
    const s = await waitForState(c, (st) => st.activeGame?.spectatingCount === 1);
    // Table members are no longer filtered out of the lobby player list.
    expect(s.players.some((p) => p.discordUserId === 'c')).toBe(true);
    expect(s.activeGame?.members.some((m) => m.discordUserId === 'c' && m.role === 'spectator')).toBe(true);
  });

  it('rejects out-of-range or non-step turnSeconds', async () => {
    const instanceId = 'flow-turnseconds-invalid';
    const host = await connect();
    host.emit('join_lobby', { instanceId, identity: identity('host-ts2', 5000) });
    await waitForState(host, (s) => s.players.length === 1);
    host.emit('create_game', fullConfig());
    await waitForState(host, (s) => s.hostId === 'host-ts2');

    host.emit('update_config', { turnSeconds: 5 });   // below min
    host.emit('update_config', { turnSeconds: 200 }); // above max
    host.emit('update_config', { turnSeconds: 33 });  // not a multiple of 5

    const settled = waitForState(host, (s) => s.config.buyIn === 999);
    host.emit('update_config', { buyIn: 999 });
    const state = await settled;
    expect(state.config.turnSeconds).toBe(30); // unchanged default
  });
});
