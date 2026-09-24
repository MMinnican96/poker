import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import type {
  Ack,
  AuthResponse,
  ClientToServerEvents,
  PlayerAction,
  PlayerSelf,
  ServerToClientEvents,
  TableView,
} from '@poker/shared';
import type { Db } from '../../db/client.js';
import { createServices, type Services } from '../../services/index.js';
import { createApp, type App, type AppOptions } from '../../app.js';
import { seededRandomInt } from '../../engine/index.js';
import { FAST } from '../table-harness.js';

export const SECRET = 'test';
const DEFAULT_TIMEOUT = 4000;

type ServerEvents = ServerToClientEvents;
export type EventName = keyof ServerEvents;
export type Payload<E extends EventName> = Parameters<ServerEvents[E]>[0];
type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface Received {
  event: string;
  payload: unknown;
  /** The payload as JSON, for "must never contain" assertions. */
  raw: string;
}

/** A listening app on an ephemeral port, plus the clients opened against it. */
export interface TestServer {
  app: App;
  services: Services;
  /** `http://127.0.0.1:<port>` */
  origin: string;
  clients: Set<TestClient>;
  close(): Promise<void>;
}

/** Build and listen a full app (REST + Socket.io) on a random port. */
export async function startServer(db: Db, opts: Partial<AppOptions> = {}): Promise<TestServer> {
  const services = opts.services ?? createServices(db);
  const app = createApp({
    services,
    jwtSecret: SECRET,
    allowMockAuth: true,
    timing: FAST,
    random: seededRandomInt(11),
    ...opts,
  });
  await new Promise<void>((resolve) => app.http.listen(0, '127.0.0.1', resolve));
  const { port } = app.http.address() as AddressInfo;
  const clients = new Set<TestClient>();
  return {
    app,
    services,
    origin: `http://127.0.0.1:${port}`,
    clients,
    async close() {
      for (const c of clients) c.close();
      clients.clear();
      await app.close();
    },
  };
}

export interface HttpResult<T> {
  status: number;
  body: T;
  text: string;
  contentType: string | null;
}

