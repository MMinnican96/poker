# Spectate, Join & Leave the Table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players join an in-progress game from the lobby as spectators, take a seat at hand boundaries, move between playing/spectating, and leave back to the lobby — while the game continues for everyone else.

**Architecture:** `GameRoom` is generalized to own the whole table population as role-tagged `Member`s (seated + spectator). Seat/leave/spectate changes are queued and resolved at hand boundaries; spectator join/leave are immediate. The engine and `viewFor` stay pure/unchanged; `GameRoom` augments each per-viewer view and exposes a cards-free `ActiveGameSummary` that the lobby folds into `LobbyState`. Explicit `joined_table`/`left_table` events drive the client's lobby↔table switch.

**Tech Stack:** TypeScript (NodeNext ESM), Socket.io, React + Phaser, Vitest + React Testing Library. npm-workspaces monorepo.

## Global Constraints

- `@poker/shared` is ESM (NodeNext), built to `dist/`. After editing `packages/shared`, run `npm run build -w @poker/shared` so the server/client see new types. Import from `@poker/shared` with `.js` specifiers where the file uses them.
- Server is authoritative. The deck never leaves `HandContext`; opponents' hole cards stay nulled via `viewFor` until showdown. Never trust client-claimed identity — resolve from `socket.data`.
- Engine (`packages/server/src/engine/`) stays pure (no I/O). Do not add table-population fields to the engine; `GameRoom` augments views.
- New `GameState` fields must be **optional** so the engine's `startHand` literal still compiles unchanged.
- Chip moves go through the injected `ChipService.adjust` with a **unique idempotency key**. Buy-in/cash-out keys must include the per-seat `seatSession` so leave→rejoin in the same game re-deducts.
- Tests live next to source as `*.test.ts` / `*.test.tsx` (excluded from `tsc` build). Verify with `npm test` and `npm run build` before claiming done.
- Tailwind v4 CSS-first: never hardcode hex in lobby component files — use named tokens from `index.css` (`docs/DESIGN_STANDARDS.md`). The throwaway table UI (`GameCanvas`/`ActionBar`) uses inline styles like the existing code — keep that pattern there.

---

## File structure

- `packages/shared/src/types.ts` — `TableRole`, `TableMember`, `ActiveGameSummary`; optional `GameState` fields; `LobbyState.activeGame`.
- `packages/shared/src/events.ts` — new client→server and server→client events.
- `packages/server/src/rooms/game.ts` — `Member` model, transitions, hand-boundary resolver, teardown, augmented views, `summary()`, `onMembershipChange`.
- `packages/server/src/rooms/lobby.ts` — `activeGame` provider + player filtering + public `broadcastState`.
- `packages/server/src/rooms/index.ts` — socket handlers for the new events; wire provider + membership re-broadcast.
- `packages/client/src/App.tsx` — route on `joined_table`/`left_table`.
- `packages/client/src/lobby/LobbyScreen.tsx` + new `ActiveGameCard.tsx` — join-active-game view.
- `packages/client/src/GameCanvas.tsx` + new `SpectatorControls.tsx` — spectator banner, seated controls, eye-icon list, waiting overlay.
- Tests alongside each; docs at the end.

---

## Task 1: Shared types & events

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/events.ts`

**Interfaces:**
- Produces: `TableRole = 'seated' | 'spectator'`; `TableMember`; `ActiveGameSummary`; optional `GameState.spectators`, `GameState.waitingForPlayers`, `GameState.viewerPending`; `LobbyState.activeGame`. New events `join_table`, `sit_in`, `sit_out`, `cancel_pending` (C→S, no payload); `joined_table({gameId,role})`, `left_table()` (S→C).

- [ ] **Step 1: Add the new types** in `packages/shared/src/types.ts`. Append after the existing `PlayerStatsSummary` block (and add `activeGame` to `LobbyState`, the optional fields to `GameState`):

```ts
export type TableRole = 'seated' | 'spectator';

/** A person at the table — cards-free, safe to show anyone (incl. lobby). */
export interface TableMember {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  role: TableRole;
  chipStack: number;        // 0 for spectators
  seatIndex: number | null; // engine seat order when seated, null when watching
}

/** Read-only snapshot of the active game, folded into LobbyState for lobby players. */
export interface ActiveGameSummary {
  gameId: string;
  handNumber: number;
  buyIn: number;
  maxPlayers: number;
  playingCount: number;
  spectatingCount: number;
  members: TableMember[];
  waitingForPlayers: boolean;
}
```

Add to `LobbyState` (optional so `toState()` compiles before Task 8 wires it):
```ts
  /** Present when a game is running on this instance; null/absent otherwise. */
  activeGame?: ActiveGameSummary | null;
```

Add to `GameState` (optional so the engine literal still compiles):
```ts
  /** People watching (no cards, not dealt). GameRoom-populated, not the engine. */
  spectators?: { discordUserId: string; displayName: string; avatarUrl: string }[];
  /** True when the table idles with <2 seated players (no hand dealt). */
  waitingForPlayers?: boolean;
  /** This viewer's queued hand-boundary transition, stamped per recipient. */
  viewerPending?: 'leave' | 'spectate' | 'seat' | null;
```

- [ ] **Step 2: Add the events** in `packages/shared/src/events.ts`. Add to `ServerToClientEvents`:

```ts
  joined_table: (data: { gameId: string; role: TableRole }) => void;
  left_table: () => void;
```

Add to `ClientToServerEvents`:
```ts
  join_table: () => void;
  sit_in: () => void;
  sit_out: () => void;
  cancel_pending: () => void;
```

Update the import at the top of `events.ts` to include `TableRole`:
```ts
import type {
  LobbyState,
  GameState,
  PlayerAction,
  TableConfig,
  DiscordIdentity,
  TableRole,
} from './types.js';
```

- [ ] **Step 3: Build shared and verify it compiles.**

Run: `npm run build -w @poker/shared`
Expected: builds with no errors; `packages/shared/dist/types.d.ts` now contains `ActiveGameSummary`.

- [ ] **Step 4: Commit.**

```bash
git add packages/shared/src/types.ts packages/shared/src/events.ts packages/shared/dist
git commit -m "feat(shared): table membership types + spectate/join/leave events"
```

---

## Task 2: GameRoom internal refactor — `Seat[]` → `Member[]` with `seatSession` keys

This is an internal refactor: observable behavior is unchanged **except** buy-in/cash-out idempotency keys now carry `seatSession`. The existing `game.test.ts` key assertion is updated to match.

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Test: `packages/server/src/rooms/game.test.ts` (update existing key assertion)

**Interfaces:**
- Consumes: engine `startHand`/`act`/`settleHand`, `viewFor`.
- Produces: private `Member` shape `{ discordUserId, displayName, avatarUrl, socketId, role: 'seated'|'spectator', chipStack, bankroll, seatSession, pending: null|'leave'|'spectate'|'seat', disconnected, disconnectedAt?, joinedAt, playMs? }`; helpers `seated()`, `seatedAndLive()`; buy-in key `${gameId}:buyin:${id}:${seatSession}`, cash-out key `${gameId}:cashout:${id}:${seatSession}`. `GameRoomPlayer` gains `bankroll: number`.

- [ ] **Step 1: Update the existing buy-in key test to expect `seatSession`.** In `game.test.ts`, the first test (`charges buy-ins…`) currently asserts keys `G:buyin:a` / `G:buyin:b`. Change to:

```ts
    expect(new Set(buyIns.map((c) => c.idempotencyKey))).toEqual(
      new Set(['G:buyin:a:1', 'G:buyin:b:1']),
    );
