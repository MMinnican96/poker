# Chip Balance Authority Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chip ledger the single authoritative source of every player's balance — never negative, gated at buy-in, and pushed live to the lobby and the in-table client — fixing the three reported bugs (silent join failures, negative balances on underfunded sit-in, and stale chip display until activity reload).

**Architecture:** The root cause is that `identity.chipBalance` (captured once at OAuth/app-load) is used everywhere as the balance source and never refreshed from the authoritative DB, and `adjustChips` has no non-negative floor. The fix: (1) add a non-negative guard shared by the DB ledger and a new in-memory ledger (so mock mode is authoritative too); (2) gate every buy-in on the ledger's `applied` result and set each member's `bankroll` from the ledger's returned `balance` (never a stale delta); (3) surface that authoritative balance live to the player (`viewerBankroll` in the per-viewer game view) and the lobby (existing `updateChipBalance`), plus a `sit_in_rejected` message when a seat is refused.

**Tech Stack:** TypeScript (NodeNext ESM) monorepo; Node + Express + Socket.io + Drizzle/Postgres (server); React + Phaser 3 (client); Vitest + RTL (tests).

## Global Constraints

- `@poker/shared` is ESM (NodeNext), built to `dist/`. Keep `shared/src` to `.ts` only; after editing source types, rebuild `npm run build --workspace=packages/shared` and commit the regenerated `dist/`.
- The server is the authoritative source of truth; never trust client-claimed balances for gating. The persistent chip balance must NEVER be negative.
- Server tests run via `vitest run` (no typecheck). Client tests run via `vitest run` (jsdom + RTL). Client tasks MUST also `npm run build --workspace=packages/client` (exit 0) because vitest does not typecheck.
- The chip model is unchanged: `adjustChips()` is idempotent on a unique `idempotencyKey`; buy-in/cash-out keys carry a per-seat `seatSession` counter.
- Mock mode (no `DATABASE_URL`) must remain zero-setup and now must track real in-memory balances (seeded from each player's identity balance) so local testing exercises the gating.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Git safety: only `git add <paths>` + `git commit`. Never `git reset`/`checkout --`/`clean`/`stash`/`switch`/`branch` — a prior session lost user WIP that way.
- After all tasks: `npm test` and `npm run build` must pass.

## File Structure

- `packages/shared/src/types.ts` — add `GameState.viewerBankroll?: number`.
- `packages/shared/src/events.ts` — add `sit_in_rejected` (server→client).
- `packages/server/src/db/chip-rules.ts` — **new**, pure `overdraws(current, amount)` rule.
- `packages/server/src/db/chip-rules.test.ts` — **new**, tests the rule.
- `packages/server/src/db/index.ts` — add the non-negative guard to `adjustChips`.
- `packages/server/src/rooms/in-memory-chips.ts` — **new**, `InMemoryChipService` (authoritative mock-mode ledger).
- `packages/server/src/rooms/in-memory-chips.test.ts` — **new**.
- `packages/server/src/rooms/game.ts` — `ChipService.seed?`; gate buy-ins on the ledger result; set `bankroll` from `result.balance`; `viewerBankroll`; emit `sit_in_rejected`.
- `packages/server/src/rooms/game.test.ts` — make `makeFakeChips` authoritative; seed players; add gating/rejection/viewerBankroll tests.
- `packages/server/src/rooms/lobby.ts` — `getChipBalance(playerId)`.
- `packages/server/src/index.ts` — use `InMemoryChipService` instead of `noopChipService` in mock mode.
- `packages/server/src/rooms/index.ts` — seed the ledger on `join_lobby`; seed `addSpectator` bankroll from the lobby's live balance.
- `packages/client/src/GameCanvas.tsx` — pass `viewerBankroll` to controls; handle `sit_in_rejected`.
- `packages/client/src/SpectatorControls.tsx` (+ test) / `GameCanvas` test — live grey-out + rejection notice.
- Docs: `docs/ARCHITECTURE.md`, `CLAUDE.md`.

---

## Task 1: Shared contracts (viewerBankroll + sit_in_rejected)

**Files:**
- Modify: `packages/shared/src/types.ts` (`GameState` interface)
- Modify: `packages/shared/src/events.ts` (`ServerToClientEvents`)

**Interfaces:**
- Produces: `GameState.viewerBankroll?: number`; server→client event `sit_in_rejected: (data: { reason: string }) => void`.

- [ ] **Step 1: Add `viewerBankroll` to `GameState`**

In `packages/shared/src/types.ts`, in the `GameState` interface, after the `viewerPending` field add:

```ts
  /** This viewer's authoritative bankroll (off-table chips), pushed live by the server. */
  viewerBankroll?: number;
```

- [ ] **Step 2: Add the `sit_in_rejected` server event**

In `packages/shared/src/events.ts`, in `ServerToClientEvents`, after `left_table: () => void;` add:

```ts
  sit_in_rejected: (data: { reason: string }) => void;
```

- [ ] **Step 3: Build shared**

Run: `npm run build --workspace=packages/shared`
Expected: exits 0; `dist/types.d.ts` shows `viewerBankroll`, `dist/events.d.ts` shows `sit_in_rejected`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src packages/shared/dist
git commit -m "feat(shared): add viewerBankroll + sit_in_rejected for live chip authority

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Non-negative chip rule + DB guard

**Files:**
- Create: `packages/server/src/db/chip-rules.ts`
- Create: `packages/server/src/db/chip-rules.test.ts`
- Modify: `packages/server/src/db/index.ts` (`adjustChips`)

**Interfaces:**
- Produces: `overdraws(current: number, amount: number): boolean` — true when applying `amount` to `current` would drive the balance below zero (i.e. `amount < 0 && current + amount < 0`).

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/db/chip-rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { overdraws } from './chip-rules.js';

describe('overdraws', () => {
  it('is false for credits (positive amounts)', () => {
    expect(overdraws(0, 5000)).toBe(false);
    expect(overdraws(100, 1)).toBe(false);
  });
  it('is false for a deduction the balance can cover', () => {
    expect(overdraws(3000, -3000)).toBe(false);
    expect(overdraws(5000, -3000)).toBe(false);
  });
  it('is true for a deduction larger than the balance', () => {
    expect(overdraws(100, -3000)).toBe(true);
    expect(overdraws(0, -1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/server -- chip-rules`
Expected: FAIL — `overdraws` not found.

- [ ] **Step 3: Implement the rule**

Create `packages/server/src/db/chip-rules.ts`:

```ts
/**
 * True when applying `amount` to `current` would drive the balance below zero.
 * Credits (amount >= 0) never overdraw. Shared by the DB ledger and the
 * in-memory mock ledger so the non-negative invariant is identical in both.
 */
export function overdraws(current: number, amount: number): boolean {
  return amount < 0 && current + amount < 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=packages/server -- chip-rules`
Expected: PASS.

- [ ] **Step 5: Add the guard to `adjustChips`**

In `packages/server/src/db/index.ts`, add the import near the top (after the existing imports):

```ts
import { overdraws } from './chip-rules.js';
```

Replace the entire `adjustChips` function body (the `return getDb().transaction(...)` block) with:

```ts
  return getDb().transaction(async (tx) => {
    // Lock the player row and read the current balance up front.
    const [row] = await tx
      .select({ balance: schema.players.chipBalance })
      .from(schema.players)
      .where(eq(schema.players.discordUserId, input.playerId))
      .for('update');
    const current = row?.balance ?? 0;

    // Defense in depth: the persistent balance can never go negative.
    if (overdraws(current, input.amount)) {
      return { applied: false, balance: current };
    }

    const inserted = await tx
      .insert(schema.chipTransactions)
      .values({
        playerId: input.playerId,
        amount: input.amount,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({ target: schema.chipTransactions.idempotencyKey })
      .returning({ id: schema.chipTransactions.id });

    if (inserted.length === 0) {
      // Already applied — return current balance unchanged.
      return { applied: false, balance: current };
    }

    const [updated] = await tx
      .update(schema.players)
      .set({ chipBalance: sql`${schema.players.chipBalance} + ${input.amount}` })
      .where(eq(schema.players.discordUserId, input.playerId))
      .returning({ balance: schema.players.chipBalance });

    return { applied: true, balance: updated.balance };
  });
```

- [ ] **Step 6: Verify the server suite + build still pass**

Run: `npm run test --workspace=packages/server`
Expected: PASS (DB function has no direct unit test; the rule is covered).

Run: `npm run build --workspace=packages/server`
Expected: exits 0 (the `.for('update')` Drizzle call typechecks).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db/chip-rules.ts packages/server/src/db/chip-rules.test.ts packages/server/src/db/index.ts
git commit -m "fix(server): never let a chip balance go negative (adjustChips guard)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: In-memory authoritative ChipService

**Files:**
- Create: `packages/server/src/rooms/in-memory-chips.ts`
- Create: `packages/server/src/rooms/in-memory-chips.test.ts`
- Modify: `packages/server/src/rooms/game.ts` (extend `ChipService` with optional `seed`)

**Interfaces:**
- Consumes: `overdraws` (Task 2); `ChipService` (game.ts).
- Produces: `class InMemoryChipService implements ChipService` with `seed(playerId, balance)` (sets the starting balance once, ignored if already known), `adjust(...)` (idempotent + non-negative, returns the true balance), and `balanceOf(playerId): number`. Adds `seed?(playerId: string, balance: number): void` to the `ChipService` interface.

- [ ] **Step 1: Extend the `ChipService` interface with an optional `seed`**

In `packages/server/src/rooms/game.ts`, in the `ChipService` interface (around line 33), after the `adjust(...)` method add:

```ts
  /** Optional: seed a player's starting balance (in-memory ledgers only; the DB ledger ignores this). */
  seed?(playerId: string, balance: number): void;
```

- [ ] **Step 2: Write the failing test**

Create `packages/server/src/rooms/in-memory-chips.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryChipService } from './in-memory-chips.js';

describe('InMemoryChipService', () => {
  it('seeds a starting balance once and reports it', () => {
    const c = new InMemoryChipService();
    c.seed('a', 10_000);
    c.seed('a', 1); // ignored — already seeded
    expect(c.balanceOf('a')).toBe(10_000);
  });

  it('applies a deduction and returns the new balance', async () => {
    const c = new InMemoryChipService();
    c.seed('a', 10_000);
    const r = await c.adjust({ playerId: 'a', amount: -3000, type: 'buy-in', idempotencyKey: 'k1' });
    expect(r).toEqual({ applied: true, balance: 7000 });
    expect(c.balanceOf('a')).toBe(7000);
  });

  it('refuses a deduction that would go negative, leaving the balance untouched', async () => {
    const c = new InMemoryChipService();
    c.seed('a', 100);
    const r = await c.adjust({ playerId: 'a', amount: -3000, type: 'buy-in', idempotencyKey: 'k1' });
    expect(r).toEqual({ applied: false, balance: 100 });
    expect(c.balanceOf('a')).toBe(100);
  });

  it('is idempotent on the idempotency key', async () => {
    const c = new InMemoryChipService();
    c.seed('a', 10_000);
    await c.adjust({ playerId: 'a', amount: -3000, type: 'buy-in', idempotencyKey: 'k1' });
    const again = await c.adjust({ playerId: 'a', amount: -3000, type: 'buy-in', idempotencyKey: 'k1' });
    expect(again).toEqual({ applied: false, balance: 7000 });
    expect(c.balanceOf('a')).toBe(7000);
  });

  it('credits a cash-out back to the balance', async () => {
    const c = new InMemoryChipService();
    c.seed('a', 7000);
    const r = await c.adjust({ playerId: 'a', amount: 2975, type: 'cash-out', idempotencyKey: 'k2' });
    expect(r).toEqual({ applied: true, balance: 9975 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test --workspace=packages/server -- in-memory-chips`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `InMemoryChipService`**

Create `packages/server/src/rooms/in-memory-chips.ts`:

```ts
import { overdraws } from '../db/chip-rules.js';
import type { ChipService } from './game.js';

/**
 * Authoritative in-memory chip ledger for dev/mock mode (no DATABASE_URL).
 * Tracks each player's real balance (seeded from their identity balance),
 * enforces the same non-negative + idempotency rules as the DB ledger, and
 * returns the true post-adjust balance so live chip data is correct without a DB.
 */
export class InMemoryChipService implements ChipService {
  private readonly balances = new Map<string, number>();
  private readonly applied = new Set<string>();

  /** Set the starting balance the first time we see a player; ignored afterwards. */
  seed(playerId: string, balance: number): void {
    if (!this.balances.has(playerId)) this.balances.set(playerId, balance);
  }

  balanceOf(playerId: string): number {
    return this.balances.get(playerId) ?? 0;
  }

  async adjust(input: {
    playerId: string;
    amount: number;
    type: string;
    idempotencyKey: string;
  }): Promise<{ applied: boolean; balance: number }> {
    const current = this.balances.get(input.playerId) ?? 0;
    if (this.applied.has(input.idempotencyKey)) return { applied: false, balance: current };
    if (overdraws(current, input.amount)) return { applied: false, balance: current };
    this.applied.add(input.idempotencyKey);
    const next = current + input.amount;
    this.balances.set(input.playerId, next);
    return { applied: true, balance: next };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=packages/server -- in-memory-chips`
Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/rooms/in-memory-chips.ts packages/server/src/rooms/in-memory-chips.test.ts packages/server/src/rooms/game.ts
git commit -m "feat(server): authoritative in-memory chip ledger for mock mode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: GameRoom — gate buy-ins on the ledger; authoritative bankroll; viewerBankroll; rejection

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Modify: `packages/server/src/rooms/game.test.ts`

**Interfaces:**
- Consumes: `ChipService.adjust` returning `{ applied, balance }`; `ChipService.seed?` (Task 3); `GameState.viewerBankroll` + `sit_in_rejected` (Task 1).
- Produces: buy-ins that refuse insufficient funds (player stays a spectator + receives `sit_in_rejected`); `member.bankroll` always equals the ledger's returned `balance`; `currentView`/`waitingView` carry `viewerBankroll`.

- [ ] **Step 1: Make `makeFakeChips` authoritative and seed players (test infra)**

In `packages/server/src/rooms/game.test.ts`, replace the `makeFakeChips` helper with a version that delegates to the real in-memory ledger (so balances are authoritative) while still recording calls, and add a `seed`:

```ts
import { InMemoryChipService } from './in-memory-chips.js';

/** Authoritative fake chip ledger (records every call; tracks real balances). */
function makeFakeChips() {
  const calls: Array<{ playerId: string; amount: number; type: string; idempotencyKey: string }> = [];
  const ledger = new InMemoryChipService();
  const service: ChipService = {
    seed: (id, bal) => ledger.seed(id, bal),
    async adjust(input) {
      calls.push(input);
      return ledger.adjust(input);
    },
  };
  return { calls, service, seed: (id: string, bal: number) => ledger.seed(id, bal) };
}
```

Then update `makeRoom` to seed the two default players before returning the room:

```ts
function makeRoom(
  io: ReturnType<typeof makeFakeIo>,
  chips: ChipService,
  timing = {},
  stats: StatsService | undefined = undefined,
) {
  chips.seed?.('a', 3000);
  chips.seed?.('b', 3000);
  return new GameRoom({
    io: io.io as never,
    gameId: 'G',
    instanceId: 'I',
    config: CONFIG,
    players,
    chips,
    stats,
    timing: { turnMs: 1e9, tickMs: 1e9, handDelayMs: 1e9, ...timing },
  });
}
```

In every test that calls `room.addSpectator({ discordUserId: 'c', ... bankroll: 3000 ... })` and then seats 'c' (the sit-in, teardown idle-resume, and re-entry-guard tests), seed the ledger for 'c' right after creating `chips` (the value matches the spectator's bankroll). Concretely add `chips.seed('c', 3000);` after `const chips = makeFakeChips();` in:
- `GameRoom sit-in > seats a spectator at the next hand and charges a fresh buy-in`
- `GameRoom teardown thresholds > idles ... then resumes when a spectator sits in`
- `GameRoom re-entry guard and lobby rebroadcast > Test A`
And add `chips.seed('c', 100);` in `GameRoom sit-in > rejects sit-in when the table is full or the player is underfunded` (matches that spectator's bankroll 100).

For the `ends the game and ejects everyone` test (which builds the room inline, not via `makeRoom`), add `chips.seed('a', 3000); chips.seed('b', 3000); chips.seed('c', 3000);` right after `const chips = makeFakeChips();`.

- [ ] **Step 2: Write the new failing tests (gating + rejection + viewerBankroll)**

Append to `packages/server/src/rooms/game.test.ts`:

```ts
describe('GameRoom buy-in gating', () => {
  it('rejects an underfunded sit-in request immediately with a reason', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    chips.seed('c', 100);
    await room.start();
    // Spectator's bankroll reflects the live (low) balance — the gate uses it.
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 100 });
    room.requestSeat('c'); // bankroll 100 < buyIn 3000 → pre-check refuses
    expect(io.records.some((r) => r.target === 'sc' && r.event === 'sit_in_rejected')).toBe(true);
    expect(room.state!.players.some((p) => p.discordUserId === 'c')).toBe(false);
    room.stop();
  });

  it('keeps a player who cannot fund the buy-in at start off the table and rejects them', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    // 'b' only has 100 in the ledger — the start buy-in must be refused.
    chips.seed('a', 3000);
    chips.seed('b', 100);
    const room = new GameRoom({
      io: io.io as never, gameId: 'G', instanceId: 'I', config: CONFIG,
      players, chips: chips.service,
      timing: { turnMs: 1e9, tickMs: 1e9, handDelayMs: 1e9 },
    });
    await room.start();
    expect(io.records.some((r) => r.target === 'sb' && r.event === 'sit_in_rejected')).toBe(true);
    // Only 'a' is seated; the table idles (no hand dealt with one player).
    expect((room.state?.players ?? []).some((p) => p.discordUserId === 'b')).toBe(false);
    room.stop();
  });

  it('sets bankroll from the ledger balance and exposes it as viewerBankroll', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    // 'a' bought in: ledger 3000 - 3000 = 0 → viewerBankroll 0.
    const toA = io.records.filter((r) => r.target === 'sa' && r.event === 'game_state_update').at(-1)!.args[0] as GameState;
    expect(toA.viewerBankroll).toBe(0);
    room.stop();
  });
});
```

Note: the first test seeds `c` to 100 BEFORE `makeRoom`-independent `addSpectator`, and passes `bankroll: 100` so `canSeat` (which reads `m.bankroll`) refuses on the pre-check. In production, `addSpectator`'s bankroll is seeded from the lobby's live balance (Task 5), so the member bankroll and the ledger agree.

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npm run test --workspace=packages/server -- game.test`
Expected: FAIL — `sit_in_rejected` never emitted; `viewerBankroll` undefined.

- [ ] **Step 4: Implement the GameRoom changes**

In `packages/server/src/rooms/game.ts`:

(a) Replace `requestSeat` (around line 199-208) to give immediate feedback when the seat is refused:

```ts
  /** Spectator asks for a seat. Applied at the next hand boundary (or now if idle). */
  requestSeat(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m || m.role === 'seated') return;
    if (!this.canSeat(m)) {
      const reason = this.seated().length >= this.config.maxPlayers
        ? 'The table is full.'
        : 'Not enough chips for the buy-in.';
      this.io.to(m.socketId).emit('sit_in_rejected', { reason });
      return;
    }
    m.pending = 'seat';
    if (!this.handInProgress) this.resolveBetweenHands();
    else this.broadcastState();
    this.onMembershipChange?.();
  }
```

(b) Replace the buy-in block in `start()` (around line 178-191) to use the ledger result authoritatively:

```ts
  /** Deduct buy-ins from each player's bankroll, then deal the first hand. */
  async start(): Promise<void> {
    await Promise.all(
      this.seated().map(async (m) => {
        m.seatSession += 1;
        const r = await this.chips.adjust({
          playerId: m.discordUserId,
          amount: -this.config.buyIn,
          type: 'buy-in',
          idempotencyKey: `${this.gameId}:buyin:${m.discordUserId}:${m.seatSession}`,
        });
        if (!r.applied) {
          // Could not fund the buy-in — keep them off the table as a spectator.
          m.role = 'spectator';
          this.io.to(m.socketId).emit('sit_in_rejected', { reason: 'Not enough chips for the buy-in.' });
          return;
        }
        m.chipStack = this.config.buyIn;
        m.bankroll = r.balance;
        this.onChipBalanceChange?.(m.discordUserId, m.bankroll);
      }),
    );
    if (this.stopped) return;
    for (const m of this.seated()) {
      this.io.to(m.socketId).emit('joined_table', { gameId: this.gameId, role: 'seated' });
    }
    this.startHand();
  }
```

(c) Replace the `pending === 'seat'` branch in `applyPending()` (around line 222-233). The seat is applied **synchronously** (so `startHand` deals the player in immediately) — it is already gated by `canSeat`, whose `m.bankroll` is kept equal to the authoritative ledger balance (seeded from the lobby's live balance in Task 5, updated from `result.balance` on every adjust). The async ledger call only **reconciles** `bankroll` from the returned balance; the `overdraws` guard in the ledger (Tasks 2/3) is the hard backstop that prevents any negative balance:

```ts
      if (m.pending === 'seat' && m.role === 'spectator' && this.canSeat(m)) {
        m.seatSession += 1;
        m.chipStack = this.config.buyIn;
        m.role = 'seated';
        void this.chips
          .adjust({
            playerId: m.discordUserId,
            amount: -this.config.buyIn,
            type: 'buy-in',
            idempotencyKey: `${this.gameId}:buyin:${m.discordUserId}:${m.seatSession}`,
          })
          .then((r) => {
            if (r.applied) m.bankroll = r.balance;
            this.onChipBalanceChange?.(m.discordUserId, m.bankroll);
          });
        membershipChanged = true;
      } else if (m.pending === 'spectate' && m.role === 'seated') {
```

Note: only the `seat` branch body changes; the `spectate` and `leave` branches and the trailing `m.pending = null;` / `membershipChanged` handling stay exactly as they are. `m.bankroll` is set to the ledger balance on resolution; because `canSeat` already confirmed sufficient funds, `r.applied` is true in normal flow, and the ledger guard prevents a negative balance in any race.

(d) Replace `cashOut` (around line 532-542) to set bankroll from the ledger result:

```ts
  private async cashOut(m: Member): Promise<void> {
    if (m.chipStack <= 0) return;
    const amount = m.chipStack;
    m.chipStack = 0;
    const r = await this.chips.adjust({
      playerId: m.discordUserId,
      amount,
      type: 'cash-out',
      idempotencyKey: `${this.gameId}:cashout:${m.discordUserId}:${m.seatSession}`,
    });
    m.bankroll = r.balance;
    this.onChipBalanceChange?.(m.discordUserId, m.bankroll);
  }
```

(e) Add `viewerBankroll` to both view builders. In `currentView`, in the live-engine branch's returned object add `viewerBankroll: me?.bankroll` alongside `viewerPending`; and in `waitingView`'s returned object add `viewerBankroll: me?.bankroll` alongside `viewerPending`. Concretely the live branch return becomes:

```ts
      return {
        ...base,
        spectators: this.spectatorMembers().map((m) => ({
          discordUserId: m.discordUserId,
          displayName: m.displayName,
          avatarUrl: m.avatarUrl,
        })),
        waitingForPlayers: false,
        viewerPending: me?.pending ?? null,
        viewerBankroll: me?.bankroll,
      };
```

and the `waitingView` return ends with:

```ts
      waitingForPlayers: seated.length < 2,
      viewerPending: me?.pending ?? null,
      viewerBankroll: me?.bankroll,
    };
```

- [ ] **Step 5: Run the server suite**

Run: `npm run test --workspace=packages/server`
Expected: PASS — new gating/rejection/viewerBankroll tests green; all existing tests green (authoritative fake + seeds keep buy-in→0 and cash-out→positive balances).

- [ ] **Step 6: Build the server to typecheck**

Run: `npm run build --workspace=packages/server`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/game.test.ts
git commit -m "fix(server): gate buy-ins on the ledger; authoritative bankroll + viewerBankroll

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Lobby live balance lookup + wiring (mock ledger, seed, rejoin seed)

**Files:**
- Modify: `packages/server/src/rooms/lobby.ts` (`getChipBalance`)
- Modify: `packages/server/src/index.ts` (use `InMemoryChipService` in mock mode)
- Modify: `packages/server/src/rooms/index.ts` (seed on join_lobby; seed addSpectator bankroll from the lobby)
- Modify: `packages/server/src/rooms/lobby-room.test.ts` (test `getChipBalance`)

**Interfaces:**
- Consumes: `InMemoryChipService` (Task 3); `LobbyRoom.updateChipBalance` (existing).
- Produces: `LobbyRoom.getChipBalance(playerId: string): number | undefined`.

- [ ] **Step 1: Write the failing test**

In `packages/server/src/rooms/lobby-room.test.ts`, add to the existing `describe('LobbyRoom chip balances', ...)` block:

```ts
  it('getChipBalance returns the live tracked balance, or undefined for unknown players', () => {
    const r = room();
    r.addPlayer(id('a', 3000), 'sa');
    expect(r.getChipBalance('a')).toBe(3000);
    r.updateChipBalance('a', 1200);
    expect(r.getChipBalance('a')).toBe(1200);
    expect(r.getChipBalance('nobody')).toBeUndefined();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace=packages/server -- lobby-room`
Expected: FAIL — `getChipBalance` is not a function.

- [ ] **Step 3: Implement `getChipBalance`**

In `packages/server/src/rooms/lobby.ts`, add this method next to `updateChipBalance`:

```ts
  /** The player's live (server-tracked) bankroll, or undefined if not in this lobby. */
  getChipBalance(playerId: string): number | undefined {
    return this.players.get(playerId)?.chipBalance;
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace=packages/server -- lobby-room`
Expected: PASS.

- [ ] **Step 5: Use the in-memory ledger in mock mode (entry point)**

In `packages/server/src/index.ts`, change the import line (currently importing `noopChipService`) and the `chips` selection:

```ts
import { registerSocketHandlers, noopStatsService, type ChipService, type StatsService } from './rooms/index.js';
import { InMemoryChipService } from './rooms/in-memory-chips.js';
```

```ts
const hasDb = !!process.env.DATABASE_URL;
const chips: ChipService = hasDb ? { adjust: adjustChips } : new InMemoryChipService();
```

(Remove `noopChipService` from the import since it's no longer used here.)

- [ ] **Step 6: Seed the ledger on join, and seat spectators from the live balance**

In `packages/server/src/rooms/index.ts`:

(a) In the `join_lobby` handler, after `lobbies.getOrCreate(instanceId).addPlayer(identity, socket.id);`, seed the ledger so the in-memory ledger knows the player's starting balance (no-op for the DB ledger, which lacks `seed`):

```ts
      lobbies.getOrCreate(instanceId).addPlayer(identity, socket.id);
      options.chips?.seed?.(identity.discordUserId, identity.chipBalance);
```

(b) In the `join_table` handler, seed the spectator's bankroll from the lobby's live balance (falling back to the socket's last-known balance), so a rejoining player is gated against their current chips, not a stale value:

```ts
    socket.on('join_table', () => {
      const game = gameFor(socket);
      if (!game || !socket.data.discordUserId) return;
      const live = lobbies.get(socket.data.instanceId!)?.getChipBalance(socket.data.discordUserId);
      game.addSpectator({
        discordUserId: socket.data.discordUserId,
        displayName: socket.data.displayName,
        avatarUrl: socket.data.avatarUrl,
        socketId: socket.id,
        bankroll: live ?? socket.data.chipBalance ?? 0,
      });
    });
```

- [ ] **Step 7: Verify server suite + build**

Run: `npm run test --workspace=packages/server`
Expected: PASS.

Run: `npm run build --workspace=packages/server`
Expected: exits 0 (no remaining `noopChipService` reference in `index.ts`).

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/rooms/lobby.ts packages/server/src/index.ts packages/server/src/rooms/index.ts packages/server/src/rooms/lobby-room.test.ts
git commit -m "fix(server): authoritative mock ledger + seat spectators from live balance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Client — live balance gating + rejection notice

**Files:**
- Modify: `packages/client/src/GameCanvas.tsx`
- Modify: `packages/client/src/SpectatorControls.tsx` (already greys out; ensure it reads the live bankroll)
- Modify: `packages/client/src/GameCanvas.test.tsx` (create if absent) or `packages/client/src/SpectatorControls.test.tsx`

**Interfaces:**
- Consumes: `GameState.viewerBankroll` + `sit_in_rejected` (Task 1).
- Produces: `SpectatorControls` gated on the live `viewerBankroll`; a transient on-canvas notice when `sit_in_rejected` arrives.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/SpectatorControls.test.tsx` additions — append this test to the existing file:

```ts
it('uses the live viewerBankroll to gate Join Next Hand', () => {
  // identity bankroll is high/stale (3000), but the live viewerBankroll is 100 → underfunded.
  const state = baseState({ viewerBankroll: 100 });
  render(<SpectatorControls state={state} myId="c" bankroll={3000} onSitIn={vi.fn()} onSitOut={vi.fn()} onLeave={vi.fn()} onCancelPending={vi.fn()} />);
  const btn = screen.getByRole('button', { name: /Join Next Hand/i });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('title', expect.stringMatching(/chips/i));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace=packages/client -- SpectatorControls`
Expected: FAIL — the control still uses the `bankroll` prop (3000) and is enabled.

- [ ] **Step 3: Make `SpectatorControls` prefer the live bankroll**

In `packages/client/src/SpectatorControls.tsx`, change the underfunded computation to prefer the server-pushed live balance:

```ts
  const liveBankroll = state.viewerBankroll ?? bankroll;
  const underfunded = liveBankroll < state.config.buyIn;
```

(Replace the existing `const underfunded = bankroll < state.config.buyIn;` line. Leave the rest of the component unchanged.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace=packages/client -- SpectatorControls`
Expected: PASS (the new test + all existing SpectatorControls tests, which omit `viewerBankroll` and therefore fall back to the `bankroll` prop).

- [ ] **Step 5: Wire `sit_in_rejected` + live bankroll in `GameCanvas`**

In `packages/client/src/GameCanvas.tsx`:

(a) Add a `notice` state next to the existing `result` state:

```ts
  const [result, setResult] = useState<ResultBanner | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
```

(b) Inside the effect that registers socket listeners, add a handler and register/cleanup it:

```ts
    const onRejected = (payload: { reason: string }) => {
      setNotice(payload.reason);
      window.setTimeout(() => setNotice(null), 4000);
    };

    socket.on('game_state_update', onState);
    socket.on('timer_tick', onTimer);
    socket.on('hand_result', onResult);
    socket.on('sit_in_rejected', onRejected);

    return () => {
      socket.off('game_state_update', onState);
      socket.off('timer_tick', onTimer);
      socket.off('hand_result', onResult);
      socket.off('sit_in_rejected', onRejected);
      bridge.removeAllListeners();
      game.destroy(true);
      gameRef.current = null;
    };
```

(c) Render the notice (place it just before the `<ActionBar>` render, inside the wrap `div`):

```tsx
      {notice && (
        <div style={styles.notice}>{notice}</div>
      )}
```

(d) Add the `notice` style to the `styles` object:

```ts
  notice: {
    position: 'absolute',
    top: 80,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(120,20,20,0.92)',
    border: '1px solid #ff6b6b',
    borderRadius: 10,
    padding: '10px 18px',
    fontWeight: 700,
  },
```

- [ ] **Step 6: Run the full client suite + build**

Run: `npm run test --workspace=packages/client`
Expected: PASS.

Run: `npm run build --workspace=packages/client`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/GameCanvas.tsx packages/client/src/SpectatorControls.tsx packages/client/src/SpectatorControls.test.tsx
git commit -m "fix(client): gate sit-in on live balance + show sit_in_rejected notice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full verification + documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: server + client all green. Record the counts.

- [ ] **Step 2: Run the full build**

Run: `npm run build`
Expected: all three packages exit 0.

If either gate fails, STOP and report — do not edit docs.

- [ ] **Step 3: Update `docs/ARCHITECTURE.md`**

In the chip-model / player-statistics area of `docs/ARCHITECTURE.md`, add a paragraph:

```markdown
### Chip balance authority

The chip ledger is the single source of truth for every player's balance.
`adjustChips` (DB) and `InMemoryChipService` (mock mode) share the `overdraws`
rule (`db/chip-rules.ts`) so a deduction can never drive a balance below zero —
an overdraw returns `{ applied: false }` and changes nothing. `GameRoom` gates
every buy-in (start, sit-in) on that `applied` result: a refused buy-in keeps the
player a spectator and sends `sit_in_rejected`. Each member's `bankroll` is set
from the ledger's returned `balance` (never a stale delta), pushed to the lobby
(`updateChipBalance`) and to the player's own client as `GameState.viewerBankroll`,
so chip displays and the "Join Next Hand" affordability gate are live without an
activity reload. Mock mode (`InMemoryChipService`) is seeded from each player's
identity balance on `join_lobby`; spectators (re)joining a table are gated against
the lobby's live balance (`LobbyRoom.getChipBalance`), not a stale identity value.
```

- [ ] **Step 4: Update `CLAUDE.md`**

In `CLAUDE.md`, update the **Chip model** note to record: balances can never go negative (shared `overdraws` guard in DB + in-memory ledgers); mock mode now uses an authoritative `InMemoryChipService` (seeded from identity on join) instead of a no-op; buy-ins are gated on the ledger `applied` result with a `sit_in_rejected` message; `bankroll` comes from the ledger `balance` and is pushed live via `viewerBankroll` + `updateChipBalance`.

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md CLAUDE.md
git commit -m "docs: chip balance authority (non-negative ledger, live balance)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Negative-balance prevention → Task 2 (DB guard) + Task 3 (in-memory guard) + Task 4 (gate buy-ins on `applied`). Silent join failure / "no indicator" → Task 4 (`sit_in_rejected` on pre-check and ledger refusal) + Task 6 (notice + live grey-out). Stale/live chips → Task 4 (`bankroll = result.balance`, `viewerBankroll`) + Task 5 (mock ledger authoritative, seed on join, rejoin seeded from live balance) + Task 6 (client uses `viewerBankroll`). Underfunded rejoin → Task 5 (addSpectator seeded from `getChipBalance`) + Task 4 (ledger refusal).
- **Type consistency:** `overdraws(current, amount)` (T2) used in T2/T3. `ChipService.seed?` (T3) used in T4 fake, T5 wiring. `InMemoryChipService` (T3) used in T4 fake + T5 entry. `getChipBalance` (T5) used in T5 join_table. `GameState.viewerBankroll` + `sit_in_rejected` (T1) produced in T4, consumed in T6. `makeFakeChips().seed` (T4) used across seeded tests.
- **Mock-mode safety:** the authoritative fake in T4 keeps every existing balance assertion valid (buy-in 3000→0, cash-outs positive) because `makeRoom` seeds `a`/`b` to 3000 and the spectator tests seed `c`.
- **No placeholders:** every code/test step has complete code and explicit expected output.