/** Call the REST API. `body` is sent as JSON; `rawBody` is sent verbatim as JSON-typed text. */
export async function http<T = any>(
  server: TestServer,
  path: string,
  opts: { token?: string; method?: string; body?: unknown; rawBody?: string } = {},
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${server.origin}/api${path}`, {
    method: opts.method ?? (body !== undefined ? 'POST' : 'GET'),
    headers,
    body,
  });
  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  return { status: res.status, body: parsed as T, text, contentType: res.headers.get('content-type') };
}

/** Differs per test run, so ids stay unique in a reused (real Postgres) database. */
const RUN_ID = Math.random().toString(36).slice(2, 8);
let roomCounter = 0;
/** An Activity instance id unique to this test run (room chat is persisted per instance). */
export function uniqueRoom(prefix: string): string {
  roomCounter += 1;
  return `${prefix}-${RUN_ID}-${roomCounter}`;
}

let nameCounter = 0;
/** A display name unique within this test run (mock ids derive from names). */
export function uniqueName(base: string): string {
  nameCounter += 1;
  return `${base} ${nameCounter}${Math.random().toString(36).slice(2, 6)}`;
}

/** Mock sign-in. Throws unless it succeeds. */
export async function signIn(server: TestServer, name: string): Promise<AuthResponse> {
  const res = await http<AuthResponse>(server, '/auth/mock', { body: { name } });
  if (res.status !== 200) throw new Error(`sign-in failed (${res.status}): ${res.text}`);
  return res.body;
}

/**
 * A socket.io client that records every server event so tests can await the
 * next (or latest) matching one without sleeping.
 */
export class TestClient {
  readonly log: Received[] = [];
  readonly socket: ClientSocket;
  /** Table views that carried a hand result, by hand number. */
  readonly results = new Map<number, TableView>();
  private readonly bus = new EventEmitter();

  constructor(readonly server: TestServer, readonly session: AuthResponse, socket: ClientSocket) {
    this.socket = socket;
    this.bus.setMaxListeners(100);
    socket.onAny((event: string, payload: unknown) => {
      this.log.push({ event, payload, raw: JSON.stringify(payload) ?? '' });
      if (event === 'table_state') {
        const view = payload as TableView;
        if (view.hand?.result) this.results.set(view.hand.handNumber, view);
      }
      this.bus.emit('event');
    });
    socket.on('disconnect', () => this.bus.emit('event'));
  }

  get id(): string {
    return this.session.me.id;
  }

  get token(): string {
    return this.session.token;
  }

  /** The most recent payload of an event. */
  latest<E extends EventName>(event: E): Payload<E> | undefined {
    for (let i = this.log.length - 1; i >= 0; i--) {
      if (this.log[i].event === event) return this.log[i].payload as Payload<E>;
    }
    return undefined;
  }

  get table(): TableView | undefined {
    return this.latest('table_state');
  }

  /** Every payload of an event received so far (from log index `since`). */
  all<E extends EventName>(event: E, since = 0): Payload<E>[] {
    return this.log.slice(since).filter((r) => r.event === event).map((r) => r.payload as Payload<E>);
  }

  /** Current log position; pass to `next` to only match events after it. */
  mark(): number {
    return this.log.length;
  }

  /** Resolve with the first matching event at or after log index `since` (default: from now on). */
  next<E extends EventName>(
    event: E,
    pred: (p: Payload<E>) => boolean = () => true,
    opts: { since?: number; timeout?: number } = {},
  ): Promise<Payload<E>> {
    const since = opts.since ?? this.log.length;
    let cursor = since;
    const scan = (): Payload<E> | undefined => {
      for (; cursor < this.log.length; cursor++) {
        const r = this.log[cursor];
        if (r.event === event && pred(r.payload as Payload<E>)) return r.payload as Payload<E>;
      }
      return undefined;
    };
    return this.until(scan, `${this.session.me.name}: ${event}`, opts.timeout);
  }

  /** Resolve once the latest payload of a state-like event satisfies `pred`. */
  state<E extends EventName>(event: E, pred: (p: Payload<E>) => boolean, timeout?: number): Promise<Payload<E>> {
    return this.until(() => {
      const p = this.latest(event);
      return p !== undefined && pred(p) ? p : undefined;
    }, `${this.session.me.name}: ${event} state`, timeout);
  }

  /** Resolve with `check()`'s value once it is defined, re-checking on every event. */
  until<T>(check: () => T | undefined, label: string, timeout = DEFAULT_TIMEOUT): Promise<T> {
    return waitOn([this], check, label, timeout);
  }

  /** Emit a typed command and resolve with its ack. */
  send<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: DropLast<Parameters<ClientToServerEvents[E]>>
  ): Promise<Ack> {
    return this.raw(event, ...args) as Promise<Ack>;
  }

  /** Emit anything (for malformed-payload tests) and resolve with the ack. */
  raw(event: string, ...args: unknown[]): Promise<unknown> {
    const s = this.socket as unknown as Socket;
    return s.timeout(DEFAULT_TIMEOUT).emitWithAck(event, ...args);
  }

  close(): void {
    this.socket.disconnect();
    this.server.clients.delete(this);
  }

  _subscribe(fn: () => void): () => void {
    this.bus.on('event', fn);
    return () => this.bus.off('event', fn);
  }
}

type DropLast<T extends unknown[]> = T extends [...infer Rest, unknown] ? Rest : never;

/** Wait until `check()` returns a value, re-checking whenever any of the clients receives an event. */
export function waitOn<T>(
  clients: TestClient[],
  check: () => T | undefined,
  label: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const first = check();
    if (first !== undefined) {
      resolve(first);
      return;
    }
    const unsubs: (() => void)[] = [];
    const done = () => {
      clearTimeout(timer);
      for (const u of unsubs) u();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeout);
    const onEvent = () => {
      let value: T | undefined;
      try {
        value = check();
      } catch (err) {
        done();
        reject(err);
        return;
      }
      if (value !== undefined) {
        done();
        resolve(value);
      }
    };
    for (const c of clients) unsubs.push(c._subscribe(onEvent));
  });
}

function openSocket(server: TestServer, auth: Record<string, unknown>): ClientSocket {
  return ioClient(server.origin, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
}

/** Connect an authenticated client. Resolves once the socket is connected. */
export async function connect(server: TestServer, session: AuthResponse): Promise<TestClient> {
  const socket = openSocket(server, { token: session.token });
  const client = new TestClient(server, session, socket);
  server.clients.add(client);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
  return client;
}

/** Sign in with a fresh name and connect. */
export async function player(server: TestServer, base: string): Promise<TestClient> {
  return connect(server, await signIn(server, uniqueName(base)));
}

/** Try to connect with the given handshake auth and return the connect_error message. */
export async function connectError(server: TestServer, auth: Record<string, unknown>): Promise<string> {
  const socket = openSocket(server, auth);
  try {
    return await new Promise<string>((resolve, reject) => {
      socket.once('connect', () => reject(new Error('connected unexpectedly')));
      socket.once('connect_error', (err) => resolve(err.message));
    });
  } finally {
    socket.disconnect();
  }
}

/** Join every client to the same Activity instance (and wait for its lobby snapshot). */
export async function joinAll(clients: TestClient[], instanceId: string): Promise<void> {
  for (const c of clients) {
    const ack = await c.send('join_room', { instanceId });
    if (!ack.ok) throw new Error(`join_room failed: ${ack.error}`);
  }
}

// ---------------------------------------------------------------------------
// Driving hands
// ---------------------------------------------------------------------------

export type Strategy = (view: TableView) => PlayerAction;

/** Check when possible, otherwise call. */
export const passive: Strategy = (v) => (v.you.legal!.canCheck ? { type: 'check' } : { type: 'call' });

/** True when this view says it's the viewer's turn in a live hand. */
export function myTurn(v: TableView | undefined): boolean {
  return !!v?.hand && !v.hand.result && v.hand.toActSeat !== null && v.hand.toActSeat === v.you.seat && !!v.you.legal;
}

/** The client whose latest view says it's their turn, if any. */
export function actor(clients: TestClient[]): TestClient | undefined {
  return clients.find((c) => myTurn(c.table));
}

/**
 * Act for whoever's turn it is (using each one's own latest table_state) until
 * `done()` holds. Returns the number of actions taken.
 */
export async function driveUntil(
  clients: TestClient[],
  done: () => boolean,
  strategy: Strategy = passive,
  label = 'the table',
  maxActions = 200,
): Promise<number> {
  let actions = 0;
  for (;;) {
    const next = await waitOn(clients, () => (done() ? 'done' : actor(clients) ?? undefined), label, 8000);
    if (next === 'done') return actions;
    if (++actions > maxActions) throw new Error('too many actions');
    const ack = await next.send('act', strategy(next.table!));
    if (!ack.ok) throw new Error(`act failed for ${next.session.me.name}: ${ack.error}`);
  }
}

/** Play until `count` more hands have finished. Returns the finished hand numbers. */
export async function playHands(clients: TestClient[], count: number, strategy: Strategy = passive): Promise<number[]> {
  const finished = () => new Set(clients.flatMap((c) => [...c.results.keys()]));
  const start = Math.max(0, ...finished());
  const goal = start + count;
  await driveUntil(clients, () => finished().has(goal), strategy, `hand ${goal} to finish`);
  return Array.from({ length: count }, (_, i) => start + i + 1);
}