```

Also update the `players` fixture and `GameRoomPlayer` usage to include `bankroll` (add `bankroll: 3000` to each entry in the `players` array near the top of the file).

- [ ] **Step 2: Run the test to verify it fails** (keys don't match yet).

Run: `npm test -w @poker/server -- game.test.ts -t "charges buy-ins"`
Expected: FAIL — received `G:buyin:a`, expected `G:buyin:a:1`.

- [ ] **Step 3: Refactor `game.ts` to the `Member` model.** Replace the `Seat` interface and `seats` field. Concretely:

Replace the `interface Seat { … }` block with:
```ts
type MemberRole = 'seated' | 'spectator';
type Pending = null | 'leave' | 'spectate' | 'seat';

interface Member {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  socketId: string;
  role: MemberRole;
  chipStack: number;     // 0 for spectators
  bankroll: number;      // last-known lobby balance, gates sit-in
  seatSession: number;   // ++ each time they take a seat
  pending: Pending;
  left: boolean;
  disconnected: boolean;
  disconnectedAt?: number;
  joinedAt: number;
  playMs?: number;
}
```

Add `bankroll: number` to `GameRoomPlayer`. Rename `private seats: Seat[]` to `private members: Member[]`. In the constructor build seated members:
```ts
    this.members = opts.players.map((p) => ({
      ...p,
      role: 'seated' as const,
      chipStack: 0,
      seatSession: 0,
      pending: null,
      left: false,
      disconnected: false,
      joinedAt: now,
    }));
```

Add helpers near the bottom of the class:
```ts
  private seated(): Member[] {
    return this.members.filter((m) => m.role === 'seated' && !m.left);
  }
  /** Seated members who can be dealt in (have chips and aren't disconnected). */
  private seatedLive(): Member[] {
    return this.seated().filter((m) => !m.disconnected && m.chipStack > 0);
  }
```

In `start()`, charge buy-ins with the session key (bump `seatSession` to 1 first):
```ts
    await Promise.all(
      this.seated().map(async (m) => {
        m.seatSession += 1;
        await this.chips.adjust({
          playerId: m.discordUserId,
          amount: -this.config.buyIn,
          type: 'buy-in',
          idempotencyKey: `${this.gameId}:buyin:${m.discordUserId}:${m.seatSession}`,
        });
        m.chipStack = this.config.buyIn;
      }),
    );
```

In `startHand()`, build seeds from `seated()` (stable order), `seatIndex = array index`:
```ts
    const seatedMembers = this.seated();
    const seeds: PlayerSeed[] = seatedMembers.map((m, i) => ({
      discordUserId: m.discordUserId,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      seatIndex: i,
      chipStack: m.chipStack,
    }));
```
Keep using `this.dealerIndex` as an index into this seeded array. Update `nextDealer()` to iterate over `this.seated()` instead of `this.seats`.

In `concludeHand()`, mirror chip stacks back by matching `this.members`. In `cashOut(member)`, use the session key:
```ts
      idempotencyKey: `${this.gameId}:cashout:${m.discordUserId}:${m.seatSession}`,
```

Replace every other `this.seats` reference (`broadcastState`, `handleDisconnect`, `reconnect`, `leave`, `endGame`, `beginTurn`) with `this.members` (keeping current semantics for now — the new transition logic lands in later tasks). For `startHand`'s live check and `scheduleNextHand`, use `this.seatedLive()` in place of the old `live` filter for the moment (Task 7 changes the threshold).

- [ ] **Step 4: Run the full server suite to verify behavior is preserved.**

Run: `npm test -w @poker/server`
Expected: PASS (all existing game/lobby/engine tests green, including the updated key assertion).

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/game.test.ts
git commit -m "refactor(server): GameRoom Seat->Member model with seatSession-scoped ledger keys"
```

---

## Task 3: Per-viewer augmented view + spectator join

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Test: `packages/server/src/rooms/game.test.ts`

**Interfaces:**
- Consumes: `viewFor`, `Member` model.
- Produces: `GameRoom.addSpectator(p: GameRoomPlayer): void`; private `tableView(viewerId): GameState` (augments with `spectators`, `waitingForPlayers`, `viewerPending`); `spectatorMembers()`; emits `joined_table` to the joiner. Broadcast now iterates **all** non-left members.

- [ ] **Step 1: Write the failing test.** Add to `game.test.ts`:

```ts
  it('adds a spectator who sees no opponent hole cards and is not dealt in', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    // The spectator is told to switch to the table.
    const joined = io.records.find((r) => r.target === 'sc' && r.event === 'joined_table');
    expect(joined?.args[0]).toEqual({ gameId: 'G', role: 'spectator' });

    // The spectator's view: 2 seated players, all hole cards hidden, listed as a spectator.
    const toSpectator = io.records.filter((r) => r.target === 'sc' && r.event === 'game_state_update');
    const view = toSpectator.at(-1)!.args[0] as GameState;
    expect(view.players).toHaveLength(2);
    expect(view.players.every((p) => p.holeCards === null)).toBe(true);
    expect(view.spectators).toEqual([{ discordUserId: 'c', displayName: 'C', avatarUrl: '' }]);
    room.stop();
  });
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npm test -w @poker/server -- game.test.ts -t "adds a spectator"`
Expected: FAIL — `room.addSpectator` is not a function.

- [ ] **Step 3: Implement.** In `game.ts` add:

```ts
  /** A lobby player chose to watch. Immediate; emits joined_table + state. */
  addSpectator(p: GameRoomPlayer): void {
    if (this.stopped) return;
    const existing = this.members.find((m) => m.discordUserId === p.discordUserId);
    if (existing && !existing.left) {
      existing.socketId = p.socketId; // reconnect/rebind
    } else {
      this.members.push({
        ...p,
        role: 'spectator',
        chipStack: 0,
        seatSession: existing?.seatSession ?? 0,
        pending: null,
        left: false,
        disconnected: false,
        joinedAt: Date.now(),
      });
    }
    this.io.to(p.socketId).emit('joined_table', { gameId: this.gameId, role: 'spectator' });
    this.broadcastState();
    this.onMembershipChange?.();
  }

  private spectatorMembers(): Member[] {
    return this.members.filter((m) => m.role === 'spectator' && !m.left);
  }

  /** The viewer's per-recipient view: sanitized cards + table-population fields. */
  private tableView(viewerId: string): GameState {
    const base = this.ctx ? viewFor(this.ctx.state, viewerId) : this.idleState();
    const me = this.members.find((m) => m.discordUserId === viewerId);
    return {
      ...base,
      spectators: this.spectatorMembers().map((m) => ({
        discordUserId: m.discordUserId,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
      })),
      waitingForPlayers: this.seated().length < 2,
      viewerPending: me?.pending ?? null,
    };
  }
```

