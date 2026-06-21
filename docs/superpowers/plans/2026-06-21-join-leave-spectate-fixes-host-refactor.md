# Join/Leave/Spectate Fixes + Host Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five reported spectate/join/leave bugs and replace the implicit "first joiner is host" lobby with an explicit "anyone can Create a Game" model.

**Architecture:** The server stays authoritative. `LobbyRoom` gains a transferable `hostId` with `createGame`/`cancelGame`/`resetAfterGame` and a live `updateChipBalance`; `GameRoom` renders a synthetic "waiting" view from the real seated members (instead of the stale last-hand engine context) and exposes `request_game_state` + an `onChipBalanceChange` hook. The client derives the host from `lobby.hostId`, adds Create/Cancel-Game UI, richer per-player status labels, and requests state on entering the table.

**Tech Stack:** TypeScript (NodeNext ESM) monorepo; Node + Express + Socket.io (server); React + Phaser 3 + Tailwind v4 (client); Vitest + React Testing Library (tests).

## Global Constraints

- `@poker/shared` is ESM (NodeNext), built to `dist/`. Keep `shared/src` to `.ts` only; the server consumes the **built** package. After editing shared types, rebuild: `npm run build --workspace=packages/shared`.
- The server is the single source of truth for game state. Identity is server-side; never trust client claims.
- Tests live next to source as `*.test.ts` / `*.test.tsx`. Server and client both run `vitest run`.
- Never hardcode hex values in component files unless following the existing pattern in that file (some lobby files use arbitrary Tailwind values like `text-[#9ad4ff]` — match the surrounding file).
- After all changes: `npm test` and `npm run build` must pass.
- Only one game per instance at a time (unchanged).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- `packages/shared/src/types.ts` — add `hostId` to `LobbyState`.
- `packages/shared/src/events.ts` — add `create_game`, `cancel_game`, `request_game_state`; keep `update_config`.
- `packages/server/src/rooms/lobby.ts` — host model (create/cancel/transfer/reset), host-only start + config edit, live chip balance, stop filtering table members.
- `packages/server/src/rooms/game.ts` — `currentView`/`waitingView`, `sendStateTo`, `onChipBalanceChange`, `member.bankroll` sync.
- `packages/server/src/rooms/index.ts` — wire `create_game`/`cancel_game`/`request_game_state`, `onChipBalanceChange`, `resetAfterGame` on end.
- `packages/server/src/rooms/lobby-room.test.ts` — **new** direct unit tests for the host model + chip balance.
- `packages/server/src/rooms/lobby.test.ts` — rewrite socket flow tests for the create-game model.
- `packages/server/src/rooms/game.test.ts` — add waiting-view, request-state, chip-callback tests.
- `packages/client/src/App.tsx` + `App.test.tsx` — request state on join.
- `packages/client/src/lobby/{LobbyScreen,TableSettings,PlayersPanel,PlayerRow,PlayerProfileModal}.tsx` + their tests — host UI + status labels.
- Docs: `docs/ARCHITECTURE.md`, `docs/To-do.md`, `CLAUDE.md`.

---

## Task 1: Shared contracts (hostId + new events)

**Files:**
- Modify: `packages/shared/src/types.ts` (the `LobbyState` interface, ~line 46-54)
- Modify: `packages/shared/src/events.ts` (`ServerToClientEvents`/`ClientToServerEvents`)

**Interfaces:**
- Produces: `LobbyState.hostId: string | null`; client→server events `create_game(config: TableConfig)`, `cancel_game()`, `request_game_state()`; `update_config(config: Partial<TableConfig>)` retained.

- [ ] **Step 1: Add `hostId` to `LobbyState`**

In `packages/shared/src/types.ts`, change the `LobbyState` interface to:

```ts
export interface LobbyState {
  instanceId: string;
  players: LobbyPlayer[];
  status: LobbyStatus;
  countdownEndsAt: number | null;
  config: TableConfig;
  /** The player who created/hosts the pending game; null when no game is hosted. */
  hostId: string | null;
  /** Present when a game is running on this instance; null/absent otherwise. */
  activeGame?: ActiveGameSummary | null;
}
```

- [ ] **Step 2: Add the new client→server events**

In `packages/shared/src/events.ts`, update `ClientToServerEvents` to add three events (keep `update_config`):

```ts
export interface ClientToServerEvents {
  join_lobby: (data: { instanceId: string; identity: DiscordIdentity }) => void;
  player_ready: () => void;
  player_unready: () => void;
  start_countdown: () => void;
  cancel_countdown: () => void;
  update_config: (config: Partial<TableConfig>) => void;
  create_game: (config: TableConfig) => void;
  cancel_game: () => void;
  player_action: (action: PlayerAction) => void;
  leave_table: () => void;
  join_table: () => void;
  sit_in: () => void;
  sit_out: () => void;
  cancel_pending: () => void;
  request_game_state: () => void;
}
```

`ServerToClientEvents` is unchanged.

- [ ] **Step 3: Build shared to verify the contract compiles**

Run: `npm run build --workspace=packages/shared`
Expected: exits 0, regenerates `packages/shared/dist/*` (`types.d.ts`, `events.d.ts`, etc.).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src packages/shared/dist
git commit -m "feat(shared): add lobby hostId + create/cancel/request-state events

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Server lobby host model

**Files:**
- Modify: `packages/server/src/rooms/lobby.ts`
- Modify: `packages/server/src/rooms/index.ts` (register `create_game`/`cancel_game`; reset on end)
- Create: `packages/server/src/rooms/lobby-room.test.ts`
- Modify: `packages/server/src/rooms/lobby.test.ts` (rewrite socket flow tests)

**Interfaces:**
- Consumes: `LobbyState.hostId` (Task 1); `create_game`/`cancel_game` events (Task 1).
- Produces: `LobbyRoom.createGame(socketId: string, config: TableConfig): void`,
  `LobbyRoom.cancelGame(socketId: string): void`,
  `LobbyRoom.resetAfterGame(): void`,
  `LobbyRoom.updateChipBalance(playerId: string, balance: number): void`.
  `toState()` now includes `hostId` and no longer filters table members out of `players`.

- [ ] **Step 1: Write the failing unit tests for the host model**

