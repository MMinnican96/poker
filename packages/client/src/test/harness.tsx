import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import {
  DEFAULT_COSMETICS,
  DEFAULT_LOADOUT,
  DEFAULT_RULES,
  type Ack,
  type LobbyState,
  type PlayerSelf,
  type RoomMember,
  type TableSummary,
  type TableView,
} from '@poker/shared';
import { vi } from 'vitest';
import type { Api } from '../app/api';
import { ClientProvider, createClient, type Client } from '../app/client';
import { NavProvider, ProfileCardProvider, type Section } from '../app/nav';
import type { SocketLike } from '../app/store';

export function makeMe(patch: Partial<PlayerSelf> = {}): PlayerSelf {
  return {
    id: 'p1',
    name: 'Alice',
    avatarUrl: '',
    balance: 10_000,
    xp: 0,
    level: { level: 3, into: 40, needed: 220 },
    loadout: { ...DEFAULT_LOADOUT },
    owned: {},
    daily: { available: false, streak: 1, nextAmount: 500 },
    unreadMessages: 0,
    unclaimedChallenges: 0,
    ...patch,
  };
}

export function makeMember(id: string, name: string, patch: Partial<RoomMember> = {}): RoomMember {
  return { id, name, avatarUrl: '', level: 1, cosmetics: DEFAULT_COSMETICS, presence: 'lobby', balance: 10_000, ...patch };
}

export function makeSummary(patch: Partial<TableSummary> = {}): TableSummary {
  const rules = { ...DEFAULT_RULES, maxSeats: 6, ...patch.rules };
  return {
    tableId: 't1',
    rules,
    status: 'open',
    hostId: 'p2',
    hostName: 'Bob',
    seats: Array.from({ length: rules.maxSeats }, (_, seat) => ({ seat, player: null })),
    spectatorCount: 0,
    handsDealt: 0,
    ...patch,
  };
}

export function makeLobby(patch: Partial<LobbyState> = {}): LobbyState {
  return { instanceId: 'room-1', members: [makeMember('p1', 'Alice')], table: null, ...patch };
}

export function makeTableView(patch: Partial<TableView> = {}): TableView {
  const rules = { ...DEFAULT_RULES, maxSeats: 6 };
  return {
    tableId: 't1',
    instanceId: 'room-1',
    rules,
    status: 'open',
    hostId: 'p1',
    seats: Array.from({ length: 6 }, (_, seat) => ({ seat, player: null })),
    spectators: [],
    hand: null,
    handsDealt: 0,
    closing: false,
    you: { id: 'p1', role: 'spectator', seat: null, bankroll: 10_000, pending: null, sittingOut: false, pendingTopUp: 0, legal: null, emotes: [] },
    serverNow: Date.now(),
    ...patch,
  };
}

type Handler = (...args: any[]) => void;

/**
 * An in-memory socket: records emits, answers acks via `respond`, and lets
 * tests push server events with `serverEmit`.
 */
export class FakeSocket implements SocketLike {
  connected = true;
  readonly handlers = new Map<string, Set<Handler>>();
  readonly emitted: { event: string; args: unknown[] }[] = [];
  /** Answer for acked commands; defaults to ok. */
  respond: (event: string, args: unknown[]) => Ack | undefined = () => ({ ok: true });

  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn?: Handler) {
    if (fn) this.handlers.get(event)?.delete(fn);
    else this.handlers.delete(event);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args });
    return this;
  }
  timeout(): { emit(event: string, ...args: unknown[]): unknown } {
    return {
      emit: (event: string, ...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: unknown, ack?: Ack) => void;
        const payload = args.slice(0, -1);
        this.emitted.push({ event, args: payload });
        const ack = this.respond(event, payload);
        queueMicrotask(() => (ack ? cb(null, ack) : cb(new Error('timeout'))));
        return this;
      },
    };
  }
  connect() {
    return this;
  }
  /** Deliver a server → client event. */
  serverEmit(event: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
  events(name: string) {
    return this.emitted.filter((e) => e.event === name);
  }
}

export function fakeApi(patch: Partial<Api> = {}): Api {
  const notCalled = () => vi.fn(async () => { throw new Error('not stubbed'); });
  return {
    me: notCalled(),
    claimDaily: notCalled(),
    profile: notCalled(),
    playerStats: notCalled(),
    myHands: notCalled(),
    leaderboard: notCalled(),
    purchase: notCalled(),
    equip: notCalled(),
    challenges: notCalled(),
    claimChallenge: notCalled(),
    conversations: notCalled(),
    history: notCalled(),
    ...patch,
  } as Api;
}

export function makeClient(opts: { me?: PlayerSelf; api?: Partial<Api>; socket?: FakeSocket } = {}) {
  const socket = opts.socket ?? new FakeSocket();
  const client: Client = createClient(
    { mode: 'mock', token: 'tok', me: opts.me ?? makeMe(), instanceId: 'room-1' },
    socket,
  );
  client.api = fakeApi(opts.api);
  return { client, socket };
}

/** Render inside the same providers the app uses. */
export function renderWithClient(ui: ReactNode, opts: { me?: PlayerSelf; api?: Partial<Api>; section?: Section } = {}) {
  const { client, socket } = makeClient(opts);
  const utils = render(
    <ClientProvider client={client}>
      <NavProvider initial={opts.section}>
        <ProfileCardProvider>{ui}</ProfileCardProvider>
      </NavProvider>
    </ClientProvider>,
  );
  return { ...utils, client, socket, store: client.store };
}