Add `onMembershipChange?: () => void;` as a public mutable field (set by `rooms/index`), declared near `onEnd`. Add a private `idleState()` that returns the last known `ctx.state` or a minimal waiting state — for now (a hand always exists once started) implement:
```ts
  private idleState(): GameState {
    // ctx is set after the first hand; before that there is nothing to show.
    return this.ctx!.state;
  }
```

Rewrite `broadcastState()` to iterate every non-left member and send the augmented view:
```ts
  private broadcastState(): void {
    if (!this.ctx) return;
    for (const m of this.members) {
      if (m.left) continue;
      this.io.to(m.socketId).emit('game_state_update', this.tableView(m.discordUserId));
    }
  }
```

- [ ] **Step 4: Run it to verify it passes.**

Run: `npm test -w @poker/server -- game.test.ts -t "adds a spectator"`
Expected: PASS. Then `npm test -w @poker/server` — all green.

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/game.test.ts
git commit -m "feat(server): spectator join + per-viewer augmented table view"
```

---

## Task 4: Sit-in (take a seat) with hand-boundary resolution + gating

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Test: `packages/server/src/rooms/game.test.ts`

**Interfaces:**
- Consumes: `Member` model, `seated()`, `seatedLive()`, `cashOut`.
- Produces: `GameRoom.requestSeat(playerId): void`; private `applyPending(): void` (resolves all `pending` + bust→spectator before a hand); private `canSeat(m): boolean`. `requestSeat` sets `pending='seat'` mid-hand, or seats immediately when no hand is running.

- [ ] **Step 1: Write the failing test.** Add to `game.test.ts`:

```ts
  it('seats a spectator at the next hand and charges a fresh buy-in', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    room.requestSeat('c'); // mid-hand: queued, not yet charged
    expect(chips.calls.some((c) => c.playerId === 'c' && c.type === 'buy-in')).toBe(false);

    // Finish the current hand; next hand applies the pending seat.
    room.handleAction('a', { type: 'fold' });
    // 'b' wins the blinds vs 'a' fold-out; next hand is scheduled via timer — drive it:
    (room as unknown as { startHand(): void }).startHand();

    const buyIn = chips.calls.find((c) => c.playerId === 'c' && c.type === 'buy-in');
    expect(buyIn?.idempotencyKey).toBe('G:buyin:c:1');
    expect(room.state!.players.some((p) => p.discordUserId === 'c')).toBe(true);
    room.stop();
  });

  it('rejects sit-in when the table is full or the player is underfunded', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service, {}, undefined);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 100 });
    room.requestSeat('c'); // underfunded (bankroll 100 < buyIn 3000)
    room.handleAction('a', { type: 'fold' });
    (room as unknown as { startHand(): void }).startHand();
    expect(room.state!.players.some((p) => p.discordUserId === 'c')).toBe(false);
    room.stop();
  });
```

- [ ] **Step 2: Run to verify failure.**

Run: `npm test -w @poker/server -- game.test.ts -t "seats a spectator"`
Expected: FAIL — `requestSeat` not a function.

- [ ] **Step 3: Implement.** In `game.ts`:

```ts
  /** Spectator asks for a seat. Applied at the next hand boundary (or now if idle). */
  requestSeat(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m || m.role === 'seated') return;
    if (!this.canSeat(m)) return; // gated: full or underfunded
    m.pending = 'seat';
    if (!this.handInProgress) this.resolveBetweenHands();
    else this.broadcastState();
    this.onMembershipChange?.();
  }

  private canSeat(m: Member): boolean {
    return this.seated().length < this.config.maxPlayers && m.bankroll >= this.config.buyIn;
  }

  /** Resolve queued transitions + busts. Called at each hand boundary. */
  private applyPending(): void {
    for (const m of this.members) {
      if (m.role === 'seated' && m.chipStack <= 0) {
        m.role = 'spectator'; // bust → spectate (Task 6 also covers settle-time)
      }
      if (m.pending === 'seat' && m.role === 'spectator' && this.canSeat(m)) {
        m.seatSession += 1;
        void this.chips.adjust({
          playerId: m.discordUserId,
          amount: -this.config.buyIn,
          type: 'buy-in',
          idempotencyKey: `${this.gameId}:buyin:${m.discordUserId}:${m.seatSession}`,
        });
        m.chipStack = this.config.buyIn;
        m.role = 'seated';
      } else if (m.pending === 'spectate' && m.role === 'seated') {
        void this.cashOut(m);
        m.role = 'spectator';
      } else if (m.pending === 'leave') {
        void this.cashOut(m);
        m.left = true;
        m.playMs = Date.now() - m.joinedAt;
        this.io.to(m.socketId).emit('left_table');
      }
      m.pending = null;
    }
  }
```

Make `cashOut` accept a `Member`. Call `this.applyPending()` at the **top** of `startHand()` (before building seeds). Add a `resolveBetweenHands()` stub used when idle that we flesh out in Task 7 — for now:
```ts
  private resolveBetweenHands(): void {
    this.applyPending();
    this.scheduleNextHand();
  }
```
(For Task 4's tests we drive `startHand()` directly, so `applyPending()` at its top is what matters.)

- [ ] **Step 4: Run to verify pass.**

Run: `npm test -w @poker/server -- game.test.ts -t "seats a spectator"` then `-t "rejects sit-in"`
Expected: PASS both. Then `npm test -w @poker/server` — all green.

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/game.test.ts
git commit -m "feat(server): spectator sit-in with hand-boundary resolution and gating"
```

---

## Task 5: Sit-out, leave, and cancel-pending

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Test: `packages/server/src/rooms/game.test.ts`

**Interfaces:**
- Consumes: `Member` model, `applyPending`, `cashOut`.
- Produces: `GameRoom.moveToSpectate(playerId)`, `GameRoom.cancelPending(playerId)`; reworked `GameRoom.leave(playerId)` (seated → deferred `pending='leave'`, immediate if no hand; spectator → immediate removal + `left_table`).

- [ ] **Step 1: Write the failing tests.** Add to `game.test.ts`:

```ts
  it('defers a seated leave to hand end, cashes out, and emits left_table', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    room.leave('a'); // mid-hand → queued, still seated
    expect(room.state!.players.some((p) => p.discordUserId === 'a')).toBe(true);
    expect(chips.calls.some((c) => c.playerId === 'a' && c.type === 'cash-out')).toBe(false);

    room.handleAction('a', { type: 'fold' });
    (room as unknown as { startHand(): void }).applyPending?.();
    // Drive resolution directly:
    (room as unknown as { applyPending(): void }).applyPending();
    expect(chips.calls.some((c) => c.playerId === 'a' && c.type === 'cash-out')).toBe(true);
    expect(io.records.some((r) => r.target === 'sa' && r.event === 'left_table')).toBe(true);
    room.stop();
  });

  it('cancels a pending leave so the player stays seated with chips intact', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.leave('a');
    room.cancelPending('a');
    (room as unknown as { applyPending(): void }).applyPending();
    expect(chips.calls.some((c) => c.playerId === 'a' && c.type === 'cash-out')).toBe(false);
    room.stop();
  });

  it('removes a spectator immediately on leave', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });
    room.leave('c');
    expect(io.records.some((r) => r.target === 'sc' && r.event === 'left_table')).toBe(true);
    const view = io.records.filter((r) => r.target === 'sa' && r.event === 'game_state_update').at(-1)!.args[0] as GameState;
    expect(view.spectators).toEqual([]);
    room.stop();
  });
```