Create `packages/server/src/rooms/lobby-room.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { DiscordIdentity, TableConfig } from '@poker/shared';
import { LobbyRoom } from './lobby.js';

function fakeIo() {
  const emits: { event: string; args: unknown[] }[] = [];
  const io = { to: () => ({ emit: (event: string, ...args: unknown[]) => emits.push({ event, args }) }) };
  return { io, emits };
}
const id = (i: string, chips: number): DiscordIdentity => ({ discordUserId: i, displayName: i, avatarUrl: '', chipBalance: chips });
const cfg = (buyIn = 3000): TableConfig => ({ buyIn, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 });
function room() {
  const { io } = fakeIo();
  return new LobbyRoom('I', io as never, { countdownMs: 100 });
}

describe('LobbyRoom host model', () => {
  it('has no host until a game is created', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    expect(r.toState().hostId).toBeNull();
  });

  it('createGame sets the host and config', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.createGame('sa', cfg(1000));
    const st = r.toState();
    expect(st.hostId).toBe('a');
    expect(st.config.buyIn).toBe(1000);
  });

  it('rejects createGame from an underfunded player', () => {
    const r = room();
    r.addPlayer(id('a', 100), 'sa');
    r.createGame('sa', cfg(3000));
    expect(r.toState().hostId).toBeNull();
  });

  it('rejects a second createGame while a host exists', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg(1000));
    r.createGame('sb', cfg(2000));
    expect(r.toState().hostId).toBe('a');
  });

  it('cancelGame clears the host and ready flags', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg());
    r.setReady('sb', true);
    r.cancelGame('sa');
    const st = r.toState();
    expect(st.hostId).toBeNull();
    expect(st.players.every((p) => !p.isReady)).toBe(true);
  });

  it('ignores cancelGame from a non-host', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg());
    r.cancelGame('sb');
    expect(r.toState().hostId).toBe('a');
  });

  it('transfers host to the next player when the host leaves', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg());
    r.removeBySocket('sa');
    expect(r.toState().hostId).toBe('b');
  });

  it('clears the host when the last player leaves', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.createGame('sa', cfg());
    r.removeBySocket('sa');
    expect(r.toState().hostId).toBeNull();
  });

  it('only lets the host edit config while forming', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg(1000));
    r.updateConfig('sb', { buyIn: 99 });   // non-host: ignored
    r.updateConfig('sa', { buyIn: 2000 });  // host: applies
    expect(r.toState().config.buyIn).toBe(2000);
  });

  it('resetAfterGame clears host, ready and status', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg());
    r.setReady('sb', true);
    r.resetAfterGame();
    const st = r.toState();
    expect(st.hostId).toBeNull();
    expect(st.status).toBe('waiting');
    expect(st.players.every((p) => !p.isReady)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/server -- lobby-room`
Expected: FAIL — `createGame`/`cancelGame`/`resetAfterGame` are not functions, and `hostId` is missing from `toState()`.

- [ ] **Step 3: Implement the host model in `lobby.ts`**

In `packages/server/src/rooms/lobby.ts`:

(a) Update the `hostId` doc comment (line ~44) and **remove the auto-host assignment** in `addPlayer`. Replace the `addPlayer` body with this (also preserves an existing live `chipBalance`):

```ts
  /** Add or refresh a player (idempotent on reconnect by discordUserId). */
  addPlayer(identity: DiscordIdentity, socketId: string): void {
    const existing = this.players.get(identity.discordUserId);
    this.players.set(identity.discordUserId, {
      discordUserId: identity.discordUserId,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      // Preserve the lobby's live-tracked balance across a rejoin (e.g. table→lobby
      // re-emit of join_lobby) so a stale identity value can't clobber it.
      chipBalance: existing?.chipBalance ?? identity.chipBalance,
      isReady: existing?.isReady ?? false,
      socketId,
    });
    this.broadcast();
  }
```

(b) Replace `updateConfig` (host-only while forming; drop the `readyPlayers > 0` clause):

```ts
  updateConfig(socketId: string, patch: Partial<TableConfig>): void {
    const player = this.bySocket(socketId);
    if (!player) return;
    // Host only, while forming (status waiting with a host set).
    if (player.discordUserId !== this.hostId || this.status !== 'waiting') return;
    this.config = { ...this.config, ...sanitizeConfig(patch) };
    this.broadcast();
  }

  /** A lobby player creates the (single) game with their chosen settings → becomes host. */
  createGame(socketId: string, config: TableConfig): void {
    const player = this.bySocket(socketId);
    if (!player || this.hostId !== null || this.status !== 'waiting') return;
    if (this.activeGameProvider?.()) return; // a game is already running
    const next = { ...DEFAULT_TABLE_CONFIG, ...sanitizeConfig(config) };
    if (player.chipBalance < next.buyIn) return; // host must afford the buy-in
    this.config = next;
    this.hostId = player.discordUserId;
    this.broadcast();
  }

  /** Host disbands the not-yet-started game, returning the lobby to the open state. */
  cancelGame(socketId: string): void {
    const player = this.bySocket(socketId);
    if (!player || player.discordUserId !== this.hostId || this.status !== 'waiting') return;
    this.hostId = null;
    for (const p of this.players.values()) p.isReady = false;
    this.broadcast();
  }
```

(c) Make `startCountdown` host-only — change its head:

```ts
  startCountdown(socketId: string): void {
    const player = this.bySocket(socketId);
    if (!player || player.discordUserId !== this.hostId) return;
    if (this.status !== 'waiting') return;
    if (this.readyPlayers().length < 2) return;
    // ...unchanged body...
```

(d) Add `resetAfterGame` and `updateChipBalance` (place after `setActiveGameProvider`):

```ts
  /** Called when the active game ends: clear host + ready flags, reopen the lobby. */
  resetAfterGame(): void {
    this.clearTimer();
    this.hostId = null;
    this.status = 'waiting';
    this.countdownEndsAt = null;
    for (const p of this.players.values()) p.isReady = false;
    this.broadcast();
  }

  /** Update a player's displayed bankroll (driven by GameRoom chip movements). */
  updateChipBalance(playerId: string, balance: number): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.chipBalance = balance;
    this.broadcast();
  }
```

(e) Update `toState` to include `hostId` and stop filtering members out:

```ts
  toState(): LobbyState {
    const active = this.activeGameProvider?.() ?? null;
    return {
      instanceId: this.instanceId,
      players: [...this.players.values()],
      status: this.status,
      countdownEndsAt: this.countdownEndsAt,
      config: this.config,
      hostId: this.hostId,
      activeGame: active?.summary ?? null,
    };
  }
```

The existing `removeBySocket` already reassigns `hostId` to the next player (or null) when the host leaves — leave that logic in place; it now satisfies the transfer tests.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm run test --workspace=packages/server -- lobby-room`
Expected: PASS (all host-model tests green).

- [ ] **Step 5: Wire the new events + end-of-game reset in `index.ts`**

In `packages/server/src/rooms/index.ts`:

(a) In the `onEnd` callback (inside the `LobbyManager` options), replace the body so it resets the lobby:

```ts
        onEnd: (id) => {
          if (games.get(room.instanceId)?.gameId === id) games.delete(room.instanceId);
          const lr = lobbies.get(room.instanceId);
          lr?.setActiveGameProvider(null);
          lr?.resetAfterGame();
        },
```

(b) Add socket handlers next to the existing `update_config` handler:

```ts
    socket.on('update_config', (patch) =>
      withLobby(socket, (room) => room.updateConfig(socket.id, patch)),
    );
    socket.on('create_game', (config) =>
      withLobby(socket, (room) => room.createGame(socket.id, config)),
    );
    socket.on('cancel_game', () => withLobby(socket, (room) => room.cancelGame(socket.id)));
