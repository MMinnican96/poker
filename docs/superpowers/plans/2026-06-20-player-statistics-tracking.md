# Player Statistics Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-player poker statistics from every hand into a hybrid store (append-only fact table + denormalized aggregates) and expose typed read APIs over HTTP, without building any UI.

**Architecture:** `GameRoom` observes each hand via a pure `HandStatsTracker`, assembles one fact per player at hand end, and writes through an injected `StatsService` (mirroring the existing `ChipService`, so the engine stays pure). A DB-backed service inserts facts idempotently and folds them into per-player aggregate counters via a single shared pure reducer (also used by a recompute/backfill script). A `StatsRepository` + Express `statsRouter` read the data back; ratios are derived in code, never stored.

**Tech Stack:** TypeScript (ESM/NodeNext), Drizzle ORM + Postgres (`pg` driver), Express, Socket.io, Vitest. npm-workspaces monorepo.

## Global Constraints

- **Engine stays pure / DB-free.** All capture lives in `rooms/`; the stats writer is injected like `ChipService`. Never import DB code into `engine/`.
- **`@poker/shared` is ESM (NodeNext), built to `dist/`.** Shared must be rebuilt before the server type-checks against it. Keep `shared/src` to `.ts` only. Do NOT add a `paths` alias to `shared/src` in `packages/server/tsconfig.json`.
- **Relative ESM imports use the `.js` extension** (e.g. `import { x } from './hand-stats.js'`) even though the source is `.ts`.
- **Tests live next to source as `*.test.ts`** and are excluded from the `tsc` build.
- **No new runtime dependencies.** Use what `packages/server/package.json` already has (express, drizzle-orm, pg, jsonwebtoken, socket.io).
- **Mock mode must keep working.** When `DATABASE_URL` is unset the server boots with no-op stats (no DB calls), exactly like `noopChipService`.
- **Verify every task** with `npm test` (from repo root) and `npm run build` before marking it done.
- **Chip/idempotency discipline:** per-hand fact rows are unique on `(game_id, player_id, hand_number)` and inserted with `onConflictDoNothing`, so reconnect/replay can never double-record.

---

### Task 1: Shared stat contract types

**Files:**
- Modify: `packages/shared/src/types.ts` (append at end)

**Interfaces:**
- Produces: `WonHandCategory`, `PlayerHandStat`, `PlayerStatsSummary`, `LeaderboardMetric`, `LeaderboardEntry` — consumed by every later task.

These are type-only declarations (no runtime behavior), so the verification step is a successful build rather than a unit test.

- [ ] **Step 1: Add the types**

Append to `packages/shared/src/types.ts`:

```ts
/** All winning hand tiers, including Royal Flush (an ace-high straight flush). */
export type WonHandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush'
  | 'royal-flush';

/**
 * One player's outcome for one hand — the append-only "fact" and the retrospective
 * source of truth. Produced by the server at hand end; also the shape returned by
 * the hand-history read API. `createdAt` is assigned by the DB on insert.
 */
export interface PlayerHandStat {
  gameId: string;
  playerId: string;
  handNumber: number;
  seatIndex: number;
  /** Seats clockwise from the button (0 = button). */
  position: number;
  chipsContributed: number;
  chipsWon: number;
  netResult: number;
  result: 'won' | 'lost' | 'folded';
  /** Hand shown at showdown; null if the player folded before showdown. */
  handCategory: WonHandCategory | null;
  potTotal: number;
  wentToShowdown: boolean;
  /** Voluntarily put money in pot (non-blind call/raise/all-in) pre-flop. */
  vpip: boolean;
  /** Put in a raise pre-flop. */
  pfr: boolean;
  aggressiveActions: number;
  passiveActions: number;
  wasAllIn: boolean;
  /** Last street the player was live on. */
  finalStreet: GamePhase;
  durationMs: number;
  createdAt?: string;
}

/** Metrics a leaderboard can rank by (maps to aggregate columns). */
export type LeaderboardMetric =
  | 'net_profit'
  | 'chips_won'
  | 'hands_won'
  | 'biggest_pot_won'
  | 'hands_played';

/** One ranked row of a leaderboard. */
export interface LeaderboardEntry {
  playerId: string;
  displayName: string | null;
  metric: LeaderboardMetric;
  value: number;
  rank: number;
}

/**
 * A player's lifetime stats with derived ratios computed at read time
 * (never persisted). Raw counters mirror the `player_stats` aggregate row.
 */
export interface PlayerStatsSummary {
  playerId: string;
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  chipsBet: number;
  chipsWon: number;
  chipsLost: number;
  netProfit: number;
  biggestPotWon: number;
  showdownsWon: number;
  showdownsSeen: number;
  vpipCount: number;
  pfrCount: number;
  aggressiveActions: number;
  passiveActions: number;
  categoryCounts: Partial<Record<WonHandCategory, number>>;
  totalPlayMs: number;
  gamesPlayed: number;
  // Derived ratios:
  winRate: number;
  vpip: number;
  pfr: number;
  aggressionFactor: number;
  showdownWinRate: number;
}
```

- [ ] **Step 2: Build shared and the workspace**

Run: `npm run build`
Expected: PASS — all three packages type-check (shared rebuilt to `dist/`, server still compiles).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add player statistics contract types"
```

---

### Task 2: HandStatsTracker + royal-flush detection (pure)

**Files:**
- Create: `packages/server/src/rooms/hand-stats.ts`
- Test: `packages/server/src/rooms/hand-stats.test.ts`

**Interfaces:**
- Consumes: `ActionType`, `GamePhase`, `WonHandCategory` from `@poker/shared`; `HandRank` from `../engine/hand-evaluator.js`; `rankValue` from `../engine/cards.js`.
- Produces:
  - `class HandStatsTracker` with `readonly startedAt: number`, `record(playerId: string, street: GamePhase, type: ActionType): void`, and query methods `vpip(id): boolean`, `pfr(id): boolean`, `aggressiveActions(id): number`, `passiveActions(id): number`, `wasAllIn(id): boolean`, `foldStreet(id): GamePhase | null`.
  - `royalAwareCategory(rank: HandRank): WonHandCategory`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/rooms/hand-stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Card } from '@poker/shared';
import { HandStatsTracker, royalAwareCategory } from './hand-stats.js';
import type { HandRank } from '../engine/hand-evaluator.js';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('HandStatsTracker', () => {
  it('flags VPIP and PFR from a pre-flop raise', () => {
    const t = new HandStatsTracker(1000);
    t.record('a', 'pre-flop', 'raise');
    t.record('b', 'pre-flop', 'call');
    expect(t.vpip('a')).toBe(true);
    expect(t.pfr('a')).toBe(true);
    expect(t.vpip('b')).toBe(true);
    expect(t.pfr('b')).toBe(false);
  });

  it('does not flag VPIP for a pre-flop check (big blind option)', () => {
    const t = new HandStatsTracker(1000);
    t.record('bb', 'pre-flop', 'check');
    expect(t.vpip('bb')).toBe(false);
    expect(t.pfr('bb')).toBe(false);
  });

  it('counts aggressive (raise/all-in) vs passive (call) actions', () => {
    const t = new HandStatsTracker(0);
    t.record('a', 'pre-flop', 'raise');
    t.record('a', 'flop', 'all-in');
    t.record('a', 'turn', 'call');
    expect(t.aggressiveActions('a')).toBe(2);
    expect(t.passiveActions('a')).toBe(1);
    expect(t.wasAllIn('a')).toBe(true);
  });

  it('reports the street a player folded on, or null if they never folded', () => {
    const t = new HandStatsTracker(0);
    t.record('a', 'flop', 'fold');
    expect(t.foldStreet('a')).toBe('flop');
    expect(t.foldStreet('b')).toBeNull();
  });
});

describe('royalAwareCategory', () => {
  const mk = (category: HandRank['category'], cards: Card[]): HandRank => ({
    category,
    name: category,
    score: 0,
    cards,
  });

  it('upgrades an ace-high straight flush to royal-flush', () => {
    const royal = mk('straight-flush', [
      card('10', 'spades'), card('J', 'spades'), card('Q', 'spades'),
      card('K', 'spades'), card('A', 'spades'),
    ]);
    expect(royalAwareCategory(royal)).toBe('royal-flush');
  });

  it('keeps a lower straight flush as straight-flush', () => {
    const sf = mk('straight-flush', [
      card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'),
      card('8', 'hearts'), card('9', 'hearts'),
    ]);
    expect(royalAwareCategory(sf)).toBe('straight-flush');
  });

  it('passes through non-straight-flush categories unchanged', () => {
    const flush = mk('flush', [
      card('2', 'clubs'), card('5', 'clubs'), card('8', 'clubs'),
      card('J', 'clubs'), card('K', 'clubs'),
    ]);
    expect(royalAwareCategory(flush)).toBe('flush');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hand-stats`
Expected: FAIL — `Cannot find module './hand-stats.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/rooms/hand-stats.ts`:

```ts
import type { ActionType, GamePhase, WonHandCategory } from '@poker/shared';
import { rankValue } from '../engine/cards.js';
import type { HandRank } from '../engine/hand-evaluator.js';

interface RecordedAction {
  playerId: string;
  street: GamePhase;
  type: ActionType;
}

/**
 * Accumulates the per-action facts a hand's final state cannot reconstruct
 * (VPIP, PFR, aggression, fold street). Pure: no I/O, fully unit-tested.
 * Create one per hand; call `record` after each *applied* action.
 */
export class HandStatsTracker {
  readonly startedAt: number;
  private readonly actions: RecordedAction[] = [];

  constructor(startedAt: number) {
    this.startedAt = startedAt;
  }

  record(playerId: string, street: GamePhase, type: ActionType): void {
    this.actions.push({ playerId, street, type });
  }

  private forPlayer(playerId: string): RecordedAction[] {
    return this.actions.filter((a) => a.playerId === playerId);
  }

  /** Voluntarily put money in pre-flop (call/raise/all-in; blinds aren't recorded). */
  vpip(playerId: string): boolean {
    return this.forPlayer(playerId).some(
      (a) => a.street === 'pre-flop' && (a.type === 'call' || a.type === 'raise' || a.type === 'all-in'),
    );
  }

  /** Raised pre-flop. (An all-in pre-flop is treated as a raise.) */
  pfr(playerId: string): boolean {
    return this.forPlayer(playerId).some(
      (a) => a.street === 'pre-flop' && (a.type === 'raise' || a.type === 'all-in'),
    );
  }

  aggressiveActions(playerId: string): number {
    return this.forPlayer(playerId).filter((a) => a.type === 'raise' || a.type === 'all-in').length;
  }

  passiveActions(playerId: string): number {
    return this.forPlayer(playerId).filter((a) => a.type === 'call').length;
  }

  wasAllIn(playerId: string): boolean {
    return this.forPlayer(playerId).some((a) => a.type === 'all-in');
  }

  foldStreet(playerId: string): GamePhase | null {
    const fold = this.forPlayer(playerId).find((a) => a.type === 'fold');
    return fold ? fold.street : null;
  }
}

/**
 * Map an engine hand rank to a stat category, upgrading an ace-high straight
 * flush (10-J-Q-K-A) to `royal-flush`. The engine itself has no royal-flush tier.
 */
export function royalAwareCategory(rank: HandRank): WonHandCategory {
  if (rank.category === 'straight-flush') {
    const values = rank.cards.map((c) => rankValue(c.rank)).sort((a, b) => a - b);
    if (values[0] === 10 && values[values.length - 1] === 14) return 'royal-flush';
  }
  return rank.category;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- hand-stats`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/rooms/hand-stats.ts packages/server/src/rooms/hand-stats.test.ts
git commit -m "feat(server): pure HandStatsTracker + royal-flush detection"
```

---

### Task 3: buildHandFacts (pure assembly)

**Files:**
- Modify: `packages/server/src/rooms/hand-stats.ts` (add function + helper)
- Modify: `packages/server/src/rooms/hand-stats.test.ts` (add tests)

**Interfaces:**
- Consumes: `GameState`, `PlayerHandStat`, `GamePhase` from `@poker/shared`; `ShowdownResult` from `../engine/showdown.js`; `HandStatsTracker`, `royalAwareCategory` from this file.
- Produces: `buildHandFacts(input: { state: GameState; result: ShowdownResult; tracker: HandStatsTracker; gameId: string; handNumber: number; now: number }): PlayerHandStat[]`.

`now` is injected (not `Date.now()` inside) so the duration is deterministic in tests.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/rooms/hand-stats.test.ts`:

```ts
import { buildHandFacts } from './hand-stats.js';
import type { GameState, GamePlayer } from '@poker/shared';
import type { ShowdownResult } from '../engine/showdown.js';

function seat(over: Partial<GamePlayer>): GamePlayer {
  return {
    discordUserId: 'x', displayName: 'X', avatarUrl: '', seatIndex: 0,
    chipStack: 0, betThisRound: 0, totalBetThisHand: 0, holeCards: null,
    status: 'active', hasActed: true, ...over,
  };
}

function baseState(players: GamePlayer[]): GameState {
  return {
    gameId: 'G', instanceId: 'I', phase: 'hand-complete', players,
    communityCards: [], pots: [], currentPlayerIndex: 0, dealerIndex: 0,
    smallBlindIndex: 0, bigBlindIndex: 1, callAmount: 0, minRaise: 50,
    handNumber: 1, config: { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9 },
  };
}

describe('buildHandFacts', () => {
  it('records a fold-out: winner won, folder folded, no showdown category', () => {
    const players = [
      seat({ discordUserId: 'a', seatIndex: 0, totalBetThisHand: 25, status: 'folded' }),
      seat({ discordUserId: 'b', seatIndex: 1, totalBetThisHand: 50, status: 'active' }),
    ];
    const state = baseState(players);
    const result: ShowdownResult = {
      awards: [{ amount: 75, winnerIds: ['b'] }],
      winningsByPlayer: { b: 75 },
      hands: {},
    };
    const tracker = new HandStatsTracker(0);
    tracker.record('a', 'pre-flop', 'fold');

    const facts = buildHandFacts({ state, result, tracker, gameId: 'G', handNumber: 1, now: 5000 });
    const a = facts.find((f) => f.playerId === 'a')!;
    const b = facts.find((f) => f.playerId === 'b')!;

    expect(a.result).toBe('folded');
    expect(a.handCategory).toBeNull();
    expect(a.netResult).toBe(-25);
    expect(a.finalStreet).toBe('pre-flop');
    expect(b.result).toBe('won');
    expect(b.chipsWon).toBe(75);
    expect(b.netResult).toBe(25);
    expect(b.wentToShowdown).toBe(false);
    expect(b.potTotal).toBe(75);
    expect(b.durationMs).toBe(5000);
  });

  it('records a multiway showdown with category and showdown flag', () => {
    const players = [
      seat({ discordUserId: 'a', seatIndex: 0, totalBetThisHand: 100, status: 'active' }),
      seat({ discordUserId: 'b', seatIndex: 1, totalBetThisHand: 100, status: 'active' }),
    ];
    const state = baseState(players);
    state.communityCards = [
      { rank: '2', suit: 'clubs' }, { rank: '7', suit: 'hearts' },
      { rank: '9', suit: 'spades' }, { rank: 'J', suit: 'diamonds' },
      { rank: 'K', suit: 'clubs' },
    ];
    const result: ShowdownResult = {
      awards: [{ amount: 200, winnerIds: ['a'] }],
      winningsByPlayer: { a: 200 },
      hands: {
        a: { category: 'pair', name: 'Pair', score: 1, cards: [] },
        b: { category: 'high-card', name: 'High Card', score: 0, cards: [] },
      },
    };
    const facts = buildHandFacts({ state, result, tracker: new HandStatsTracker(0), gameId: 'G', handNumber: 1, now: 0 });
    const a = facts.find((f) => f.playerId === 'a')!;
    const b = facts.find((f) => f.playerId === 'b')!;

    expect(a.result).toBe('won');
    expect(a.wentToShowdown).toBe(true);
    expect(a.handCategory).toBe('pair');
    expect(a.finalStreet).toBe('showdown');
    expect(b.result).toBe('lost');
    expect(b.wentToShowdown).toBe(true);
    expect(b.handCategory).toBe('high-card');
  });

  it('skips sitting-out players', () => {
    const players = [
      seat({ discordUserId: 'a', seatIndex: 0, status: 'active', totalBetThisHand: 50 }),
      seat({ discordUserId: 'c', seatIndex: 1, status: 'sitting-out' }),
    ];
    const result: ShowdownResult = { awards: [{ amount: 50, winnerIds: ['a'] }], winningsByPlayer: { a: 50 }, hands: {} };
    const facts = buildHandFacts({ state: baseState(players), result, tracker: new HandStatsTracker(0), gameId: 'G', handNumber: 1, now: 0 });
    expect(facts.map((f) => f.playerId)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hand-stats`
Expected: FAIL — `buildHandFacts is not a function` / not exported.

- [ ] **Step 3: Write the implementation**

Append to `packages/server/src/rooms/hand-stats.ts`:

```ts
import type { GameState, GamePhase, PlayerHandStat } from '@poker/shared';
import type { ShowdownResult } from '../engine/showdown.js';

/** Map a completed board's card count to the street it reached. */
function streetFromBoard(cardCount: number): GamePhase {
  if (cardCount >= 5) return 'river';
  if (cardCount === 4) return 'turn';
  if (cardCount === 3) return 'flop';
  return 'pre-flop';
}

/**
 * Assemble one PlayerHandStat per dealt-in player from the final state, the
 * showdown result, and the per-hand action tracker. Pure: `now` is injected.
 */
export function buildHandFacts(input: {
  state: GameState;
  result: ShowdownResult;
  tracker: HandStatsTracker;
  gameId: string;
  handNumber: number;
  now: number;
}): PlayerHandStat[] {
  const { state, result, tracker, gameId, handNumber, now } = input;
  const seatCount = state.players.length;
  const potTotal = result.awards.reduce((sum, a) => sum + a.amount, 0);
  const facts: PlayerHandStat[] = [];

  for (const p of state.players) {
    if (p.status === 'sitting-out') continue;

    const chipsWon = result.winningsByPlayer[p.discordUserId] ?? 0;
    const chipsContributed = p.totalBetThisHand;
    const folded = p.status === 'folded';
    const wentToShowdown = p.discordUserId in result.hands;
    const resultKind: PlayerHandStat['result'] = chipsWon > 0 ? 'won' : folded ? 'folded' : 'lost';
    const handCategory = wentToShowdown ? royalAwareCategory(result.hands[p.discordUserId]) : null;

    const foldStreet = tracker.foldStreet(p.discordUserId);
    const finalStreet: GamePhase =
      folded && foldStreet ? foldStreet
      : wentToShowdown ? 'showdown'
      : streetFromBoard(state.communityCards.length);

    facts.push({
      gameId,
      playerId: p.discordUserId,
      handNumber,
      seatIndex: p.seatIndex,
      position: (p.seatIndex - state.dealerIndex + seatCount) % seatCount,
      chipsContributed,
      chipsWon,
      netResult: chipsWon - chipsContributed,
      result: resultKind,
      handCategory,
      potTotal,
      wentToShowdown,
      vpip: tracker.vpip(p.discordUserId),
      pfr: tracker.pfr(p.discordUserId),
      aggressiveActions: tracker.aggressiveActions(p.discordUserId),
      passiveActions: tracker.passiveActions(p.discordUserId),
      wasAllIn: tracker.wasAllIn(p.discordUserId) || p.status === 'all-in',
      finalStreet,
      durationMs: now - tracker.startedAt,
    });
  }

  return facts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- hand-stats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/rooms/hand-stats.ts packages/server/src/rooms/hand-stats.test.ts
git commit -m "feat(server): assemble per-hand player stat facts"
```

---

### Task 4: StatsService interface + GameRoom wiring

**Files:**
- Modify: `packages/server/src/rooms/game.ts`
- Modify: `packages/server/src/rooms/game.test.ts`

**Interfaces:**
- Consumes: `HandStatsTracker`, `buildHandFacts` from `./hand-stats.js`; `PlayerHandStat` from `@poker/shared`.
- Produces:
  - `interface StatsService { recordHand(facts: PlayerHandStat[]): Promise<void>; recordSession(input: { gameId: string; players: { playerId: string; playMs: number }[] }): Promise<void>; }`
  - `const noopStatsService: StatsService`
  - `GameRoomOptions.stats?: StatsService`

- [ ] **Step 1: Write the failing test**

Add a fake stats service helper and tests to `packages/server/src/rooms/game.test.ts`. Insert this helper after `makeFakeChips` (around line 54):

```ts
import type { PlayerHandStat } from '@poker/shared';
import { type StatsService } from './game.js';

/** Fake stats service recording every recordHand/recordSession call. */
function makeFakeStats() {
  const hands: PlayerHandStat[][] = [];
  const sessions: { gameId: string; players: { playerId: string; playMs: number }[] }[] = [];
  const service: StatsService = {
    async recordHand(facts) { hands.push(facts); },
    async recordSession(input) { sessions.push(input); },
  };
  return { hands, sessions, service };
}
```

Update `makeRoom` to accept and pass a stats service:

```ts
function makeRoom(
  io: ReturnType<typeof makeFakeIo>,
  chips: ChipService,
  timing = {},
  stats: StatsService | undefined = undefined,
) {
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

Add a new `describe` block at the end of the file:

```ts
describe('GameRoom stats', () => {
  it('records one fact per player on a fold-out', async () => {
    const io = makeFakeIo();
    const stats = makeFakeStats();
    const room = makeRoom(io, makeFakeChips().service, {}, stats.service);
    await room.start();

    const concluded = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' });
    await concluded;

    expect(stats.hands).toHaveLength(1);
    const facts = stats.hands[0];
    expect(facts.map((f) => f.playerId).sort()).toEqual(['a', 'b']);
    const winner = facts.find((f) => f.result === 'won')!;
    expect(winner.playerId).toBe('b');
    expect(winner.handNumber).toBe(1);
    expect(winner.gameId).toBe('G');
    room.stop();
  });

  it('records a session with positive play time when the game ends', async () => {
    const io = makeFakeIo();
    const stats = makeFakeStats();
    const room = makeRoom(io, makeFakeChips().service, {}, stats.service);
    await room.start();

    const concluded = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' });
    await concluded;
    room.leave('a'); // drops below 2 players -> endGame

    expect(stats.sessions).toHaveLength(1);
    expect(stats.sessions[0].gameId).toBe('G');
    expect(stats.sessions[0].players.map((p) => p.playerId).sort()).toEqual(['a', 'b']);
    expect(stats.sessions[0].players.every((p) => p.playMs >= 0)).toBe(true);
    room.stop();
  });

  it('works without a stats service (no-op default)', async () => {
    const io = makeFakeIo();
    const room = makeRoom(io, makeFakeChips().service);
    await room.start();
    const concluded = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' });
    await expect(concluded).resolves.toBeDefined();
    room.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- game.test`
Expected: FAIL — `StatsService` not exported / `recordHand` never called.

- [ ] **Step 3: Add the StatsService interface and no-op**

In `packages/server/src/rooms/game.ts`, add the import near the top imports:

```ts
import type { PlayerHandStat } from '@poker/shared';
import { HandStatsTracker, buildHandFacts } from './hand-stats.js';
```

After the `noopChipService` definition (around line 42), add:

```ts
/** Atomic, idempotent stats writer. Production binds this to the DB; tests fake it. */
export interface StatsService {
  recordHand(facts: PlayerHandStat[]): Promise<void>;
  recordSession(input: {
    gameId: string;
    players: { playerId: string; playMs: number }[];
  }): Promise<void>;
}

/** No-op stats writer (dev/mock mode, lobby-only tests). */
export const noopStatsService: StatsService = {
  async recordHand() {},
  async recordSession() {},
};
```

- [ ] **Step 4: Wire the service, tracker, and session timing into GameRoom**

In `GameRoomOptions` add the field:

```ts
  chips?: ChipService;
  stats?: StatsService;
```

In the `Seat` interface add a join timestamp and captured play time:

```ts
interface Seat {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  socketId: string;
  chipStack: number;
  left: boolean;
  disconnected: boolean;
  joinedAt: number;
  playMs?: number;
}
```

Add private fields next to `private readonly chips: ChipService;`:

```ts
  private readonly stats: StatsService;
  private tracker: HandStatsTracker | null = null;
```

In the constructor, set the service and stamp join times. Replace the `this.chips = ...` line region and the `this.seats = ...` mapping:

```ts
    this.chips = opts.chips ?? noopChipService;
    this.stats = opts.stats ?? noopStatsService;
```

```ts
    const now = Date.now();
    this.seats = opts.players.map((p) => ({
      ...p,
      chipStack: 0,
      left: false,
      disconnected: false,
      joinedAt: now,
    }));
```

In `startHand()`, create a tracker right after `this.handInProgress = true;`:

```ts
    this.handInProgress = true;
    this.tracker = new HandStatsTracker(Date.now());
```

In `handleAction`, record the applied action. Replace the body so the street is captured *before* `act` mutates the phase:

```ts
  handleAction(playerId: string, action: PlayerAction): void {
    if (!this.ctx || !this.handInProgress) return;
    const street = this.ctx.state.phase;
    const result = act(this.ctx, playerId, action);
    if (!result.ok) {
      this.emitToPlayer(playerId, 'action_rejected', { reason: result.reason });
      return;
    }
    this.tracker?.record(playerId, street, action.type);
    this.clearTurnTimer();
    this.afterAction();
  }
```

In `concludeHand()`, after the `hand_result` emit (right before `this.scheduleNextHand();`), record the facts:

```ts
    if (this.tracker) {
      const facts = buildHandFacts({
        state,
        result,
        tracker: this.tracker,
        gameId: this.gameId,
        handNumber: this.handNumber,
        now: Date.now(),
      });
      void this.stats.recordHand(facts).catch((err) =>
        console.error('[stats] recordHand failed:', err),
      );
    }

    this.scheduleNextHand();
```

In `leave()`, capture the seat's play time when it leaves. After `void this.cashOut(seat);`:

```ts
    void this.cashOut(seat);
    seat.playMs = Date.now() - seat.joinedAt;
    seat.left = true;
```

In `endGame()`, record the session for every seat that participated. Replace the body:

```ts
  private async endGame(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTurnTimer();
    if (this.nextHandTimeout) clearTimeout(this.nextHandTimeout);

    const now = Date.now();
    const sessionPlayers = this.seats.map((s) => ({
      playerId: s.discordUserId,
      playMs: s.playMs ?? now - s.joinedAt,
    }));
    await Promise.all(this.seats.filter((s) => !s.left && s.chipStack > 0).map((s) => this.cashOut(s)));
    await this.stats
      .recordSession({ gameId: this.gameId, players: sessionPlayers })
      .catch((err) => console.error('[stats] recordSession failed:', err));

    this.onEnd?.(this.gameId);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- game.test`
Expected: PASS — the three new stats tests plus all existing GameRoom tests.

- [ ] **Step 6: Full suite + build**

Run: `npm test`
Expected: PASS (existing 54 tests + new ones).
Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/rooms/game.ts packages/server/src/rooms/game.test.ts
git commit -m "feat(server): capture and record player stats from GameRoom"
```

---

### Task 5: Database schema (fact + aggregate tables)

**Files:**
- Modify: `packages/server/src/db/schema.ts`

**Interfaces:**
- Produces: `playerHandStats` and `playerStats` Drizzle tables; types `PlayerHandStatRow`, `PlayerStatsRow`.

No unit test (schema declaration). Verified by build; `db:push` is run manually against a real Postgres later.

- [ ] **Step 1: Extend the imports**

In `packages/server/src/db/schema.ts`, replace the import block's symbol list to add `boolean`, `bigint`, and `index`:

```ts
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  uuid,
  timestamp,
  jsonb,
  serial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Add the two tables**

Append before the `export type` lines at the bottom of the file:

```ts
/**
 * player_hand_stats — append-only fact table, one row per player per hand. The
 * retrospective source of truth for all statistics. `game_id` is the in-memory
 * game's uuid (no FK — the games/game_players audit tables are not written yet);
 * it groups rows and, with player_id + hand_number, forms the dedup key.
 */
export const playerHandStats = pgTable(
  'player_hand_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').notNull(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.discordUserId),
    handNumber: integer('hand_number').notNull(),
    seatIndex: integer('seat_index').notNull(),
    position: integer('position').notNull(),
    chipsContributed: integer('chips_contributed').notNull(),
    chipsWon: integer('chips_won').notNull(),
    netResult: integer('net_result').notNull(),
    result: text('result').notNull(),
    handCategory: text('hand_category'),
    potTotal: integer('pot_total').notNull(),
    wentToShowdown: boolean('went_to_showdown').notNull(),
    vpip: boolean('vpip').notNull(),
    pfr: boolean('pfr').notNull(),
    aggressiveActions: integer('aggressive_actions').notNull(),
    passiveActions: integer('passive_actions').notNull(),
    wasAllIn: boolean('was_all_in').notNull(),
    finalStreet: text('final_street').notNull(),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    handUnique: uniqueIndex('player_hand_stats_hand_unique').on(
      table.gameId,
      table.playerId,
      table.handNumber,
    ),
    playerCreatedIdx: index('player_hand_stats_player_created_idx').on(
      table.playerId,
      table.createdAt,
    ),
    gameIdx: index('player_hand_stats_game_idx').on(table.gameId),
  }),
);

/**
 * player_stats — denormalized aggregate counters, one row per player. Fast reads;
 * fully recomputable from player_hand_stats (except session-level total_play_ms /
 * games_played, which are not present in the fact table). bigint guards cumulative
 * sums against 32-bit overflow over a player's lifetime.
 */
export const playerStats = pgTable('player_stats', {
  playerId: text('player_id')
    .primaryKey()
    .references(() => players.discordUserId),
  handsPlayed: integer('hands_played').notNull().default(0),
  handsWon: integer('hands_won').notNull().default(0),
  handsLost: integer('hands_lost').notNull().default(0),
  chipsBet: bigint('chips_bet', { mode: 'number' }).notNull().default(0),
  chipsWon: bigint('chips_won', { mode: 'number' }).notNull().default(0),
  chipsLost: bigint('chips_lost', { mode: 'number' }).notNull().default(0),
  netProfit: bigint('net_profit', { mode: 'number' }).notNull().default(0),
  biggestPotWon: integer('biggest_pot_won').notNull().default(0),
  showdownsWon: integer('showdowns_won').notNull().default(0),
  showdownsSeen: integer('showdowns_seen').notNull().default(0),
  vpipCount: integer('vpip_count').notNull().default(0),
  pfrCount: integer('pfr_count').notNull().default(0),
  aggressiveActions: integer('aggressive_actions').notNull().default(0),
  passiveActions: integer('passive_actions').notNull().default(0),
  categoryCounts: jsonb('category_counts').notNull().default({}),
  totalPlayMs: bigint('total_play_ms', { mode: 'number' }).notNull().default(0),
  gamesPlayed: integer('games_played').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Add to the `export type` block at the bottom:

```ts
export type PlayerHandStatRow = typeof playerHandStats.$inferSelect;
export type PlayerStatsRow = typeof playerStats.$inferSelect;
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS — schema type-checks.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/schema.ts
git commit -m "feat(db): add player_hand_stats fact + player_stats aggregate tables"
```

---

### Task 6: Pure aggregate reducer + read shaping

**Files:**
- Create: `packages/server/src/db/stats-aggregate.ts`
- Test: `packages/server/src/db/stats-aggregate.test.ts`

**Interfaces:**
- Consumes: `PlayerHandStat`, `PlayerStatsSummary`, `WonHandCategory` from `@poker/shared`.
- Produces:
  - `interface AggregateState` (numeric counters + `categoryCounts: Record<string, number>`).
  - `emptyAggregate(): AggregateState`
  - `addFact(agg: AggregateState, fact: PlayerHandStat): AggregateState` (pure, returns new)
  - `addSession(agg: AggregateState, playMs: number): AggregateState`
  - `toPlayerStatsSummary(playerId: string, agg: AggregateState): PlayerStatsSummary`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/db/stats-aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PlayerHandStat } from '@poker/shared';
import {
  emptyAggregate,
  addFact,
  addSession,
  toPlayerStatsSummary,
} from './stats-aggregate.js';

function fact(over: Partial<PlayerHandStat>): PlayerHandStat {
  return {
    gameId: 'G', playerId: 'a', handNumber: 1, seatIndex: 0, position: 0,
    chipsContributed: 0, chipsWon: 0, netResult: 0, result: 'lost',
    handCategory: null, potTotal: 0, wentToShowdown: false, vpip: false,
    pfr: false, aggressiveActions: 0, passiveActions: 0, wasAllIn: false,
    finalStreet: 'pre-flop', durationMs: 0, ...over,
  };
}

describe('aggregate reducer', () => {
  it('accumulates a won showdown hand', () => {
    let agg = emptyAggregate();
    agg = addFact(agg, fact({
      result: 'won', chipsContributed: 100, chipsWon: 200, netResult: 100,
      potTotal: 200, wentToShowdown: true, handCategory: 'flush',
      vpip: true, pfr: true, aggressiveActions: 2, passiveActions: 1,
    }));

    expect(agg.handsPlayed).toBe(1);
    expect(agg.handsWon).toBe(1);
    expect(agg.handsLost).toBe(0);
    expect(agg.chipsBet).toBe(100);
    expect(agg.chipsWon).toBe(200);
    expect(agg.chipsLost).toBe(0);
    expect(agg.netProfit).toBe(100);
    expect(agg.biggestPotWon).toBe(200);
    expect(agg.showdownsSeen).toBe(1);
    expect(agg.showdownsWon).toBe(1);
    expect(agg.vpipCount).toBe(1);
    expect(agg.pfrCount).toBe(1);
    expect(agg.aggressiveActions).toBe(2);
    expect(agg.passiveActions).toBe(1);
    expect(agg.categoryCounts.flush).toBe(1);
  });

  it('counts folded hands as lost with chips lost = contribution', () => {
    let agg = emptyAggregate();
    agg = addFact(agg, fact({ result: 'folded', chipsContributed: 25, netResult: -25 }));
    expect(agg.handsLost).toBe(1);
    expect(agg.handsWon).toBe(0);
    expect(agg.chipsLost).toBe(25);
    expect(agg.netProfit).toBe(-25);
    expect(agg.biggestPotWon).toBe(0);
  });

  it('keeps the largest won pot', () => {
    let agg = emptyAggregate();
    agg = addFact(agg, fact({ result: 'won', potTotal: 300, chipsWon: 300, netResult: 300 }));
    agg = addFact(agg, fact({ result: 'won', potTotal: 150, chipsWon: 150, netResult: 150 }));
    expect(agg.biggestPotWon).toBe(300);
  });

  it('adds session play time and games played', () => {
    let agg = emptyAggregate();
    agg = addSession(agg, 5000);
    agg = addSession(agg, 2000);
    expect(agg.totalPlayMs).toBe(7000);
    expect(agg.gamesPlayed).toBe(2);
  });
});

describe('toPlayerStatsSummary', () => {
  it('derives ratios without dividing by zero', () => {
    const summary = toPlayerStatsSummary('a', emptyAggregate());
    expect(summary.winRate).toBe(0);
    expect(summary.vpip).toBe(0);
    expect(summary.aggressionFactor).toBe(0);
    expect(summary.showdownWinRate).toBe(0);
  });

  it('computes win rate, vpip, pfr, aggression and showdown win rate', () => {
    let agg = emptyAggregate();
    agg.handsPlayed = 10;
    agg.handsWon = 4;
    agg.vpipCount = 6;
    agg.pfrCount = 3;
    agg.aggressiveActions = 8;
    agg.passiveActions = 2;
    agg.showdownsSeen = 5;
    agg.showdownsWon = 2;
    const s = toPlayerStatsSummary('a', agg);
    expect(s.winRate).toBeCloseTo(0.4);
    expect(s.vpip).toBeCloseTo(0.6);
    expect(s.pfr).toBeCloseTo(0.3);
    expect(s.aggressionFactor).toBeCloseTo(4);
    expect(s.showdownWinRate).toBeCloseTo(0.4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stats-aggregate`
Expected: FAIL — `Cannot find module './stats-aggregate.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/db/stats-aggregate.ts`:

```ts
import type { PlayerHandStat, PlayerStatsSummary, WonHandCategory } from '@poker/shared';

/** Mutable accumulator mirroring the numeric columns of player_stats. */
export interface AggregateState {
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  chipsBet: number;
  chipsWon: number;
  chipsLost: number;
  netProfit: number;
  biggestPotWon: number;
  showdownsWon: number;
  showdownsSeen: number;
  vpipCount: number;
  pfrCount: number;
  aggressiveActions: number;
  passiveActions: number;
  categoryCounts: Record<string, number>;
  totalPlayMs: number;
  gamesPlayed: number;
}

export function emptyAggregate(): AggregateState {
  return {
    handsPlayed: 0, handsWon: 0, handsLost: 0,
    chipsBet: 0, chipsWon: 0, chipsLost: 0, netProfit: 0,
    biggestPotWon: 0, showdownsWon: 0, showdownsSeen: 0,
    vpipCount: 0, pfrCount: 0, aggressiveActions: 0, passiveActions: 0,
    categoryCounts: {}, totalPlayMs: 0, gamesPlayed: 0,
  };
}

/** Fold one hand fact into the accumulator. Returns a new object (pure). */
export function addFact(agg: AggregateState, fact: PlayerHandStat): AggregateState {
  const won = fact.result === 'won';
  const next: AggregateState = {
    ...agg,
    categoryCounts: { ...agg.categoryCounts },
    handsPlayed: agg.handsPlayed + 1,
    handsWon: agg.handsWon + (won ? 1 : 0),
    handsLost: agg.handsLost + (won ? 0 : 1),
    chipsBet: agg.chipsBet + fact.chipsContributed,
    chipsWon: agg.chipsWon + fact.chipsWon,
    chipsLost: agg.chipsLost + (won ? 0 : fact.chipsContributed),
    netProfit: agg.netProfit + fact.netResult,
    biggestPotWon: won ? Math.max(agg.biggestPotWon, fact.potTotal) : agg.biggestPotWon,
    showdownsSeen: agg.showdownsSeen + (fact.wentToShowdown ? 1 : 0),
    showdownsWon: agg.showdownsWon + (fact.wentToShowdown && won ? 1 : 0),
    vpipCount: agg.vpipCount + (fact.vpip ? 1 : 0),
    pfrCount: agg.pfrCount + (fact.pfr ? 1 : 0),
    aggressiveActions: agg.aggressiveActions + fact.aggressiveActions,
    passiveActions: agg.passiveActions + fact.passiveActions,
  };
  if (fact.handCategory) {
    next.categoryCounts[fact.handCategory] = (next.categoryCounts[fact.handCategory] ?? 0) + 1;
  }
  return next;
}

/** Fold one game session's play time into the accumulator. Returns a new object. */
export function addSession(agg: AggregateState, playMs: number): AggregateState {
  return { ...agg, totalPlayMs: agg.totalPlayMs + playMs, gamesPlayed: agg.gamesPlayed + 1 };
}

const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

/** Build a read-facing summary with derived ratios (never persisted). */
export function toPlayerStatsSummary(playerId: string, agg: AggregateState): PlayerStatsSummary {
  return {
    playerId,
    handsPlayed: agg.handsPlayed,
    handsWon: agg.handsWon,
    handsLost: agg.handsLost,
    chipsBet: agg.chipsBet,
    chipsWon: agg.chipsWon,
    chipsLost: agg.chipsLost,
    netProfit: agg.netProfit,
    biggestPotWon: agg.biggestPotWon,
    showdownsWon: agg.showdownsWon,
    showdownsSeen: agg.showdownsSeen,
    vpipCount: agg.vpipCount,
    pfrCount: agg.pfrCount,
    aggressiveActions: agg.aggressiveActions,
    passiveActions: agg.passiveActions,
    categoryCounts: agg.categoryCounts as Partial<Record<WonHandCategory, number>>,
    totalPlayMs: agg.totalPlayMs,
    gamesPlayed: agg.gamesPlayed,
    winRate: ratio(agg.handsWon, agg.handsPlayed),
    vpip: ratio(agg.vpipCount, agg.handsPlayed),
    pfr: ratio(agg.pfrCount, agg.handsPlayed),
    aggressionFactor: ratio(agg.aggressiveActions, agg.passiveActions),
    showdownWinRate: ratio(agg.showdownsWon, agg.showdownsSeen),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- stats-aggregate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/stats-aggregate.ts packages/server/src/db/stats-aggregate.test.ts
git commit -m "feat(db): pure stats aggregate reducer + summary shaping"
```

---

### Task 7: Leaderboard sort mapping (pure)

**Files:**
- Create: `packages/server/src/db/stats-leaderboard.ts`
- Test: `packages/server/src/db/stats-leaderboard.test.ts`

**Interfaces:**
- Consumes: `LeaderboardMetric`, `LeaderboardEntry` from `@poker/shared`; `PlayerStatsRow` from `./schema.js`.
- Produces:
  - `const LEADERBOARD_METRICS: LeaderboardMetric[]`
  - `metricColumn(metric: LeaderboardMetric): keyof PlayerStatsRow`
  - `rankRows(rows: { playerId: string; displayName: string | null; value: number }[], metric: LeaderboardMetric): LeaderboardEntry[]`

This isolates the metric→column mapping and 1-based ranking so they're testable without a DB; the DB query in Task 9 reuses them.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/db/stats-leaderboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LEADERBOARD_METRICS, metricColumn, rankRows } from './stats-leaderboard.js';

describe('leaderboard mapping', () => {
  it('maps every supported metric to an aggregate column', () => {
    expect(metricColumn('net_profit')).toBe('netProfit');
    expect(metricColumn('chips_won')).toBe('chipsWon');
    expect(metricColumn('hands_won')).toBe('handsWon');
    expect(metricColumn('biggest_pot_won')).toBe('biggestPotWon');
    expect(metricColumn('hands_played')).toBe('handsPlayed');
  });

  it('exposes the full supported metric list', () => {
    expect(LEADERBOARD_METRICS).toContain('net_profit');
    expect(LEADERBOARD_METRICS).toHaveLength(5);
  });

  it('assigns 1-based ranks preserving input order', () => {
    const ranked = rankRows(
      [
        { playerId: 'a', displayName: 'A', value: 500 },
        { playerId: 'b', displayName: 'B', value: 300 },
      ],
      'net_profit',
    );
    expect(ranked).toEqual([
      { playerId: 'a', displayName: 'A', metric: 'net_profit', value: 500, rank: 1 },
      { playerId: 'b', displayName: 'B', metric: 'net_profit', value: 300, rank: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stats-leaderboard`
Expected: FAIL — `Cannot find module './stats-leaderboard.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/db/stats-leaderboard.ts`:

```ts
import type { LeaderboardEntry, LeaderboardMetric } from '@poker/shared';
import type { PlayerStatsRow } from './schema.js';

export const LEADERBOARD_METRICS: LeaderboardMetric[] = [
  'net_profit',
  'chips_won',
  'hands_won',
  'biggest_pot_won',
  'hands_played',
];

const METRIC_COLUMN: Record<LeaderboardMetric, keyof PlayerStatsRow> = {
  net_profit: 'netProfit',
  chips_won: 'chipsWon',
  hands_won: 'handsWon',
  biggest_pot_won: 'biggestPotWon',
  hands_played: 'handsPlayed',
};

export function metricColumn(metric: LeaderboardMetric): keyof PlayerStatsRow {
  return METRIC_COLUMN[metric];
}

/** Attach 1-based ranks to already-sorted rows. */
export function rankRows(
  rows: { playerId: string; displayName: string | null; value: number }[],
  metric: LeaderboardMetric,
): LeaderboardEntry[] {
  return rows.map((row, i) => ({
    playerId: row.playerId,
    displayName: row.displayName,
    metric,
    value: row.value,
    rank: i + 1,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- stats-leaderboard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/stats-leaderboard.ts packages/server/src/db/stats-leaderboard.test.ts
git commit -m "feat(db): pure leaderboard metric mapping and ranking"
```

---

### Task 8: DB-backed StatsService (write side)

**Files:**
- Create: `packages/server/src/db/stats.ts`

**Interfaces:**
- Consumes: `getDb`, `schema` from `./index.js`; `addFact`, `addSession`, `emptyAggregate`, `type AggregateState` from `./stats-aggregate.js`; `StatsService` from `../rooms/game.js`; `PlayerHandStat` from `@poker/shared`; `eq`, `inArray` from `drizzle-orm`.
- Produces: `const dbStatsService: StatsService` (with `recordHand`, `recordSession`).

This is a thin DB wrapper around the (already-tested) pure reducer. It is verified by build + the manual integration check in Task 12, not a unit test (it requires a live Postgres).

- [ ] **Step 1: Write the implementation**

Create `packages/server/src/db/stats.ts`:

```ts
import { eq, inArray } from 'drizzle-orm';
import type { PlayerHandStat } from '@poker/shared';
import type { StatsService } from '../rooms/game.js';
import { getDb, schema } from './index.js';
import { addFact, addSession, emptyAggregate, type AggregateState } from './stats-aggregate.js';

/** Map a stored aggregate row to the in-memory accumulator shape. */
function rowToAggregate(row: typeof schema.playerStats.$inferSelect): AggregateState {
  return {
    handsPlayed: row.handsPlayed,
    handsWon: row.handsWon,
    handsLost: row.handsLost,
    chipsBet: row.chipsBet,
    chipsWon: row.chipsWon,
    chipsLost: row.chipsLost,
    netProfit: row.netProfit,
    biggestPotWon: row.biggestPotWon,
    showdownsWon: row.showdownsWon,
    showdownsSeen: row.showdownsSeen,
    vpipCount: row.vpipCount,
    pfrCount: row.pfrCount,
    aggressiveActions: row.aggressiveActions,
    passiveActions: row.passiveActions,
    categoryCounts: (row.categoryCounts as Record<string, number>) ?? {},
    totalPlayMs: row.totalPlayMs,
    gamesPlayed: row.gamesPlayed,
  };
}

/** Persist the accumulator back to player_stats (upsert), keeping updated_at fresh. */
async function writeAggregate(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  playerId: string,
  agg: AggregateState,
): Promise<void> {
  const values = {
    playerId,
    handsPlayed: agg.handsPlayed,
    handsWon: agg.handsWon,
    handsLost: agg.handsLost,
    chipsBet: agg.chipsBet,
    chipsWon: agg.chipsWon,
    chipsLost: agg.chipsLost,
    netProfit: agg.netProfit,
    biggestPotWon: agg.biggestPotWon,
    showdownsWon: agg.showdownsWon,
    showdownsSeen: agg.showdownsSeen,
    vpipCount: agg.vpipCount,
    pfrCount: agg.pfrCount,
    aggressiveActions: agg.aggressiveActions,
    passiveActions: agg.passiveActions,
    categoryCounts: agg.categoryCounts,
    totalPlayMs: agg.totalPlayMs,
    gamesPlayed: agg.gamesPlayed,
    updatedAt: new Date(),
  };
  await tx
    .insert(schema.playerStats)
    .values(values)
    .onConflictDoUpdate({ target: schema.playerStats.playerId, set: values });
}

/**
 * DB-backed stats writer. Each call runs in one transaction so facts and
 * aggregates never diverge. Facts are inserted idempotently (unique on
 * game_id+player_id+hand_number); only newly-inserted facts update aggregates,
 * so a replayed hand cannot double-count.
 */
export const dbStatsService: StatsService = {
  async recordHand(facts: PlayerHandStat[]): Promise<void> {
    if (facts.length === 0) return;
    const db = getDb();
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.playerHandStats)
        .values(facts.map((f) => ({
          gameId: f.gameId,
          playerId: f.playerId,
          handNumber: f.handNumber,
          seatIndex: f.seatIndex,
          position: f.position,
          chipsContributed: f.chipsContributed,
          chipsWon: f.chipsWon,
          netResult: f.netResult,
          result: f.result,
          handCategory: f.handCategory,
          potTotal: f.potTotal,
          wentToShowdown: f.wentToShowdown,
          vpip: f.vpip,
          pfr: f.pfr,
          aggressiveActions: f.aggressiveActions,
          passiveActions: f.passiveActions,
          wasAllIn: f.wasAllIn,
          finalStreet: f.finalStreet,
          durationMs: f.durationMs,
        })))
        .onConflictDoNothing({
          target: [
            schema.playerHandStats.gameId,
            schema.playerHandStats.playerId,
            schema.playerHandStats.handNumber,
          ],
        })
        .returning({
          playerId: schema.playerHandStats.playerId,
          handNumber: schema.playerHandStats.handNumber,
        });

      if (inserted.length === 0) return; // entire batch was a replay

      const insertedKeys = new Set(inserted.map((r) => `${r.playerId}:${r.handNumber}`));
      const freshFacts = facts.filter((f) => insertedKeys.has(`${f.playerId}:${f.handNumber}`));

      const playerIds = [...new Set(freshFacts.map((f) => f.playerId))];
      const existing = await tx
        .select()
        .from(schema.playerStats)
        .where(inArray(schema.playerStats.playerId, playerIds));
      const byId = new Map(existing.map((r) => [r.playerId, rowToAggregate(r)]));

      for (const f of freshFacts) {
        const current = byId.get(f.playerId) ?? emptyAggregate();
        byId.set(f.playerId, addFact(current, f));
      }
      for (const [playerId, agg] of byId) {
        await writeAggregate(tx, playerId, agg);
      }
    });
  },

  async recordSession(input): Promise<void> {
    if (input.players.length === 0) return;
    const db = getDb();
    await db.transaction(async (tx) => {
      const playerIds = input.players.map((p) => p.playerId);
      const existing = await tx
        .select()
        .from(schema.playerStats)
        .where(inArray(schema.playerStats.playerId, playerIds));
      const byId = new Map(existing.map((r) => [r.playerId, rowToAggregate(r)]));

      for (const p of input.players) {
        const current = byId.get(p.playerId) ?? emptyAggregate();
        byId.set(p.playerId, addSession(current, p.playMs));
      }
      for (const [playerId, agg] of byId) {
        await writeAggregate(tx, playerId, agg);
      }
    });
  },
};
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS — the DB service type-checks against `StatsService` and the schema.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db/stats.ts
git commit -m "feat(db): DB-backed StatsService writing facts + aggregates"
```

---

### Task 9: StatsRepository (read side)

**Files:**
- Modify: `packages/server/src/db/stats.ts`

**Interfaces:**
- Consumes: `getDb`, `schema`; `toPlayerStatsSummary`, `rowToAggregate` (export it from this file); `metricColumn`, `rankRows` from `./stats-leaderboard.js`; `desc`, `eq`, `gte`, `and` from `drizzle-orm`.
- Produces:
  - `interface StatsRepository { getPlayerStats(playerId): Promise<PlayerStatsSummary | null>; getLeaderboard(opts: { metric: LeaderboardMetric; limit: number; since?: Date }): Promise<LeaderboardEntry[]>; getPlayerHandHistory(playerId: string, opts: { limit: number; since?: Date }): Promise<PlayerHandStat[]>; }`
  - `const dbStatsRepository: StatsRepository`
  - `const noopStatsRepository: StatsRepository`

Thin DB wrappers around already-tested pure code; verified by build + Task 12 manual check.

- [ ] **Step 1: Add reader imports and export `rowToAggregate`**

At the top of `packages/server/src/db/stats.ts`, widen the drizzle import and add shared/leaderboard imports:

```ts
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  PlayerHandStat,
  PlayerStatsSummary,
} from '@poker/shared';
import { toPlayerStatsSummary } from './stats-aggregate.js';
import { metricColumn, rankRows } from './stats-leaderboard.js';
```

(Keep the existing `addFact, addSession, emptyAggregate, type AggregateState` import.) Change `function rowToAggregate` to `export function rowToAggregate`.

- [ ] **Step 2: Append the repository**

Add to the end of `packages/server/src/db/stats.ts`:

```ts
export interface StatsRepository {
  getPlayerStats(playerId: string): Promise<PlayerStatsSummary | null>;
  getLeaderboard(opts: {
    metric: LeaderboardMetric;
    limit: number;
    since?: Date;
  }): Promise<LeaderboardEntry[]>;
  getPlayerHandHistory(
    playerId: string,
    opts: { limit: number; since?: Date },
  ): Promise<PlayerHandStat[]>;
}

export const dbStatsRepository: StatsRepository = {
  async getPlayerStats(playerId) {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.playerStats)
      .where(eq(schema.playerStats.playerId, playerId));
    if (!row) return null;
    return toPlayerStatsSummary(playerId, rowToAggregate(row));
  },

  async getLeaderboard({ metric, limit, since }) {
    const db = getDb();

    // All-time: rank straight off the aggregate columns.
    if (!since) {
      const column = schema.playerStats[metricColumn(metric)];
      const rows = await db
        .select({
          playerId: schema.playerStats.playerId,
          displayName: schema.players.displayName,
          value: column,
        })
        .from(schema.playerStats)
        .leftJoin(schema.players, eq(schema.players.discordUserId, schema.playerStats.playerId))
        .orderBy(desc(column))
        .limit(limit);
      return rankRows(
        rows.map((r) => ({ playerId: r.playerId, displayName: r.displayName, value: Number(r.value) })),
        metric,
      );
    }

    // Windowed: aggregate the fact table since `since`, then rank in JS.
    const facts = await db
      .select()
      .from(schema.playerHandStats)
      .where(gte(schema.playerHandStats.createdAt, since));
    const byPlayer = new Map<string, number>();
    for (const f of facts) {
      const prev = byPlayer.get(f.playerId) ?? 0;
      byPlayer.set(f.playerId, prev + windowedMetricValue(metric, f));
    }
    const names = await db
      .select({ id: schema.players.discordUserId, displayName: schema.players.displayName })
      .from(schema.players);
    const nameById = new Map(names.map((n) => [n.id, n.displayName]));
    const sorted = [...byPlayer.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([playerId, value]) => ({ playerId, displayName: nameById.get(playerId) ?? null, value }));
    return rankRows(sorted, metric);
  },

  async getPlayerHandHistory(playerId, { limit, since }) {
    const db = getDb();
    const where = since
      ? and(eq(schema.playerHandStats.playerId, playerId), gte(schema.playerHandStats.createdAt, since))
      : eq(schema.playerHandStats.playerId, playerId);
    const rows = await db
      .select()
      .from(schema.playerHandStats)
      .where(where)
      .orderBy(desc(schema.playerHandStats.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      gameId: r.gameId,
      playerId: r.playerId,
      handNumber: r.handNumber,
      seatIndex: r.seatIndex,
      position: r.position,
      chipsContributed: r.chipsContributed,
      chipsWon: r.chipsWon,
      netResult: r.netResult,
      result: r.result as PlayerHandStat['result'],
      handCategory: r.handCategory as PlayerHandStat['handCategory'],
      potTotal: r.potTotal,
      wentToShowdown: r.wentToShowdown,
      vpip: r.vpip,
      pfr: r.pfr,
      aggressiveActions: r.aggressiveActions,
      passiveActions: r.passiveActions,
      wasAllIn: r.wasAllIn,
      finalStreet: r.finalStreet as PlayerHandStat['finalStreet'],
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
    }));
  },
};

/** Contribution of one fact to a windowed leaderboard metric. */
function windowedMetricValue(metric: LeaderboardMetric, f: typeof schema.playerHandStats.$inferSelect): number {
  switch (metric) {
    case 'net_profit': return f.netResult;
    case 'chips_won': return f.chipsWon;
    case 'hands_won': return f.result === 'won' ? 1 : 0;
    case 'biggest_pot_won': return f.result === 'won' ? f.potTotal : 0; // summed; refine later if needed
    case 'hands_played': return 1;
  }
}

/** Used in dev/mock mode (no DATABASE_URL): everything is empty. */
export const noopStatsRepository: StatsRepository = {
  async getPlayerStats() { return null; },
  async getLeaderboard() { return []; },
  async getPlayerHandHistory() { return []; },
};
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/stats.ts
git commit -m "feat(db): StatsRepository read functions + no-op variant"
```

---

### Task 10: Stats HTTP routes

**Files:**
- Create: `packages/server/src/routes/stats.ts`
- Test: `packages/server/src/routes/stats.test.ts`

**Interfaces:**
- Consumes: `StatsRepository` from `../db/stats.js`; `verifySession` from `./auth.js`; `LEADERBOARD_METRICS` from `../db/stats-leaderboard.js`; `LeaderboardMetric` from `@poker/shared`; `Router` from `express`.
- Produces: `createStatsRouter(repo: StatsRepository): Router`.

The router takes an injected repository, so tests run against a fake with no DB.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/routes/stats.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';
import type { PlayerStatsSummary, LeaderboardEntry, PlayerHandStat } from '@poker/shared';
import { createStatsRouter } from './stats.js';
import type { StatsRepository } from '../db/stats.js';

const SUMMARY: PlayerStatsSummary = {
  playerId: 'a', handsPlayed: 10, handsWon: 4, handsLost: 6, chipsBet: 1000,
  chipsWon: 1200, chipsLost: 400, netProfit: 200, biggestPotWon: 300,
  showdownsWon: 2, showdownsSeen: 5, vpipCount: 6, pfrCount: 3,
  aggressiveActions: 8, passiveActions: 2, categoryCounts: { pair: 3 },
  totalPlayMs: 60000, gamesPlayed: 2, winRate: 0.4, vpip: 0.6, pfr: 0.3,
  aggressionFactor: 4, showdownWinRate: 0.4,
};

const fakeRepo: StatsRepository = {
  async getPlayerStats(id) { return id === 'a' ? SUMMARY : null; },
  async getLeaderboard() {
    return [{ playerId: 'a', displayName: 'A', metric: 'net_profit', value: 200, rank: 1 }] as LeaderboardEntry[];
  },
  async getPlayerHandHistory() { return [] as PlayerHandStat[]; },
};

let server: Server;
let base: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  const app = express();
  app.use('/api/stats', createStatsRouter(fakeRepo));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => { server?.close(); });

function authCookie(): string {
  const token = jwt.sign({ discordUserId: 'a', displayName: 'A', avatarUrl: '' }, 'test-secret');
  return `poker_session=${token}`;
}

describe('stats routes', () => {
  it('401s without a session cookie', async () => {
    const res = await fetch(`${base}/api/stats/a`);
    expect(res.status).toBe(401);
  });

  it('returns a player summary', async () => {
    const res = await fetch(`${base}/api/stats/a`, { headers: { cookie: authCookie() } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlayerStatsSummary;
    expect(body.playerId).toBe('a');
    expect(body.winRate).toBeCloseTo(0.4);
  });

  it('404s for an unknown player', async () => {
    const res = await fetch(`${base}/api/stats/zzz`, { headers: { cookie: authCookie() } });
    expect(res.status).toBe(404);
  });

  it('returns a leaderboard with a valid metric', async () => {
    const res = await fetch(`${base}/api/stats/leaderboard?metric=net_profit&limit=5`, {
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardEntry[];
    expect(body[0].rank).toBe(1);
  });

  it('400s on an unknown leaderboard metric', async () => {
    const res = await fetch(`${base}/api/stats/leaderboard?metric=bogus`, {
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- routes/stats`
Expected: FAIL — `Cannot find module './stats.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/routes/stats.ts`:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { LeaderboardMetric } from '@poker/shared';
import { verifySession } from './auth.js';
import { LEADERBOARD_METRICS } from '../db/stats-leaderboard.js';
import type { StatsRepository } from '../db/stats.js';

/** Require a valid poker_session JWT cookie (parsed without cookie-parser). */
function requireSession(req: Request, res: Response, next: NextFunction): void {
  const cookie = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)poker_session=([^;]+)/.exec(cookie);
  if (!match) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    verifySession(decodeURIComponent(match[1]));
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseSince(raw: unknown): Date | undefined {
  if (typeof raw !== 'string') return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Read-only stats API. Injected repository keeps it DB-agnostic (a no-op repo is
 * supplied in dev/mock mode). Mounted at /api/stats.
 */
export function createStatsRouter(repo: StatsRepository): Router {
  const router = Router();
  router.use(requireSession);

  // Declared before '/:playerId' so it isn't captured as a player id.
  router.get('/leaderboard', async (req, res) => {
    const metric = (req.query.metric as string) ?? 'net_profit';
    if (!LEADERBOARD_METRICS.includes(metric as LeaderboardMetric)) {
      res.status(400).json({ error: `Unknown metric. Use one of: ${LEADERBOARD_METRICS.join(', ')}` });
      return;
    }
    const limit = parseLimit(req.query.limit, 10, 100);
    const since = parseSince(req.query.since);
    const entries = await repo.getLeaderboard({ metric: metric as LeaderboardMetric, limit, since });
    res.json(entries);
  });

  router.get('/:playerId', async (req, res) => {
    const summary = await repo.getPlayerStats(req.params.playerId);
    if (!summary) {
      res.status(404).json({ error: 'No stats for that player' });
      return;
    }
    res.json(summary);
  });

  router.get('/:playerId/hands', async (req, res) => {
    const limit = parseLimit(req.query.limit, 25, 200);
    const since = parseSince(req.query.since);
    const hands = await repo.getPlayerHandHistory(req.params.playerId, { limit, since });
    res.json(hands);
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- routes/stats`
Expected: PASS (401, 200 summary, 404, leaderboard, 400).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/stats.ts packages/server/src/routes/stats.test.ts
git commit -m "feat(server): read-only /api/stats routes"
```

---

### Task 11: Wire stats into the server + room handlers

**Files:**
- Modify: `packages/server/src/rooms/index.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: `StatsService` from `./game.js`; `dbStatsService`, `dbStatsRepository`, `noopStatsRepository` from `./db/stats.js`; `createStatsRouter` from `./routes/stats.js`.
- Produces: `SocketHandlerOptions.stats?: StatsService` threaded into each `GameRoom`.

- [ ] **Step 1: Thread the stats service through the socket handlers**

In `packages/server/src/rooms/index.ts`:

Add to the re-exports near the top:

```ts
export { GameRoom, type ChipService, type StatsService, noopChipService, noopStatsService } from './game.js';
```

Import the type in the existing game import:

```ts
import { GameRoom, type ChipService, type StatsService, type GameTiming } from './game.js';
```

Add to `SocketHandlerOptions`:

```ts
  /** Chip ledger for buy-ins/cash-outs. Production binds this to the DB. */
  chips?: ChipService;
  /** Stats writer for per-hand facts + aggregates. Production binds this to the DB. */
  stats?: StatsService;
```

In the `new GameRoom({ ... })` call inside `onGameStart`, pass the service after `chips: options.chips,`:

```ts
        chips: options.chips,
        stats: options.stats,
```

- [ ] **Step 2: Wire the concrete services + route in index.ts**

In `packages/server/src/index.ts`:

Extend the rooms import to include the stats type and no-op:

```ts
import { registerSocketHandlers, noopChipService, noopStatsService, type ChipService, type StatsService } from './rooms/index.js';
```

Extend the db import:

```ts
import { adjustChips } from './db/index.js';
import { dbStatsService } from './db/stats.js';
import { dbStatsRepository, noopStatsRepository } from './db/stats.js';
import { createStatsRouter } from './routes/stats.js';
```

Replace the chips/registration block (the `const hasDb = ...` region) with:

```ts
// With a database configured, chips + stats persist; without one the server runs
// in dev/mock mode using in-memory no-ops so it can boot without Postgres.
const hasDb = !!process.env.DATABASE_URL;
const chips: ChipService = hasDb ? { adjust: adjustChips } : noopChipService;
const stats: StatsService = hasDb ? dbStatsService : noopStatsService;
if (!hasDb) {
  console.warn('[server] DATABASE_URL not set — running without persistence (dev/mock mode).');
}
registerSocketHandlers(io, { chips, stats });
```

Mount the stats router next to the auth router (after `app.use('/api/auth', authRouter);`):

```ts
app.use('/api/stats', createStatsRouter(hasDb ? dbStatsRepository : noopStatsRepository));
```

Note: `app.use('/api/stats', ...)` must come after `const hasDb` is defined. Since the router mount currently sits above the `hasDb` block, move the `const hasDb = ...` line up to just before `app.use('/api/auth', authRouter);`, or place the stats `app.use` after the `registerSocketHandlers` block. Place the `app.use('/api/stats', ...)` line immediately after the `registerSocketHandlers(io, { chips, stats });` line (Express route registration order does not matter for non-overlapping paths).

- [ ] **Step 3: Build + full test suite**

Run: `npm run build`
Expected: PASS.
Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/rooms/index.ts packages/server/src/index.ts
git commit -m "feat(server): wire DB stats service + /api/stats router (no-op in mock mode)"
```

---

### Task 12: Recompute/backfill script

**Files:**
- Create: `packages/server/src/db/stats-recompute.ts`
- Modify: `packages/server/package.json` (add a script)

**Interfaces:**
- Consumes: `getDb`, `schema`; `emptyAggregate`, `addFact`; `rowToAggregate` from `./stats.js`; `eq` from `drizzle-orm`.
- Produces: `recomputeAllPlayerStats(): Promise<{ players: number; facts: number }>` and a CLI entry.

Rebuilds the hand-derived columns of `player_stats` from `player_hand_stats`. `total_play_ms`/`games_played` are session-level (not in the fact table) and are preserved.

- [ ] **Step 1: Write the implementation**

Create `packages/server/src/db/stats-recompute.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { PlayerHandStat } from '@poker/shared';
import { getDb, schema } from './index.js';
import { emptyAggregate, addFact, type AggregateState } from './stats-aggregate.js';
import { rowToAggregate } from './stats.js';

/** Convert a stored fact row to the PlayerHandStat shape the reducer expects. */
function rowToFact(r: typeof schema.playerHandStats.$inferSelect): PlayerHandStat {
  return {
    gameId: r.gameId,
    playerId: r.playerId,
    handNumber: r.handNumber,
    seatIndex: r.seatIndex,
    position: r.position,
    chipsContributed: r.chipsContributed,
    chipsWon: r.chipsWon,
    netResult: r.netResult,
    result: r.result as PlayerHandStat['result'],
    handCategory: r.handCategory as PlayerHandStat['handCategory'],
    potTotal: r.potTotal,
    wentToShowdown: r.wentToShowdown,
    vpip: r.vpip,
    pfr: r.pfr,
    aggressiveActions: r.aggressiveActions,
    passiveActions: r.passiveActions,
    wasAllIn: r.wasAllIn,
    finalStreet: r.finalStreet as PlayerHandStat['finalStreet'],
    durationMs: r.durationMs,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Rebuild every player's hand-derived aggregates from the fact table.
 * Session columns (total_play_ms, games_played) are read from the existing row
 * and carried over, since they cannot be reconstructed from facts.
 */
export async function recomputeAllPlayerStats(): Promise<{ players: number; facts: number }> {
  const db = getDb();
  const facts = await db.select().from(schema.playerHandStats);

  const byPlayer = new Map<string, AggregateState>();
  for (const row of facts) {
    const current = byPlayer.get(row.playerId) ?? emptyAggregate();
    byPlayer.set(row.playerId, addFact(current, rowToFact(row)));
  }

  for (const [playerId, agg] of byPlayer) {
    const [existing] = await db
      .select()
      .from(schema.playerStats)
      .where(eq(schema.playerStats.playerId, playerId));
    const session = existing ? rowToAggregate(existing) : emptyAggregate();

    const merged: AggregateState = {
      ...agg,
      totalPlayMs: session.totalPlayMs, // session-level: preserved
      gamesPlayed: session.gamesPlayed,
    };

    const values = {
      playerId,
      handsPlayed: merged.handsPlayed,
      handsWon: merged.handsWon,
      handsLost: merged.handsLost,
      chipsBet: merged.chipsBet,
      chipsWon: merged.chipsWon,
      chipsLost: merged.chipsLost,
      netProfit: merged.netProfit,
      biggestPotWon: merged.biggestPotWon,
      showdownsWon: merged.showdownsWon,
      showdownsSeen: merged.showdownsSeen,
      vpipCount: merged.vpipCount,
      pfrCount: merged.pfrCount,
      aggressiveActions: merged.aggressiveActions,
      passiveActions: merged.passiveActions,
      categoryCounts: merged.categoryCounts,
      totalPlayMs: merged.totalPlayMs,
      gamesPlayed: merged.gamesPlayed,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.playerStats)
      .values(values)
      .onConflictDoUpdate({ target: schema.playerStats.playerId, set: values });
  }

  return { players: byPlayer.size, facts: facts.length };
}

// CLI: `npm run stats:recompute`
if (import.meta.url === `file://${process.argv[1]}`) {
  recomputeAllPlayerStats()
    .then((r) => {
      console.log(`[stats] recomputed ${r.players} players from ${r.facts} facts`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[stats] recompute failed:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Add the npm script**

In `packages/server/package.json`, add to `scripts` (after `"db:studio"`):

```json
    "db:studio": "drizzle-kit studio",
    "stats:recompute": "tsx src/db/stats-recompute.ts"
```

(Ensure the preceding line keeps its trailing comma.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/stats-recompute.ts packages/server/package.json
git commit -m "feat(db): recompute player_stats aggregates from fact table"
```

---

### Task 13: Final verification + docs touch-up

**Files:**
- Modify: `CLAUDE.md` (Status / Deferred sections)

- [ ] **Step 1: Run the full suite and build**

Run: `npm test`
Expected: PASS — original 54 tests plus the new hand-stats, aggregate, leaderboard, GameRoom-stats, and route tests.
Run: `npm run build`
Expected: PASS (all three packages).

- [ ] **Step 2: Update CLAUDE.md**

In the **Deferred / not yet done** section, remove nothing but add a completed note under **Status** (the audit-table persistence remains deferred). Replace the deferred bullet:

```
- Persisting hand history to the audit tables.
```

with:

```
- Persisting hand history to the games/hands audit tables (separate from the
  player_hand_stats fact table, which IS written).
```

And add to the **Status** paragraph area a line noting statistics tracking is implemented:

```
Player statistics tracking (per-hand fact table + per-player aggregates + read
APIs at `/api/stats`) is implemented; see
`docs/superpowers/specs/2026-06-20-player-statistics-tracking-design.md`.
```

- [ ] **Step 3: Manual DB integration check (requires local Postgres + `DATABASE_URL`)**

This is the verification path for the DB-only code (Tasks 8, 9, 12) that unit tests can't cover.

Run: `npm run db:push` (from `packages/server`) — syncs the two new tables.
Then play a full mock-but-DB session (set `DATABASE_URL`, `npm run dev`, two tabs), finish at least one hand and end a game, and confirm:
- `select count(*) from player_hand_stats;` > 0
- `select * from player_stats;` shows incremented counters
- `curl --cookie "poker_session=<jwt>" localhost:3001/api/stats/<discordUserId>` returns a summary
- `npm run stats:recompute` reports a non-zero players/facts count and leaves `player_stats` consistent.

(If no Postgres is available in this environment, note it and defer this step to the user — the unit-tested pure layer plus `npm run build` already cover the logic.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note player statistics tracking is implemented"
```

---

## Self-Review Notes

- **Spec coverage:** fact table (Task 5) ✓; aggregate table (Task 5) ✓; injected `StatsService` + capture in `GameRoom` incl. VPIP/PFR/aggression/final-street/play-time (Tasks 2–4) ✓; royal-flush detection (Task 2) ✓; idempotent writes (Task 8, unique key + only-inserted aggregation) ✓; recompute/backfill (Task 12) ✓; `StatsRepository` + derived ratios (Tasks 6, 9) ✓; HTTP routes w/ auth + mock-mode no-op (Tasks 9–11) ✓; shared contracts (Task 1) ✓; tests next to source ✓. Leaderboard/stats/challenge UIs intentionally excluded ✓.
- **`game_id` no-FK** decision honored in Task 5 (uuid column, no `.references`).
- **DB-only code** (Tasks 8, 9, 12) is intentionally thin over the unit-tested pure layer (Tasks 2, 3, 6, 7) and verified via build + the Task 13 manual integration check.