(Remove the stray `applyPending?.()` line above if your reviewer prefers — only the direct `applyPending()` call matters; both are no-throw.)

- [ ] **Step 2: Run to verify failure.**

Run: `npm test -w @poker/server -- game.test.ts -t "defers a seated leave"`
Expected: FAIL — `room.cancelPending`/`moveToSpectate` not defined / leave semantics differ.

- [ ] **Step 3: Implement.** Replace `leave()` and add the two methods:

```ts
  /** Seated → cash out to lobby (deferred to hand end). Spectator → leave now. */
  leave(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m) return;
    if (m.role === 'spectator') {
      m.left = true;
      this.io.to(m.socketId).emit('left_table');
      this.broadcastState();
      this.onMembershipChange?.();
      return;
    }
    m.pending = 'leave';
    if (!this.handInProgress) this.resolveBetweenHands();
    else this.broadcastState();
    this.onMembershipChange?.();
  }

  /** Seated → cash out but keep watching (deferred to hand end). */
  moveToSpectate(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m || m.role !== 'seated') return;
    m.pending = 'spectate';
    if (!this.handInProgress) this.resolveBetweenHands();
    else this.broadcastState();
    this.onMembershipChange?.();
  }

  /** Undo a queued transition before the hand boundary applies it. */
  cancelPending(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m || m.pending === null) return;
    m.pending = null;
    this.broadcastState();
    this.onMembershipChange?.();
  }
```

- [ ] **Step 4: Run to verify pass.**

Run: `npm test -w @poker/server -- game.test.ts -t "leave"` then `npm test -w @poker/server`
Expected: PASS (all green).

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/game.test.ts
git commit -m "feat(server): sit-out, deferred/immediate leave, cancel-pending"
```

---

## Task 6: Bust → auto-spectate at settle

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Test: `packages/server/src/rooms/game.test.ts`

**Interfaces:**
- Consumes: `concludeHand`, `Member` model.
- Produces: at hand settle, any seated member whose `chipStack` reached 0 becomes a spectator (stays at the table). Reuses `applyPending`'s bust branch but also flags them right after `concludeHand` mirrors stacks, so their next broadcast shows them as a spectator.

- [ ] **Step 1: Write the failing test.** Add to `game.test.ts`:

```ts
  it('moves a busted player to spectate after the hand settles', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    // Heads-up all-in; loser busts to 0.
    const done = io.waitFor('hand_result');
    room.handleAction('a', { type: 'all-in' });
    room.handleAction('b', { type: 'all-in' });
    await done;

    const loser = room.state!.players.find((p) => p.chipStack === 0)!.discordUserId;
    // After settle the busted player is now a spectator in everyone's view.
    const someView = io.records.filter((r) => r.event === 'game_state_update').at(-1)!.args[0] as GameState;
    expect(someView.spectators?.some((s) => s.discordUserId === loser)).toBe(true);
    room.stop();
  });
```

- [ ] **Step 2: Run to verify failure.**

Run: `npm test -w @poker/server -- game.test.ts -t "busted player to spectate"`
Expected: FAIL — busted player not yet a spectator at settle.

- [ ] **Step 3: Implement.** In `concludeHand()`, after the loop that mirrors `seat.chipStack = p.chipStack`, add:

```ts
    // Bust → spectate: a seated member with no chips stops being dealt in.
    for (const m of this.members) {
      if (m.role === 'seated' && !m.left && m.chipStack <= 0) {
        m.role = 'spectator';
        m.pending = null;
      }
    }
```

Then the existing `this.broadcastState()` already reflects it.

- [ ] **Step 4: Run to verify pass.**

Run: `npm test -w @poker/server -- game.test.ts -t "busted player to spectate"` then `npm test -w @poker/server`
Expected: PASS (all green).

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/game.test.ts
git commit -m "feat(server): bust auto-moves player to spectate at settle"
```

---

## Task 7: Teardown — idle at 1 seated, end at 0

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Test: `packages/server/src/rooms/game.test.ts`

**Interfaces:**
- Consumes: `seated()`, `applyPending`, `endGame`.
- Produces: `scheduleNextHand`/`startHand` honor the new thresholds: ≥2 seated → deal; ==1 → idle (`waitingForPlayers`, broadcast, no deal); ==0 → `endGame` ejects all spectators via `left_table`. `endGame` emits `left_table` to every remaining non-left member.

- [ ] **Step 1: Write the failing tests.** Add to `game.test.ts`:

```ts
  it('idles (does not deal) when only one player is seated, then resumes when a spectator sits in', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    // 'a' leaves; after the hand only 'b' is seated → table idles, no new hand.
    room.leave('a');
    room.handleAction('a', { type: 'fold' });
    (room as unknown as { scheduleNextHand(): void }).scheduleNextHand();
    expect(room.isActive).toBe(true);
    const idleView = io.records.filter((r) => r.target === 'sb' && r.event === 'game_state_update').at(-1)!.args[0] as GameState;
    expect(idleView.waitingForPlayers).toBe(true);

    // 'c' sits in → 2 seated → next hand deals.
    room.requestSeat('c');
    (room as unknown as { scheduleNextHand(): void }).scheduleNextHand();
    expect(room.state!.players.length).toBe(2);
    room.stop();
  });

  it('ends the game and ejects everyone when the last player leaves', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const ended: string[] = [];
    const room = new GameRoom({
      io: io.io as never, gameId: 'G', instanceId: 'I', config: CONFIG,
      players, chips: chips.service,
      timing: { turnMs: 1e9, tickMs: 1e9, handDelayMs: 1e9 },
      onEnd: (id) => ended.push(id),
    });
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    room.leave('a');
    room.handleAction('a', { type: 'fold' });
    room.leave('b'); // now both seated players leaving
    (room as unknown as { scheduleNextHand(): void }).scheduleNextHand();

    expect(ended).toContain('G');
    expect(io.records.some((r) => r.target === 'sc' && r.event === 'left_table')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure.**

Run: `npm test -w @poker/server -- game.test.ts -t "idles"`
Expected: FAIL — table ends at <2 today instead of idling at 1.

- [ ] **Step 3: Implement.** Rework `scheduleNextHand()` and the live-check in `startHand()`:

```ts
  private scheduleNextHand(): void {
    if (this.stopped) return;
    this.applyPending();
    const seatedCount = this.seated().length;
    if (seatedCount === 0) {
      void this.endGame();
      return;
    }
    if (seatedCount < 2) {
      // Idle: keep the table open, broadcast the waiting state, deal nothing.
      this.handInProgress = false;
      this.broadcastState();
      return;
    }
    this.dealerIndex = this.nextDealer();
    this.nextHandTimeout = setTimeout(() => this.startHand(), this.handDelayMs);
  }
```

In `startHand()`, replace the early `live.length < 2` guard with:
```ts
    this.applyPending();
    const seatedCount = this.seated().length;
    if (seatedCount === 0) { void this.endGame(); return; }
    if (seatedCount < 2) { this.handInProgress = false; this.broadcastState(); return; }
```
(Keep `applyPending()` called once — if both `startHand` and `scheduleNextHand` call it, guard with a no-op when nothing pending; it's idempotent.)

In `endGame()`, before `this.onEnd?.(...)`, eject everyone:
```ts
    for (const m of this.members) {
      if (!m.left) this.io.to(m.socketId).emit('left_table');
    }