```

- [ ] **Step 6: Rewrite the socket flow tests in `lobby.test.ts`**

Replace the entire `describe('lobby flow', ...)` block in `packages/server/src/rooms/lobby.test.ts` with the version below. Keep everything above line 73 (imports + helpers) unchanged, and add a `fullConfig` helper just below the `identity` helper:

```ts
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
```

- [ ] **Step 7: Run the full server suite**

Run: `npm run test --workspace=packages/server`
Expected: PASS — `lobby-room.test.ts`, the rewritten `lobby.test.ts`, and all unchanged suites (engine, game, stats) green.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/rooms/lobby.ts packages/server/src/rooms/index.ts packages/server/src/rooms/lobby-room.test.ts packages/server/src/rooms/lobby.test.ts
git commit -m "feat(server): explicit host model — create/cancel/transfer/reset

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Server game waiting-view + request_game_state

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Modify: `packages/server/src/rooms/index.ts` (wire `request_game_state`)
- Modify: `packages/server/src/rooms/game.test.ts` (add tests)

**Interfaces:**
- Consumes: `request_game_state` event (Task 1).
- Produces: `GameRoom.sendStateTo(playerId: string): void`; a private `currentView(viewerId)` that returns the live engine view when a hand is running with ≥2 seated, otherwise a synthetic waiting `GameState` built from the seated members. `broadcastState()` no longer early-returns when `ctx` is null.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `packages/server/src/rooms/game.test.ts`:

```ts
describe('GameRoom waiting view', () => {
  it('does not render a player who left as seated, and lists them as a spectator', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    // 'a' moves to spectate; finish the hand and resolve → 1 seated, table idles.
    room.moveToSpectate('a');
    room.handleAction('a', { type: 'fold' });
    (room as unknown as { scheduleNextHand(): void }).scheduleNextHand();

    const view = io.records
      .filter((r) => r.target === 'sb' && r.event === 'game_state_update')
      .at(-1)!.args[0] as GameState;
    expect(view.players.some((p) => p.discordUserId === 'a')).toBe(false);
    expect(view.players.map((p) => p.discordUserId)).toEqual(['b']);
    expect(view.spectators?.some((s) => s.discordUserId === 'a')).toBe(true);
    expect(view.waitingForPlayers).toBe(true);
    room.stop();
  });

  it('sends the current view to a player who requests it', async () => {
    const io = makeFakeIo();
    const room = makeRoom(io, makeFakeChips().service);
    await room.start();

    const before = io.records.filter((r) => r.target === 'sa' && r.event === 'game_state_update').length;
    room.sendStateTo('a');
    const after = io.records.filter((r) => r.target === 'sa' && r.event === 'game_state_update').length;
    expect(after).toBe(before + 1);
    room.stop();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/server -- game.test`
Expected: FAIL — `sendStateTo` is not a function, and the idle view still lists `a` as a seated player (stale ctx).

- [ ] **Step 3: Replace `tableView` with `currentView` + `waitingView` and add `sendStateTo`**

In `packages/server/src/rooms/game.ts`, replace the `tableView` method (around line 571-585) with:

```ts
  /** The viewer's per-recipient view: live engine view mid-hand, else a waiting view. */
  private currentView(viewerId: string): GameState {
    const me = this.members.find((m) => m.discordUserId === viewerId);
    if (this.handInProgress && this.ctx && this.seated().length >= 2) {
      const base = viewFor(this.ctx.state, viewerId);
      return {
        ...base,
        spectators: this.spectatorMembers().map((m) => ({
          discordUserId: m.discordUserId,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl,
        })),
        waitingForPlayers: false,
        viewerPending: me?.pending ?? null,
      };
    }
    return this.waitingView(viewerId);
  }

  /** A board-free view built from the *current* seated members (idle / between hands). */
  private waitingView(viewerId: string): GameState {
    const me = this.members.find((m) => m.discordUserId === viewerId);
    const seated = this.seated();
    return {
      gameId: this.gameId,
      instanceId: this.instanceId,
      phase: 'waiting',
      players: seated.map((m, i) => ({
        discordUserId: m.discordUserId,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
        seatIndex: i,
        chipStack: m.chipStack,
        betThisRound: 0,
        totalBetThisHand: 0,
        holeCards: null,
        status: 'active' as const,
        hasActed: false,
      })),
      communityCards: [],
      pots: [],
      currentPlayerIndex: 0,
      dealerIndex: 0,
      smallBlindIndex: 0,
      bigBlindIndex: 0,
      callAmount: 0,
      minRaise: this.config.bigBlind,
      handNumber: this.handNumber,
      config: this.config,
      spectators: this.spectatorMembers().map((m) => ({
        discordUserId: m.discordUserId,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
      })),
      waitingForPlayers: seated.length < 2,
      viewerPending: me?.pending ?? null,
    };
  }

  /** Push the current view to one player's socket (e.g. on request_game_state). */
  sendStateTo(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m) return;
    this.io.to(m.socketId).emit('game_state_update', this.currentView(playerId));
  }
```

- [ ] **Step 4: Point `broadcastState` and `reconnect` at `currentView`**

Replace `broadcastState` (around line 587-593) with (note: no early return on null `ctx`):

```ts
  private broadcastState(): void {
    for (const m of this.members) {
      if (m.left) continue;
      this.io.to(m.socketId).emit('game_state_update', this.currentView(m.discordUserId));
    }
  }
```

In `reconnect` (around line 478-487), replace the trailing `if (this.ctx) { ... }` block with an unconditional send:

```ts
    member.socketId = socketId;
    member.disconnected = false;
    member.disconnectedAt = undefined;
    this.io.to(socketId).emit('game_state_update', this.currentView(playerId));
```

- [ ] **Step 5: Wire `request_game_state` in `index.ts`**

In `packages/server/src/rooms/index.ts`, add a handler next to `player_action`:

```ts
    socket.on('request_game_state', () => {
      const game = gameFor(socket);
      if (game && socket.data.discordUserId) game.sendStateTo(socket.data.discordUserId);
    });
```

- [ ] **Step 6: Run the server suite**

Run: `npm run test --workspace=packages/server`
Expected: PASS — new waiting-view tests pass; existing game tests (`moves a seated player to spectate`, `idles ... when only one player is seated`, spectator/bust tests) still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/index.ts packages/server/src/rooms/game.test.ts
git commit -m "fix(server): render idle table from seated members + request_game_state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Live chip balances (game → lobby)

**Files:**
- Modify: `packages/server/src/rooms/game.ts` (`onChipBalanceChange` + `member.bankroll` sync)
- Modify: `packages/server/src/rooms/index.ts` (wire the callback)
- Modify: `packages/server/src/rooms/game.test.ts` (callback test)
- Modify: `packages/server/src/rooms/lobby-room.test.ts` (chip-balance unit tests)

**Interfaces:**
- Consumes: `LobbyRoom.updateChipBalance(playerId, balance)` (Task 2).
- Produces: `GameRoom.onChipBalanceChange?: (playerId: string, bankroll: number) => void`, fired after every buy-in/sit-in deduction and every cash-out credit; `member.bankroll` kept in sync.

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/rooms/game.test.ts` (new `describe`):

```ts
describe('GameRoom chip-balance reporting', () => {
  it('reports the updated bankroll on buy-in and cash-out', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    const updates: { id: string; bal: number }[] = [];
    room.onChipBalanceChange = (id, bal) => updates.push({ id, bal });
    await room.start();

    // Buy-in deducts the 3000 stake from each 3000 bankroll → 0.
    expect(updates).toContainEqual({ id: 'a', bal: 0 });
    expect(updates).toContainEqual({ id: 'b', bal: 0 });

    // Conclude a hand, then both leave → cash-outs credit their stacks back.
    const concluded = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' });
    await concluded;
    room.leave('a');
    room.leave('b');

    expect(updates.some((u) => u.id === 'a' && u.bal > 0)).toBe(true);
    expect(updates.some((u) => u.id === 'b' && u.bal > 0)).toBe(true);
    room.stop();
  });
});
```

Add to `packages/server/src/rooms/lobby-room.test.ts` (new `describe`, reusing the `room`/`id` helpers already in the file):

```ts
describe('LobbyRoom chip balances', () => {
  it('updateChipBalance updates the stored balance', () => {
    const r = room();
    r.addPlayer(id('a', 3000), 'sa');
    r.updateChipBalance('a', 1500);
    expect(r.toState().players.find((p) => p.discordUserId === 'a')!.chipBalance).toBe(1500);
  });

  it('addPlayer preserves a live balance across a rejoin', () => {
    const r = room();
    r.addPlayer(id('a', 3000), 'sa');
    r.updateChipBalance('a', 500);
    r.addPlayer(id('a', 3000), 'sa2'); // rejoin with a stale identity balance
    expect(r.toState().players.find((p) => p.discordUserId === 'a')!.chipBalance).toBe(500);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/server -- "game.test|lobby-room"`
Expected: FAIL — `onChipBalanceChange` is never invoked (the game-side test), while the lobby-room chip tests already pass (the methods landed in Task 2; that's fine — they confirm the contract).

- [ ] **Step 3: Add the callback + bankroll sync in `game.ts`**

(a) Declare the hook next to `onMembershipChange` (around line 130-131):

```ts
  /** Set by rooms/index.ts to notify the lobby when the membership roster changes. */
  onMembershipChange?: () => void;
  /** Set by rooms/index.ts to push a player's updated bankroll to the lobby. */
  onChipBalanceChange?: (playerId: string, bankroll: number) => void;
```

(b) In `start()`, inside the per-seat map, after `m.chipStack = this.config.buyIn;` add:

```ts
        m.chipStack = this.config.buyIn;
        m.bankroll -= this.config.buyIn;
        this.onChipBalanceChange?.(m.discordUserId, m.bankroll);
```

(c) In `applyPending()`, in the `pending === 'seat'` branch, after `m.chipStack = this.config.buyIn;` add the same two lines:

```ts
        m.chipStack = this.config.buyIn;
        m.bankroll -= this.config.buyIn;
        this.onChipBalanceChange?.(m.discordUserId, m.bankroll);
        m.role = 'seated';
```

(d) Replace `cashOut` so it credits + reports the bankroll:

```ts
  private async cashOut(m: Member): Promise<void> {
    if (m.chipStack <= 0) return;
    const amount = m.chipStack;
    m.chipStack = 0;
    m.bankroll += amount;
    this.onChipBalanceChange?.(m.discordUserId, m.bankroll);
    await this.chips.adjust({
      playerId: m.discordUserId,
      amount,
      type: 'cash-out',
      idempotencyKey: `${this.gameId}:cashout:${m.discordUserId}:${m.seatSession}`,
    });
  }
```

- [ ] **Step 4: Wire the callback in `index.ts`**

In `packages/server/src/rooms/index.ts`, just after `game.onMembershipChange = () => lobbyRoom?.broadcastState();`, add:

```ts
      game.onChipBalanceChange = (id, bal) => lobbies.get(room.instanceId)?.updateChipBalance(id, bal);
```

- [ ] **Step 5: Run the server suite**

Run: `npm run test --workspace=packages/server`
Expected: PASS — chip-callback test green; the `ledger net to zero` test still passes (bankroll bookkeeping is independent of the ledger calls).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/index.ts packages/server/src/rooms/game.test.ts packages/server/src/rooms/lobby-room.test.ts
git commit -m "feat(server): push live bankroll changes to the lobby

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Client — request state on entering the table

**Files:**
- Modify: `packages/client/src/App.tsx` (emit `request_game_state` on `joined_table`)
- Modify: `packages/client/src/App.test.tsx`

**Interfaces:**
- Consumes: `request_game_state` event (Task 1); `joined_table`/`left_table` (existing).

- [ ] **Step 1: Write the failing test**

Add to `packages/client/src/App.test.tsx`:

```ts
it('requests the current game state when joining the table', async () => {
  render(<App />);
  await screen.findByText('LOBBY VIEW');
  act(() => handlers['joined_table']?.({ gameId: 'G', role: 'seated' }));
  expect(fakeSocket.emit).toHaveBeenCalledWith('request_game_state');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/client -- App.test`
Expected: FAIL — `request_game_state` is never emitted.

- [ ] **Step 3: Emit `request_game_state` in the `joined_table` handler**

In `packages/client/src/App.tsx`, change the membership effect's `onJoined`:

```ts
    const onJoined = () => {
      setAtTable(true);
      socket.emit('request_game_state');
    };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=packages/client -- App.test`
Expected: PASS — both the existing switch test and the new request test pass.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/App.test.tsx
git commit -m "fix(client): request game state on entering the table (no blank screen)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Client — Create-a-Game / Cancel-Game lobby UI

**Files:**
- Modify: `packages/client/src/lobby/TableSettings.tsx`
- Modify: `packages/client/src/lobby/LobbyScreen.tsx`
- Modify: `packages/client/src/lobby/TableSettings.test.tsx`

**Interfaces:**
- Consumes: `LobbyState.hostId` (Task 1); `create_game`/`cancel_game` events (Task 1).
- Produces: `TableSettings` props `hostExists: boolean`, `onCreateGame: () => void`, `onCancelGame: () => void`. `LobbyScreen` derives `isHost` from `hostId`, holds a local draft config when there is no host, and routes config edits to local state (no host) or `update_config` (host).

- [ ] **Step 1: Write the failing TableSettings tests**

Update `packages/client/src/lobby/TableSettings.test.tsx`. Change the `props` factory to include the new props, and add three tests:

```ts
function props(overrides: Partial<React.ComponentProps<typeof TableSettings>> = {}) {
  return {
    config,
    canEditConfig: true,
    isHost: true,
    hostExists: true,
    status: 'waiting' as const,
    readyCount: 0,
    playerCount: 3,
    secondsLeft: 0,
    meIsReady: false,
    canStart: true,
    insufficientChips: false,
    onUpdateConfig: vi.fn(),
    onCreateGame: vi.fn(),
    onCancelGame: vi.fn(),
    onReadyToggle: vi.fn(),
    onStartCountdown: vi.fn(),
    onCancelCountdown: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
}
```

Add to the `describe('TableSettings', ...)` block:

```ts
  it('shows Create a Game when no host exists and fires onCreateGame', () => {
    const p = props({ hostExists: false });
    render(<TableSettings {...p} />);
    const btn = screen.getByRole('button', { name: /create a game/i });
    expect(btn).not.toBeDisabled();
    btn.click();
    expect(p.onCreateGame).toHaveBeenCalledOnce();
  });

  it('disables Create a Game when the creator is underfunded', () => {
    const p = props({ hostExists: false, insufficientChips: true });
    render(<TableSettings {...p} />);
    expect(screen.getByRole('button', { name: /create a game/i })).toBeDisabled();
  });

  it('lets the host cancel the game they created', () => {
    const p = props({ hostExists: true, isHost: true });
    render(<TableSettings {...p} />);
    screen.getByRole('button', { name: /cancel game/i }).click();
    expect(p.onCancelGame).toHaveBeenCalledOnce();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/client -- TableSettings`
Expected: FAIL — no "Create a Game" / "Cancel Game" buttons exist yet.

- [ ] **Step 3: Implement the new TableSettings modes**

In `packages/client/src/lobby/TableSettings.tsx`:

(a) Extend the props interface:

```ts
export interface TableSettingsProps {
  config: TableConfig;
  canEditConfig: boolean;
  isHost: boolean;
  hostExists: boolean;
  status: LobbyStatus;
  readyCount: number;
  playerCount: number;
  secondsLeft: number;
  meIsReady: boolean;
  canStart: boolean;
  insufficientChips: boolean;
  onUpdateConfig: (patch: Partial<TableConfig>) => void;
  onCreateGame: () => void;
  onCancelGame: () => void;
  onReadyToggle: () => void;
  onStartCountdown: () => void;
  onCancelCountdown: () => void;
  onLeave: () => void;
}
```

(b) Destructure the new props at the top of the component (add `hostExists`, `onCreateGame`, `onCancelGame` to the existing destructure list).

(c) Update the host blurb line to cover the no-host case:

```tsx
        <p className="mb-[22px] mt-1 text-sm font-bold text-sage-muted">
          {!hostExists
            ? 'Set up the table, then create a game for everyone to join.'
            : isHost
              ? "You're the host — tweak the table, then deal everyone in."
              : 'Only the host can change these. Sit tight!'}
        </p>
```

(d) Replace the entire ACTION block (the `{cdRunning ? (...) : isHost ? (...) : (...)}` conditional, around line 205-252) with:

```tsx
        {/* ACTION */}
        {cdRunning ? (
          <div className="flex items-center gap-4">
            <div className="flex flex-1 items-center gap-4 rounded-2xl border-[2.5px] border-mint-border bg-felt-800 px-[22px] py-3.5">
              <span className="min-w-[54px] text-center font-display text-[44px] font-bold leading-none text-mint">
                {secondsLeft}
              </span>
              <div className="flex flex-col leading-tight">
                <span className="font-display text-lg font-semibold text-white">Game starting…</span>
                <span className="text-[13px] font-bold text-sage-muted">
                  Take your seat — cards are coming out.
                </span>
              </div>
            </div>
            {meIsReady && (
              <button
                onClick={onCancelCountdown}
                className="rounded-2xl border-[2.5px] border-red-border bg-red px-6 py-[15px] font-display text-base font-semibold text-white shadow-hard-red active:translate-y-[3px]"
              >
                Cancel
              </button>
            )}
          </div>
        ) : !hostExists ? (
          <button
            onClick={onCreateGame}
            disabled={insufficientChips}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border-[3px] border-gold-border bg-gold p-[18px] font-display text-[21px] font-semibold text-[#2a1c00] shadow-hard-gold-lg transition-transform hover:-translate-y-px active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ♠ CREATE A GAME
          </button>
        ) : isHost ? (
          <div className="flex items-center gap-3.5">
            <button
              onClick={onStartCountdown}
              disabled={!canStart}
              className="flex flex-1 items-center justify-center gap-3 rounded-2xl border-[3px] border-gold-border bg-gold p-[18px] font-display text-[21px] font-semibold text-[#2a1c00] shadow-hard-gold-lg transition-transform hover:-translate-y-px active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ♠ START GAME
            </button>
            <button
              onClick={onCancelGame}
              className="rounded-2xl border-[2.5px] border-red-border bg-red px-6 py-[18px] font-display text-base font-semibold text-white shadow-hard-red active:translate-y-[3px]"
            >
              Cancel Game
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3.5">
            <button
              onClick={onReadyToggle}
              disabled={insufficientChips}
              className="flex flex-1 items-center gap-3 rounded-2xl border-[2.5px] border-dashed border-gold/40 bg-gold/10 px-[22px] py-4 font-display text-[17px] font-semibold text-gold-soft disabled:opacity-50"
            >
              <span className="h-2.5 w-2.5 rounded-pill bg-gold" />
              {meIsReady ? 'Ready — waiting for host…' : 'Tap to ready up'}
            </button>
            <button
              onClick={onLeave}
              className="rounded-2xl border-[2.5px] border-red-border bg-red px-6 py-4 font-display text-base font-semibold text-white shadow-hard-red active:translate-y-[3px]"
            >
              Leave
            </button>
          </div>
        )}
```

- [ ] **Step 4: Run the TableSettings tests**

Run: `npm run test --workspace=packages/client -- TableSettings`
Expected: PASS — Create/Cancel tests green; existing stepper + START + read-only tests still pass.

- [ ] **Step 5: Wire LobbyScreen to the host model**

In `packages/client/src/lobby/LobbyScreen.tsx`:

(a) Add imports/state. Add `DEFAULT_TABLE_CONFIG` to the `@poker/shared` import and a local draft config state:

```ts
import type { DiscordIdentity, LobbyState, TableConfig } from '@poker/shared';
import { DEFAULT_TABLE_CONFIG } from '@poker/shared';
```

Inside the component, after the existing `useState` calls:

```ts
  const [draftConfig, setDraftConfig] = useState<TableConfig>(DEFAULT_TABLE_CONFIG);
```

(b) Replace the host/derived-flags block (the `isHost`/`canEditConfig`/`canStart` lines, ~line 56-65) with:

```ts
  const hostExists = lobby.hostId !== null;
  const isHost = lobby.hostId === identity.discordUserId;
  const readyCount = lobby.players.filter((p) => p.isReady).length;
  const otherReadyCount = lobby.players.filter(
    (p) => p.isReady && p.discordUserId !== identity.discordUserId,
  ).length;
  // No host yet → everyone may edit their own local draft. Host set → host edits live.
  const canEditConfig = hostExists ? isHost && lobby.status === 'waiting' : true;
  const activeConfig = hostExists ? lobby.config : draftConfig;
  const insufficientChips = identity.chipBalance < activeConfig.buyIn;
  const canStart = lobby.status === 'waiting' && !insufficientChips && otherReadyCount >= 1;
```

(c) Replace the `updateConfig` handler (~line 79) so edits route to local draft (no host) or the server (host):

```ts
  const updateConfig = (patch: Partial<TableConfig>) => {
    if (hostExists) socket.emit('update_config', patch);
    else setDraftConfig((c) => ({ ...c, ...patch }));
  };
```

(d) In the `TableSettings` JSX (the `tab === 'home'` non-active-game branch, ~line 102-118), pass the new props and use `activeConfig`:

```tsx
              <TableSettings
                config={activeConfig}
                canEditConfig={canEditConfig}
                isHost={isHost}
                hostExists={hostExists}
                status={lobby.status}
                readyCount={readyCount}
                playerCount={lobby.players.length}
                secondsLeft={secondsLeft}
                meIsReady={me?.isReady ?? false}
                canStart={canStart}
                insufficientChips={insufficientChips}
                onUpdateConfig={updateConfig}
                onCreateGame={() => socket.emit('create_game', draftConfig)}
                onCancelGame={() => socket.emit('cancel_game')}
                onReadyToggle={() => socket.emit(me?.isReady ? 'player_unready' : 'player_ready')}
                onStartCountdown={startCountdown}
                onCancelCountdown={() => socket.emit('cancel_countdown')}
                onLeave={() => socket.emit('leave_table')}
              />
```

- [ ] **Step 6: Run the full client suite + typecheck**

Run: `npm run test --workspace=packages/client`
Expected: PASS.

Run: `npm run build --workspace=packages/client`
Expected: exits 0 (TableSettings/LobbyScreen typecheck clean).

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/lobby/TableSettings.tsx packages/client/src/lobby/LobbyScreen.tsx packages/client/src/lobby/TableSettings.test.tsx
git commit -m "feat(client): Create-a-Game / Cancel-Game lobby UI driven by hostId

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Client — richer lobby status labels

**Files:**
- Modify: `packages/client/src/lobby/PlayerRow.tsx`
- Modify: `packages/client/src/lobby/PlayersPanel.tsx`
- Modify: `packages/client/src/lobby/PlayerProfileModal.tsx`
- Modify: `packages/client/src/lobby/LobbyScreen.tsx` (pass `activeGame` / per-player role)
- Modify: `packages/client/src/lobby/PlayerRow.test.tsx`
- Modify: `packages/client/src/lobby/PlayerProfileModal.test.tsx`

**Interfaces:**
- Consumes: `ActiveGameSummary.members` (each `{ discordUserId, role }`) and `TableRole` from `@poker/shared`.
- Produces: `playerStatus(player: LobbyPlayer, tableRole: TableRole | null): PlayerStatusLabel` where `PlayerStatusLabel = 'Ready' | 'In Lobby' | 'In-Game · At Table' | 'In-Game · Spectating'`.

- [ ] **Step 1: Write the failing PlayerRow tests**

Replace the `describe('playerStatus', ...)` block in `packages/client/src/lobby/PlayerRow.test.tsx` with:

```ts
describe('playerStatus', () => {
  it('maps no table role + not ready to In Lobby', () => {
    expect(playerStatus(base, null)).toBe('In Lobby');
  });
  it('maps no table role + ready to Ready', () => {
    expect(playerStatus({ ...base, isReady: true }, null)).toBe('Ready');
  });
  it('maps a seated table member to In-Game · At Table', () => {
    expect(playerStatus(base, 'seated')).toBe('In-Game · At Table');
  });
  it('maps a spectator table member to In-Game · Spectating', () => {
    expect(playerStatus(base, 'spectator')).toBe('In-Game · Spectating');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test --workspace=packages/client -- PlayerRow`
Expected: FAIL — `playerStatus` still takes `lobbyStatus` and lacks the new labels.

- [ ] **Step 3: Update `PlayerRow.tsx`**

Replace the top of `packages/client/src/lobby/PlayerRow.tsx` (the type, `playerStatus`, and `STATUS_STYLE`) with:

```ts
import type { LobbyPlayer, TableRole } from '@poker/shared';

export type PlayerStatusLabel =
  | 'Ready'
  | 'In Lobby'
  | 'In-Game · At Table'
  | 'In-Game · Spectating';

export function playerStatus(player: LobbyPlayer, tableRole: TableRole | null): PlayerStatusLabel {
  if (tableRole === 'seated') return 'In-Game · At Table';
  if (tableRole === 'spectator') return 'In-Game · Spectating';
  return player.isReady ? 'Ready' : 'In Lobby';
}

export const STATUS_STYLE: Record<PlayerStatusLabel, { dot: string; text: string; bg: string }> = {
  Ready: { dot: 'bg-mint', text: 'text-mint-bright', bg: 'bg-mint/15' },
  'In Lobby': { dot: 'bg-[#ffcb52]', text: 'text-gold-soft', bg: 'bg-gold/15' },
  'In-Game · At Table': { dot: 'bg-blue', text: 'text-[#9ad4ff]', bg: 'bg-blue/15' },
  'In-Game · Spectating': { dot: 'bg-[#b9a3ff]', text: 'text-[#c9b8ff]', bg: 'bg-[#b9a3ff]/15' },
};
```

The `LobbyStatus` import is no longer needed in this file — remove it from the import line (now `import type { LobbyPlayer, TableRole } from '@poker/shared';`).

- [ ] **Step 4: Run the PlayerRow tests**

Run: `npm run test --workspace=packages/client -- PlayerRow`
Expected: PASS.

- [ ] **Step 5: Update `PlayersPanel.tsx` to resolve per-player role**

Replace `packages/client/src/lobby/PlayersPanel.tsx` with:

```tsx
import type { ActiveGameSummary, LobbyPlayer, TableRole } from '@poker/shared';
import { PlayerRow, playerStatus } from './PlayerRow';

export interface PlayersPanelProps {
  players: LobbyPlayer[];
  activeGame: ActiveGameSummary | null;
  maxPlayers: number;
  onSelectPlayer: (id: string) => void;
}

function roleOf(activeGame: ActiveGameSummary | null, playerId: string): TableRole | null {
  return activeGame?.members.find((m) => m.discordUserId === playerId)?.role ?? null;
}

export function PlayersPanel({ players, activeGame, maxPlayers, onSelectPlayer }: PlayersPanelProps) {
  return (
    <aside className="flex min-w-[212px] flex-[0_1_270px] flex-col overflow-hidden rounded-3xl border-[2.5px] border-black/30 bg-felt-900/55 shadow-panel">
      <div className="flex items-center justify-between px-5 pb-3.5 pt-[18px]">
        <span className="font-display text-lg font-semibold text-white">Players</span>
        <span className="rounded-pill border-2 border-gold-border bg-gold px-2.5 py-[3px] font-display text-[13px] font-semibold text-[#2a1c00]">
          {players.length} / {maxPlayers}
        </span>
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden px-3 pb-3.5">
        {players.map((p) => (
          <PlayerRow
            key={p.discordUserId}
            player={p}
            status={playerStatus(p, roleOf(activeGame, p.discordUserId))}
            onSelect={() => onSelectPlayer(p.discordUserId)}
          />
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Update `PlayerProfileModal.tsx` to take a `tableRole`**

In `packages/client/src/lobby/PlayerProfileModal.tsx`:

```ts
import type { LobbyPlayer, TableRole } from '@poker/shared';
import { StatTile } from './StatTile';
import { useStats } from './useStats';
import { playerStatus, STATUS_STYLE } from './PlayerRow';

export interface PlayerProfileModalProps {
  player: LobbyPlayer;
  tableRole: TableRole | null;
  onClose: () => void;
}
```

And change the function signature + status line:

```ts
export function PlayerProfileModal({ player, tableRole, onClose }: PlayerProfileModalProps) {
  const { stats } = useStats(player.discordUserId);
  const status = playerStatus(player, tableRole);
  const s = STATUS_STYLE[status];
```

- [ ] **Step 7: Update `LobbyScreen.tsx` to pass roles down**

In `packages/client/src/lobby/LobbyScreen.tsx`:

(a) Add a role helper near the other derived values:

```ts
  const roleOf = (playerId: string) =>
    lobby.activeGame?.members.find((m) => m.discordUserId === playerId)?.role ?? null;
```

(b) Change the `PlayersPanel` usage (it currently passes `lobbyStatus={lobby.status}`):

```tsx
        <PlayersPanel
          players={lobby.players}
          activeGame={lobby.activeGame ?? null}
          maxPlayers={lobby.config.maxPlayers}
          onSelectPlayer={setSelectedPlayerId}
        />
```

(c) Change the `PlayerProfileModal` usage (it currently passes `lobbyStatus={lobby.status}`):

```tsx
      {selectedPlayer && (
        <PlayerProfileModal
          player={selectedPlayer}
          tableRole={roleOf(selectedPlayer.discordUserId)}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
```

- [ ] **Step 8: Update `PlayerProfileModal.test.tsx`**

In `packages/client/src/lobby/PlayerProfileModal.test.tsx`, replace every `lobbyStatus="waiting"` prop with `tableRole={null}` (4 occurrences).

- [ ] **Step 9: Run the full client suite + typecheck**

Run: `npm run test --workspace=packages/client`
Expected: PASS.

Run: `npm run build --workspace=packages/client`
Expected: exits 0 (no remaining `lobbyStatus` references; `PlayersPanel`/`PlayerProfileModal` typecheck clean).

- [ ] **Step 10: Commit**

```bash
git add packages/client/src/lobby/PlayerRow.tsx packages/client/src/lobby/PlayersPanel.tsx packages/client/src/lobby/PlayerProfileModal.tsx packages/client/src/lobby/LobbyScreen.tsx packages/client/src/lobby/PlayerRow.test.tsx packages/client/src/lobby/PlayerProfileModal.test.tsx
git commit -m "feat(client): In-Game At Table / Spectating lobby status labels

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Full verification + documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/To-do.md`
- Modify: `CLAUDE.md`

**Interfaces:** none (docs + final gate).

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: PASS — server suite (engine + lobby + lobby-room + game + stats) **and** client suite (RTL) all green.

- [ ] **Step 2: Run the full build**

Run: `npm run build`
Expected: exits 0 for all three packages (shared, server, client).

- [ ] **Step 3: Update `docs/To-do.md`**

In `docs/To-do.md`, under `## Known Bugs`, remove (or check off) the five now-fixed entries: the blank-screen bug, the departed-player-still-shown bug, the no-rejoin-UI bug, the stale lobby-status/chips bug, and the broken-host-tracking bug. Under `## To do and Ideas`, mark `Host/Player` and `Player Status - ...` as done (append ` ✅`).

- [ ] **Step 4: Update `docs/ARCHITECTURE.md`**

In the Table membership / lobby section of `docs/ARCHITECTURE.md`, add a paragraph describing the new host model and rendering fixes:

```markdown
### Lobby host model (Create a Game)

There is no implicit host. `LobbyRoom` tracks a nullable, transferable `hostId`
surfaced in `LobbyState`. When `hostId` is null and no game is active, every
lobby player edits a **local** draft of the table config and can click **Create a
Game** (`create_game`), which sets them as host. The host can keep editing the
config (`update_config`, host-only while forming), **Cancel Game** (`cancel_game`)
to disband back to the open state, or **Start** the countdown (host-only). If the
host leaves while forming or in countdown, `removeBySocket` transfers `hostId` to
the next player (or null). When the active game ends, `resetAfterGame` clears the
host + ready flags and reopens the lobby.

Table members are **no longer filtered out** of `LobbyState.players`; the client
tags each player by their `activeGame.members` role: `In-Game · At Table`
(seated) or `In-Game · Spectating` (spectator), falling back to `Ready` /
`In Lobby`. Live bankroll changes flow from `GameRoom.onChipBalanceChange`
(fired on every buy-in/sit-in/cash-out) into `LobbyRoom.updateChipBalance`, so the
lobby chip column stays current without a reload.

### Rendering an idle table

`GameRoom.currentView(viewerId)` returns the live engine view only while a hand is
in progress with ≥2 seated; otherwise it builds a board-free **waiting view** from
the *current* seated members. This is what removes a player who left/spectated
from the table (they no longer appear in `state.players`, only under
`spectators`). A freshly-mounted or reconnecting client pulls the current view via
the `request_game_state` event (handled by `GameRoom.sendStateTo`).
```

- [ ] **Step 5: Update `CLAUDE.md`**

In `CLAUDE.md`, update the **Table membership** bullet to note: host model is now explicit (`hostId` in `LobbyState`, `create_game`/`cancel_game`/`request_game_state` events; `update_config` is host-only while forming); table members are no longer filtered out of the lobby list (tagged by role); idle tables render a waiting view from seated members; live bankroll pushed via `onChipBalanceChange` → `updateChipBalance`. Update the client lobby routing note to mention `request_game_state` on table entry.

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md docs/To-do.md CLAUDE.md
git commit -m "docs: host model + waiting-view + live chip balances

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Bug 1 → Task 3 (waiting view via null-safe broadcast) + Task 5 (request on join). Bugs 2 & 3 → Task 3 (waiting view renders only real seated members; spectator controls then surface). Bug 4 → Task 4 (live chip balances) + Task 7 (per-player status labels; stop filtering members) + Task 2 (`resetAfterGame`, `addPlayer` preserves balance). Bug 5 / host refactor → Task 1 (`hostId` + events) + Task 2 (create/cancel/transfer/reset, host-only start) + Task 6 (Create/Cancel UI). Decisions: own local draft (Task 6 `draftConfig`), auto-transfer (Task 2 `removeBySocket`), inline status (Task 7), Cancel Game (Tasks 2 + 6). Post-creation host editing retained (Task 2 `updateConfig`, Task 6 routing). Tests updated across Tasks 2-7; docs in Task 8.
- **Type consistency:** `hostId` (Task 1) consumed in Tasks 2/6/7. `createGame`/`cancelGame`/`resetAfterGame`/`updateChipBalance` (Task 2) consumed in Tasks 2/4. `onChipBalanceChange`/`sendStateTo`/`currentView` (Tasks 3/4) consistent. `playerStatus(player, tableRole)` signature consistent across PlayerRow/PlayersPanel/PlayerProfileModal (Task 7). `TableSettings` props (`hostExists`, `onCreateGame`, `onCancelGame`) consistent between Task 6 implementation and tests.
- **No placeholders:** every code/test step contains full code; run commands have explicit expected outcomes.