```

Update `resolveBetweenHands()` to just call `this.scheduleNextHand()` (which now applies pending and handles all three thresholds):
```ts
  private resolveBetweenHands(): void {
    this.scheduleNextHand();
  }
```

- [ ] **Step 4: Run to verify pass.**

Run: `npm test -w @poker/server -- game.test.ts -t "idles"` then `-t "ends the game"` then `npm test -w @poker/server`
Expected: PASS (all green).

- [ ] **Step 5: Commit.**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/game.test.ts
git commit -m "feat(server): idle-at-1-seated and end-at-0 teardown with spectator ejection"
```

---

## Task 8: `summary()` + lobby `activeGame` provider & player filtering

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Modify: `packages/server/src/rooms/lobby.ts`
- Test: `packages/server/src/rooms/game.test.ts`, `packages/server/src/rooms/lobby.test.ts`

**Interfaces:**
- Consumes: `Member` model, `LobbyState`.
- Produces: `GameRoom.summary(): ActiveGameSummary`; `GameRoom.memberIds(): string[]`. `LobbyRoom.setActiveGameProvider(fn: () => { summary: ActiveGameSummary; memberIds: string[] } | null)`; `LobbyRoom.broadcastState(): void` (public); `toState()` sets `activeGame` and filters `players` to exclude table members.

- [ ] **Step 1: Write the failing GameRoom test.** Add to `game.test.ts`:

```ts
  it('summarizes the table: playing/watching counts and members', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    const s = room.summary();
    expect(s.playingCount).toBe(2);
    expect(s.spectatingCount).toBe(1);
    expect(s.buyIn).toBe(3000);
    expect(s.members.find((m) => m.discordUserId === 'c')).toMatchObject({ role: 'spectator', chipStack: 0, seatIndex: null });
    room.stop();
  });
```

- [ ] **Step 2: Run to verify failure.**

Run: `npm test -w @poker/server -- game.test.ts -t "summarizes the table"`
Expected: FAIL — `room.summary` not a function.

- [ ] **Step 3: Implement `summary()` + `memberIds()`** in `game.ts`:

```ts
  summary(): ActiveGameSummary {
    const seated = this.seated();
    const members: TableMember[] = [
      ...seated.map((m, i) => ({
        discordUserId: m.discordUserId, displayName: m.displayName, avatarUrl: m.avatarUrl,
        role: 'seated' as const, chipStack: m.chipStack, seatIndex: i,
      })),
      ...this.spectatorMembers().map((m) => ({
        discordUserId: m.discordUserId, displayName: m.displayName, avatarUrl: m.avatarUrl,
        role: 'spectator' as const, chipStack: 0, seatIndex: null,
      })),
    ];
    return {
      gameId: this.gameId,
      handNumber: this.handNumber,
      buyIn: this.config.buyIn,
      maxPlayers: this.config.maxPlayers,
      playingCount: seated.length,
      spectatingCount: this.spectatorMembers().length,
      members,
      waitingForPlayers: seated.length < 2,
    };
  }

  memberIds(): string[] {
    return this.members.filter((m) => !m.left).map((m) => m.discordUserId);
  }
```
Add `ActiveGameSummary` and `TableMember` to the `@poker/shared` import at the top of `game.ts`.

- [ ] **Step 4: Run to verify pass.**

Run: `npm test -w @poker/server -- game.test.ts -t "summarizes the table"`
Expected: PASS.

- [ ] **Step 5: Implement the lobby provider + filtering.** In `lobby.ts`:

Add a field and setter to `LobbyRoom`:
```ts
  private activeGameProvider: (() => { summary: ActiveGameSummary; memberIds: string[] } | null) | null = null;

  setActiveGameProvider(fn: (() => { summary: ActiveGameSummary; memberIds: string[] } | null) | null): void {
    this.activeGameProvider = fn;
  }

  /** Public re-broadcast hook (used when game membership changes). */
  broadcastState(): void {
    this.broadcast();
  }
```
Import `ActiveGameSummary` in `lobby.ts`. Update `toState()`:
```ts
  toState(): LobbyState {
    const active = this.activeGameProvider?.() ?? null;
    const tableIds = new Set(active?.memberIds ?? []);
    return {
      instanceId: this.instanceId,
      players: [...this.players.values()].filter((p) => !tableIds.has(p.discordUserId)),
      status: this.status,
      countdownEndsAt: this.countdownEndsAt,
      config: this.config,
      activeGame: active?.summary ?? null,
    };
  }
```

- [ ] **Step 6: Write the failing lobby integration test.** Add to `lobby.test.ts` a test that a spectator who `join_table`s disappears from the lobby `players` list and appears in `activeGame`. (Use the existing connect/waitForState helpers; full multi-client flow.)

```ts
  it('moves a join_table spectator out of the player list and into activeGame', async () => {
    const a = await connect(); const b = await connect(); const c = await connect();
    a.emit('join_lobby', { instanceId: 'spec', identity: identity('a', 5000) });
    b.emit('join_lobby', { instanceId: 'spec', identity: identity('b', 5000) });
    c.emit('join_lobby', { instanceId: 'spec', identity: identity('c', 5000) });
    a.emit('player_ready'); b.emit('player_ready');
    await waitForState(c, allReady(3));
    a.emit('start_countdown');
    await once(c, 'game_start');
    // c is still in lobby; join the running game as a spectator.
    c.emit('join_table');
    const s = await waitForState(c, (st) => st.activeGame?.spectatingCount === 1);
    expect(s.players.some((p) => p.discordUserId === 'c')).toBe(false);
    expect(s.activeGame?.members.some((m) => m.discordUserId === 'c' && m.role === 'spectator')).toBe(true);
  });
```

(The `join_table` handler is wired in Task 9; this test will pass once Task 9 lands. If running strictly task-by-task, mark this test `it.skip` here and un-skip in Task 9 Step 1. The plan keeps it here because it asserts the lobby composition built in this task.)

- [ ] **Step 7: Run the server suite.**

Run: `npm test -w @poker/server`
Expected: PASS for the GameRoom `summary` test and existing tests. The new lobby test stays skipped until Task 9.

- [ ] **Step 8: Commit.**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/lobby.ts packages/server/src/rooms/game.test.ts packages/server/src/rooms/lobby.test.ts
git commit -m "feat(server): activeGame summary + lobby provider/player filtering"
```

---

## Task 9: Socket handlers & game-start wiring (`rooms/index.ts`)

**Files:**
- Modify: `packages/server/src/rooms/index.ts`
- Modify: `packages/server/src/rooms/game.ts` (emit `joined_table` to seated players on start)
- Modify: `packages/shared/src/events.ts` already done (Task 1); ensure `SocketData` carries `chipBalance`.
- Modify: `packages/shared/src/events.ts` (`SocketData`), rebuild shared.
- Test: `packages/server/src/rooms/lobby.test.ts` (un-skip Task 8's test)

**Interfaces:**
- Consumes: `GameRoom.addSpectator/requestSeat/moveToSpectate/cancelPending/leave/summary/memberIds`, `LobbyRoom.setActiveGameProvider/broadcastState`.
- Produces: socket handlers `join_table`, `sit_in`, `sit_out`, `cancel_pending` (+ repurposed `leave_table`); `onGameStart` wires the provider + `onMembershipChange`; `GameRoom.start()` emits `joined_table` to each seated member.

- [ ] **Step 1: Un-skip** the Task 8 lobby test (remove `.skip` if you added it).

- [ ] **Step 2: Add `chipBalance` to `SocketData`** in `events.ts`:
```ts
export interface SocketData {
  discordUserId: string;
  instanceId: string;
  displayName: string;
  avatarUrl: string;
  chipBalance: number;
}
```
Rebuild: `npm run build -w @poker/shared`.

- [ ] **Step 3: Emit `joined_table` to seated members in `GameRoom.start()`** — after buy-ins, before `startHand()`:
```ts
    for (const m of this.seated()) {
      this.io.to(m.socketId).emit('joined_table', { gameId: this.gameId, role: 'seated' });
    }
```

- [ ] **Step 4: Wire `rooms/index.ts`.** In `join_lobby`, store `chipBalance` and route reconnect through membership:
```ts
      socket.data.chipBalance = identity.chipBalance;
      ...
      // If a game is running and this identity is already at the table, rebind.
      games.get(instanceId)?.reconnect(identity.discordUserId, socket.id);
```
In `onGameStart`, after `games.set(...)`, wire the provider and membership re-broadcast:
```ts
      const lobbyRoom = lobbies.get(room.instanceId);
      lobbyRoom?.setActiveGameProvider(() => ({ summary: game.summary(), memberIds: game.memberIds() }));
      game.onMembershipChange = () => lobbyRoom?.broadcastState();
```
In the `onEnd` callback, clear the provider and re-broadcast:
```ts
        onEnd: (id) => {
          if (games.get(room.instanceId)?.gameId === id) games.delete(room.instanceId);
          const lr = lobbies.get(room.instanceId);
          lr?.setActiveGameProvider(null);
          lr?.broadcastState();
        },
```
Add the new socket handlers near `leave_table`:
```ts
    socket.on('join_table', () => {
      const game = gameFor(socket);
      if (!game || !socket.data.discordUserId) return;
      game.addSpectator({
        discordUserId: socket.data.discordUserId,
        displayName: socket.data.displayName,
        avatarUrl: socket.data.avatarUrl,
        socketId: socket.id,
        bankroll: socket.data.chipBalance ?? 0,
      });
    });
    socket.on('sit_in', () => routeMember(socket, (g, id) => g.requestSeat(id)));
    socket.on('sit_out', () => routeMember(socket, (g, id) => g.moveToSpectate(id)));
    socket.on('cancel_pending', () => routeMember(socket, (g, id) => g.cancelPending(id)));
```
Keep `leave_table` routing to `game.leave`. Add the helper:
```ts
  function routeMember(socket: LobbySocket, fn: (g: GameRoom, id: string) => void) {
    const game = gameFor(socket);
    if (game && socket.data.discordUserId) fn(game, socket.data.discordUserId);
  }
```

- [ ] **Step 5: Run the full server suite.**

Run: `npm test -w @poker/server`
Expected: PASS, including the un-skipped lobby spectator test.

- [ ] **Step 6: Build server + shared.**

Run: `npm run build -w @poker/shared && npm run build -w @poker/server`
Expected: no type errors.

- [ ] **Step 7: Commit.**

```bash
git add packages/server/src/rooms/index.ts packages/server/src/rooms/game.ts packages/shared/src/events.ts packages/shared/dist packages/server/src/rooms/lobby.test.ts
git commit -m "feat(server): wire join/sit/leave socket handlers + activeGame provider"
```

---

## Task 10: Client App routing on `joined_table` / `left_table`

**Files:**
- Modify: `packages/client/src/App.tsx`
- Test: `packages/client/src/App.test.tsx` (create)

**Interfaces:**
- Consumes: `joined_table`/`left_table` events.
- Produces: `App` renders `<GameCanvas>` while at the table, `<LobbyScreen>` otherwise; no longer keys off `game_start`.

- [ ] **Step 1: Write the failing test.** Create `packages/client/src/App.test.tsx`. Mock `setupDiscord` and the socket; assert the view switches on `joined_table`/`left_table`. Use a minimal fake socket with an event registry:

```tsx
import { render, screen, act } from '@testing-library/react';
import { vi } from 'vitest';

const handlers: Record<string, (arg?: unknown) => void> = {};
const fakeSocket = {
  on: (e: string, h: (arg?: unknown) => void) => { handlers[e] = h; },
  off: vi.fn(), emit: vi.fn(), disconnect: vi.fn(),
};
vi.mock('./socket', () => ({ createSocket: () => fakeSocket }));
vi.mock('./discord', () => ({
  setupDiscord: () => Promise.resolve({
    identity: { discordUserId: 'a', displayName: 'A', avatarUrl: '', chipBalance: 3000 },
    instanceId: 'I',
  }),
}));
vi.mock('./GameCanvas', () => ({ GameCanvas: () => <div>TABLE VIEW</div> }));
vi.mock('./lobby/LobbyScreen', () => ({ LobbyScreen: () => <div>LOBBY VIEW</div> }));

import { App } from './App';

it('switches to the table on joined_table and back on left_table', async () => {
  render(<App />);
  await screen.findByText('LOBBY VIEW');
  act(() => handlers['joined_table']?.({ gameId: 'G', role: 'seated' }));
  expect(screen.getByText('TABLE VIEW')).toBeInTheDocument();
  act(() => handlers['left_table']?.());
  expect(screen.getByText('LOBBY VIEW')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npm test -w @poker/client -- App.test.tsx`
Expected: FAIL — App still keys off `game_start`/`gameId`.

- [ ] **Step 3: Implement.** Rewrite the relevant parts of `App.tsx`: replace `gameId` state with `atTable`, and register the listeners once the socket exists:

```tsx
  const [atTable, setAtTable] = useState(false);

  useEffect(() => {
    if (status.phase !== 'ready') return;
    const socket = socketRef.current!;
    const onJoined = () => setAtTable(true);
    const onLeft = () => setAtTable(false);
    socket.on('joined_table', onJoined);
    socket.on('left_table', onLeft);
    return () => {
      socket.off('joined_table', onJoined);
      socket.off('left_table', onLeft);
    };
  }, [status.phase]);
```
Render: `if (status.phase === 'ready' && atTable) return <GameCanvas socket={socketRef.current!} identity={status.identity} />;` then the `LobbyScreen` (drop the `onGameStart` prop — see Task 11). Remove the now-unused `game_start` handling.

- [ ] **Step 4: Run to verify pass.**

Run: `npm test -w @poker/client -- App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/client/src/App.tsx packages/client/src/App.test.tsx
git commit -m "feat(client): route lobby/table on joined_table/left_table events"
```

---

## Task 11: Lobby "Join Active Game" card

**Files:**
- Create: `packages/client/src/lobby/ActiveGameCard.tsx`
- Create: `packages/client/src/lobby/ActiveGameCard.test.tsx`
- Modify: `packages/client/src/lobby/LobbyScreen.tsx`

**Interfaces:**
- Consumes: `LobbyState.activeGame`, socket `join_table`.
- Produces: `ActiveGameCard({ activeGame, onJoinTable })` rendering the AT THE TABLE pill, member list, and a Join Table button. `LobbyScreen` shows it on the `home` tab when `lobby.activeGame` is set (instead of `TableSettings`), and drops the `onGameStart` prop.

- [ ] **Step 1: Write the failing component test.** Create `ActiveGameCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { ActiveGameSummary } from '@poker/shared';
import { ActiveGameCard } from './ActiveGameCard';

const summary: ActiveGameSummary = {
  gameId: 'G', handNumber: 4, buyIn: 3000, maxPlayers: 9,
  playingCount: 2, spectatingCount: 1, waitingForPlayers: false,
  members: [
    { discordUserId: 'a', displayName: 'Alice', avatarUrl: '', role: 'seated', chipStack: 5000, seatIndex: 0 },
    { discordUserId: 'b', displayName: 'Bob', avatarUrl: '', role: 'seated', chipStack: 1000, seatIndex: 1 },
    { discordUserId: 'c', displayName: 'Cy', avatarUrl: '', role: 'spectator', chipStack: 0, seatIndex: null },
  ],
};

it('shows playing/watching counts and joins on click', () => {
  const onJoinTable = vi.fn();
  render(<ActiveGameCard activeGame={summary} onJoinTable={onJoinTable} />);
  expect(screen.getByText(/2 PLAYING/i)).toBeInTheDocument();
  expect(screen.getByText(/1 WATCHING/i)).toBeInTheDocument();
  screen.getByRole('button', { name: /Join Table/i }).click();
  expect(onJoinTable).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npm test -w @poker/client -- ActiveGameCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ActiveGameCard.tsx`** using design tokens (no raw hex). Keep it focused:

```tsx
import type { ActiveGameSummary } from '@poker/shared';

export interface ActiveGameCardProps {
  activeGame: ActiveGameSummary;
  onJoinTable: () => void;
}

export function ActiveGameCard({ activeGame, onJoinTable }: ActiveGameCardProps) {
  const { playingCount, spectatingCount, members, buyIn, waitingForPlayers } = activeGame;
  return (
    <div className="mx-auto max-w-[740px] p-4">
      <div className="mb-3 flex items-center justify-center gap-2 font-display text-[13px] font-semibold">
        <span className="rounded-pill border-2 border-emerald-400/60 bg-emerald-400/20 px-3 py-1 text-emerald-200">
          {playingCount} PLAYING
        </span>
        <span className="rounded-pill border-2 border-white/15 bg-white/10 px-3 py-1 text-cream/80">
          {spectatingCount} WATCHING
        </span>
      </div>
      <div className="rounded-3xl border-[2.5px] border-black/30 bg-felt-800 p-7 shadow-panel">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-display text-2xl font-semibold text-white">Game in Progress</span>
          <span className="rounded-pill border-2 border-red-400/40 bg-red-400/15 px-3 py-1 font-display text-[13px] font-bold text-red-300">LIVE</span>
        </div>
        {waitingForPlayers && (
          <p className="mb-3 text-sm text-cream/70">Waiting for players to start the next hand…</p>
        )}
        <ul className="mb-5 flex flex-col gap-1.5">
          {members.map((m) => (
            <li key={m.discordUserId} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
              <span className="font-body text-cream">{m.displayName}</span>
              <span className={m.role === 'seated' ? 'font-display text-gold' : 'text-cream/50'}>
                {m.role === 'seated' ? m.chipStack.toLocaleString() : 'Spectating'}
              </span>
            </li>
          ))}
        </ul>
        <button
          onClick={onJoinTable}
          className="w-full rounded-2xl border-[2.5px] border-gold-border bg-gold px-5 py-4 font-display text-base font-semibold text-[#2a1c00] shadow-button"
        >
          ♠ Join Table — Buy In {buyIn.toLocaleString()}
        </button>
      </div>
    </div>
  );
}
```
(If a token like `bg-felt-800`/`shadow-button` isn't in `index.css`, substitute the nearest existing token — check `docs/DESIGN_STANDARDS.md`. Do not introduce raw hex.)

- [ ] **Step 4: Run to verify pass.**

Run: `npm test -w @poker/client -- ActiveGameCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into `LobbyScreen.tsx`.** Import `ActiveGameCard`; remove `onGameStart` from `LobbyScreenProps` and the `game_start` effect. In the `home` tab branch:
```tsx
          {tab === 'home' && (lobby.activeGame
            ? <ActiveGameCard activeGame={lobby.activeGame} onJoinTable={() => socket.emit('join_table')} />
            : <TableSettings ... />)}
```
(Keep the existing `TableSettings` props block unchanged in the `else` branch.)

- [ ] **Step 6: Run the client suite + build.**

Run: `npm test -w @poker/client && npm run build -w @poker/client`
Expected: PASS / no type errors. (Update `App.tsx` if it still passes `onGameStart` — it shouldn't after Task 10.)

- [ ] **Step 7: Commit.**

```bash
git add packages/client/src/lobby/ActiveGameCard.tsx packages/client/src/lobby/ActiveGameCard.test.tsx packages/client/src/lobby/LobbyScreen.tsx
git commit -m "feat(client): lobby Join Active Game card (spectate-first)"
```

---

## Task 12: Table spectator/seated controls + eye-icon + waiting overlay

**Files:**
- Create: `packages/client/src/SpectatorControls.tsx`
- Create: `packages/client/src/SpectatorControls.test.tsx`
- Modify: `packages/client/src/GameCanvas.tsx`

**Interfaces:**
- Consumes: `GameState` (incl. `spectators`, `waitingForPlayers`, `viewerPending`), socket events `sit_in`/`sit_out`/`cancel_pending`/`leave_table`.
- Produces: `SpectatorControls({ state, myId, bankroll, onSitIn, onSitOut, onLeave, onCancelPending })` rendering the spectator banner (with greyed/justified Join Next Hand), seated menu (Move to Spectate / Leave / Cancel toggle), eye-icon watcher list, and waiting overlay. `GameCanvas` renders it and wires the socket.

- [ ] **Step 1: Write the failing test.** Create `SpectatorControls.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { GameState } from '@poker/shared';
import { SpectatorControls } from './SpectatorControls';

function baseState(over: Partial<GameState> = {}): GameState {
  return {
    gameId: 'G', instanceId: 'I', phase: 'flop', players: [
      { discordUserId: 'a', displayName: 'A', avatarUrl: '', seatIndex: 0, chipStack: 3000, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false },
    ],
    communityCards: [], pots: [], currentPlayerIndex: 0, dealerIndex: 0, smallBlindIndex: 0,
    bigBlindIndex: 0, callAmount: 0, minRaise: 50, handNumber: 1,
    config: { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 },
    spectators: [{ discordUserId: 'c', displayName: 'Cy', avatarUrl: '' }],
    waitingForPlayers: false, viewerPending: null, ...over,
  };
}

it('spectator can Join Next Hand when funded and a seat is free', () => {
  const onSitIn = vi.fn();
  render(<SpectatorControls state={baseState()} myId="c" bankroll={3000} onSitIn={onSitIn} onSitOut={vi.fn()} onLeave={vi.fn()} onCancelPending={vi.fn()} />);
  const btn = screen.getByRole('button', { name: /Join Next Hand/i });
  expect(btn).not.toBeDisabled();
  btn.click();
  expect(onSitIn).toHaveBeenCalled();
});

it('Join Next Hand is disabled and explains why when underfunded', () => {
  render(<SpectatorControls state={baseState()} myId="c" bankroll={100} onSitIn={vi.fn()} onSitOut={vi.fn()} onLeave={vi.fn()} onCancelPending={vi.fn()} />);
  const btn = screen.getByRole('button', { name: /Join Next Hand/i });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('title', expect.stringMatching(/chips/i));
});

it('seated player with a pending leave shows a Cancel control', () => {
  const onCancel = vi.fn();
  render(<SpectatorControls state={baseState({ viewerPending: 'leave' })} myId="a" bankroll={0} onSitIn={vi.fn()} onSitOut={vi.fn()} onLeave={vi.fn()} onCancelPending={onCancel} />);
  screen.getByRole('button', { name: /Cancel/i }).click();
  expect(onCancel).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `npm test -w @poker/client -- SpectatorControls.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SpectatorControls.tsx`** (inline styles, matching the throwaway table UI pattern):

```tsx
import type { GameState } from '@poker/shared';

interface Props {
  state: GameState;
  myId: string;
  bankroll: number;
  onSitIn: () => void;
  onSitOut: () => void;
  onLeave: () => void;
  onCancelPending: () => void;
}

export function SpectatorControls({ state, myId, bankroll, onSitIn, onSitOut, onLeave, onCancelPending }: Props) {
  const seated = state.players.some((p) => p.discordUserId === myId);
  const spectators = state.spectators ?? [];
  const pending = state.viewerPending ?? null;
  const seatFull = state.players.length >= state.config.maxPlayers;
  const underfunded = bankroll < state.config.buyIn;
  const canSit = !seatFull && !underfunded;
  const sitReason = seatFull ? 'Table is full' : underfunded ? 'Not enough chips for the buy-in' : '';

  return (
    <div style={S.wrap}>
      <div style={S.eye} title={spectators.map((s) => s.displayName).join(', ') || 'No spectators'}>
        👁 {spectators.length}
      </div>

      {state.waitingForPlayers && <div style={S.waiting}>Waiting for players…</div>}

      {!seated ? (
        <div style={S.bar}>
          <span style={S.note}>You're watching</span>
          {pending === 'seat' ? (
            <button style={S.btn} onClick={onCancelPending}>Cancel — joining next hand</button>
          ) : (
            <button style={canSit ? S.btn : S.btnDisabled} disabled={!canSit} title={sitReason} onClick={onSitIn}>
              Join Next Hand
            </button>
          )}
          <button style={S.btn} onClick={onLeave}>Leave Table</button>
        </div>
      ) : (
        <div style={S.bar}>
          {pending === 'spectate' && <button style={S.btn} onClick={onCancelPending}>Cancel — spectating after hand</button>}
          {pending === 'leave' && <button style={S.btn} onClick={onCancelPending}>Cancel — leaving after hand</button>}
          {pending === null && (
            <>
              <button style={S.btn} onClick={onSitOut}>Move to Spectate</button>
              <button style={S.btn} onClick={onLeave}>Leave Table</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' },
  eye: { background: 'rgba(10,12,28,0.8)', borderRadius: 999, padding: '4px 10px', fontSize: 14, cursor: 'default' },
  waiting: { background: 'rgba(10,12,28,0.85)', borderRadius: 8, padding: '6px 12px', color: '#ffe9a8' },
  bar: { display: 'flex', gap: 8, alignItems: 'center' },
  note: { opacity: 0.8, fontSize: 13 },
  btn: { padding: '8px 12px', borderRadius: 8, border: 'none', background: '#3a3f65', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  btnDisabled: { padding: '8px 12px', borderRadius: 8, border: 'none', background: '#2a2d44', color: '#8a8da6', cursor: 'not-allowed' },
};
```

- [ ] **Step 4: Run to verify pass.**

Run: `npm test -w @poker/client -- SpectatorControls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into `GameCanvas.tsx`.** Add `SpectatorControls` (passing `identity.chipBalance` as `bankroll`) and the socket emitters; render it always (it self-hides controls based on state). Add near the existing `ActionBar` render:
```tsx
      {view && (
        <SpectatorControls
          state={view}
          myId={identity.discordUserId}
          bankroll={identity.chipBalance}
          onSitIn={() => socket.emit('sit_in')}
          onSitOut={() => socket.emit('sit_out')}
          onLeave={() => socket.emit('leave_table')}
          onCancelPending={() => socket.emit('cancel_pending')}
        />
      )}
```
The existing `ActionBar` already returns null for non-acting viewers, so spectators see no action buttons.

- [ ] **Step 6: Run client suite + build.**

Run: `npm test -w @poker/client && npm run build -w @poker/client`
Expected: PASS / no type errors.

- [ ] **Step 7: Commit.**

```bash
git add packages/client/src/SpectatorControls.tsx packages/client/src/SpectatorControls.test.tsx packages/client/src/GameCanvas.tsx
git commit -m "feat(client): table spectator/seated controls, eye-icon, waiting overlay"
```

---

## Task 13: Docs

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `CLAUDE.md`, `docs/To-do.md`

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`** — add a "Table membership (spectate / join / leave)" subsection describing: the `Member` model with roles, hand-boundary transition resolution, the idle-at-1 / end-at-0 teardown, the `seatSession` ledger keys, the `activeGame` lobby summary + player filtering, and the `joined_table`/`left_table` view-switch protocol.

- [ ] **Step 2: Update `CLAUDE.md`** — in "Conventions & gotchas", note that `GameRoom` owns the full table population (seated + spectators), transitions resolve at hand boundaries, buy-in/cash-out keys carry `seatSession`, and the lobby folds a cards-free `ActiveGameSummary` into `LobbyState`. Update the rooms/ file description.

- [ ] **Step 3: Update `docs/To-do.md`** — mark "Spectate System" done; remove the two Known Bugs this fixes ("player runs out of money and busts… table gets stuck" and "no way to exit the table back to the lobby"). Leave the all-in over-call bug.

- [ ] **Step 4: Full verification.**

Run: `npm test && npm run build`
Expected: server + client suites PASS; all three packages build.

- [ ] **Step 5: Commit.**

```bash
git add docs/ARCHITECTURE.md CLAUDE.md docs/To-do.md
git commit -m "docs: document spectate/join/leave table membership"
```

---

## Self-review notes (for the executor)

- **Driving hand boundaries in tests:** the room uses huge timers, so tests call private `startHand()`/`scheduleNextHand()`/`applyPending()` via `(room as unknown as { … })` casts. This is intentional and matches the existing test style of driving actions directly.
- **`applyPending` idempotency:** it's called at the top of both `startHand` and `scheduleNextHand`; it must be safe to run with nothing pending (it is — every branch is guarded, and `pending` is cleared per member).
- **Reconnect path:** `addSpectator` rebinds an existing member's socket; `reconnect` (seated) is unchanged from Task 2. A player who left (`m.left`) is treated as gone — re-entry happens via `join_lobby` → `join_table`.
- **Bankroll staleness:** `sit_in` gating uses the lobby-known `bankroll` (consistent with how the lobby gates START today). The authoritative deduction still happens via `ChipService` at seat time.
