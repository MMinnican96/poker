# Architecture

## Overview

A Discord Activity poker game built as an npm-workspaces monorepo. The **server is
the single source of truth** for all game state; clients render what they're told
and send action intents. Real-time communication is over Socket.io; the poker
rules live in a pure, fully-tested engine with no I/O.

```
┌────────────────────────── Discord client (iframe) ──────────────────────────┐
│  React + Phaser 3                                                            │
│  ┌───────────┐   Embedded App SDK   ┌──────────────┐   Socket.io (ws)        │
│  │  Lobby UI │◄────── identity ─────│  GameCanvas  │◄───────────────┐        │
│  │  (React)  │                      │  (Phaser)    │                │        │
│  └───────────┘                      └──────────────┘                │        │
└──────────────────────────────────────────────────────────────────── │ ──────┘
                      │ POST /api/auth/token (OAuth code)               │
                      ▼                                                 ▼
┌───────────────────────────────── Server (Node) ─────────────────────────────┐
│  Express (auth) + Socket.io                                                  │
│   ┌────────────┐   ┌──────────────┐   ┌──────────────────────────────────┐  │
│   │ auth route │   │ LobbyManager │   │ GameRoom  ── drives ──► Engine    │  │
│   │ (Discord + │   │ (per         │   │ (per instanceId)       (pure TS)  │  │
│   │  JWT + DB) │   │  instanceId) │   │  turn timer, chips, sanitization  │  │
│   └─────┬──────┘   └──────────────┘   └────────────────┬─────────────────┘  │
└─────────│──────────────────────────────────────────────│────────────────────┘
          ▼ Drizzle ORM                                   ▼ ChipService
   ┌──────────────┐                              ┌──────────────────────┐
   │  PostgreSQL  │  players, chip_transactions  │ adjustChips (atomic, │
   │              │  (+ audit tables)            │ idempotent ledger)   │
   └──────────────┘                              └──────────────────────┘
```

## Monorepo layout

```
packages/
├── shared/   # TypeScript types + Socket.io event contracts (no runtime deps)
│   └── src/{types,events}.ts
├── server/   # Node + Express + Socket.io + Drizzle
│   └── src/
│       ├── index.ts          # HTTP + Socket.io bootstrap
│       ├── routes/{auth,stats}.ts  # Discord OAuth → JWT session; read-only /api/stats
│       ├── discord.ts         # Discord HTTP helpers (server-side only)
│       ├── db/               # schema, pool + adjustChips, and the stats layer
│       │   └── {schema,index,stats,stats-aggregate,stats-leaderboard,stats-recompute}.ts
│       ├── engine/            # pure poker rules (see below)
│       └── rooms/             # LobbyManager, GameRoom, hand-stats, state sanitization
└── client/   # React + Phaser 3 (the Activity iframe)
    └── src/
        ├── index.css          # Tailwind v4 @import + @theme design tokens + keyframes
        ├── discord.ts         # SDK handshake (+ dev mock)
        ├── socket.ts          # typed Socket.io client
        ├── App.tsx, ActionBar.tsx, GameCanvas.tsx
        ├── lobby/             # Lobby screen components (see below)
        └── game/              # Phaser scene + React↔Phaser bridge
```

`@poker/shared` is the contract glued to both ends: it defines `GameState`,
`LobbyState`, `Card`, `TableConfig`, and the typed Socket.io event maps, so the
client and server can never drift on the wire format.

## Client lobby components

The lobby UI lives in `packages/client/src/lobby/` and was built with
**Tailwind CSS v4** (CSS-first config via `@tailwindcss/vite`). Design tokens
(colors, shadows, radii, fonts, animations) are declared in a single `@theme` block
in `src/index.css`; see [`docs/DESIGN_STANDARDS.md`](./DESIGN_STANDARDS.md) for the
full token table and component patterns.

```
lobby/
  LobbyScreen.tsx        # Top-level: owns socket subscription, tab + modal state, layout
  Header.tsx             # Logo, nav tabs (Home / Leaderboard / Stats / Shop), user button
  PlayersPanel.tsx       # Left aside: players list + count badge
  PlayerRow.tsx          # One clickable player row; exports playerStatus() + STATUS_STYLE
  TableSettings.tsx      # Center Home tab: steppers, status pills, action buttons
  ComingSoon.tsx         # Reusable Coming Soon placeholder (Leaderboard / Stats / Shop)
  RecentActivity.tsx     # Right rail: scaffolded feed (empty state; hidden below 1080px)
  UserPopout.tsx         # Top-right popout: Profile / Settings (Coming Soon) / How to Play
  PlayerProfileModal.tsx # Quick-view stats for a clicked player
  StatTile.tsx           # Shared stat tile; renders "—" when value is null
  useStats.ts            # Hook: fetch /api/stats/:id; sample data in mock mode
```

**`LobbyScreen`** owns the `lobby_state_update` / `game_start` subscription (moved
from the old `Lobby.tsx`, which is deleted), the countdown tick, and local UI state:
`activeTab`, `userPopoutOpen`, `selectedPlayerId`. It computes derived values
(`isHost`, `readyCount`, `canEditConfig`, `secondsLeft`, per-player status) and
passes them down as props.

**Tabs:** Home shows full content (`TableSettings` + panels). Leaderboard, Stats, and
Shop render `<ComingSoon />` — the data exists on the server but is out of scope for
the current lobby implementation; quick-view stat tiles in the popout and modal still
show real (or mock-mode sample) data.

**`useStats(playerId)`** returns `{ stats: PlayerStatsSummary | null, loading }`.
In mock mode it returns deterministic sample data seeded from a hash of `playerId`
(no fetch). In real mode it calls `GET /api/stats/:id` with session credentials; on
non-OK / network error it returns `null` and the UI shows `—` placeholders.

### Deferred lobby UI features

The following are intentionally deferred and shown as Coming Soon / disabled:

- Player **titles** and **levels** (no backend concept yet).
- **Shop** tab — no items or purchases.
- **Leaderboard** and **Stats** tab data — routes exist; UI content deferred.
- **Friends / Add Friend** — removed from the design.
- **Recent Activity** — scaffold and empty-state only; no data written.
- **User Settings** toggles — Settings sub-tab shows a Coming Soon placeholder.
- **View Profile** full page — button present but disabled.
- **Log Out** — visual only.
- Per-player **In-Game** status while others remain in the lobby (the current
  architecture transitions the whole lobby at once; only `lobby.status === 'in-game'`
  maps to the In-Game pill).

## Data flow

1. **Identity** — The client runs the Discord Embedded App SDK handshake, gets an
   OAuth `code`, and POSTs it to `/api/auth/token`. The server exchanges the code,
   uses the **bot token** to fetch the player's server nickname + guild avatar,
   upserts the `players` row (seeding 10,000 chips on first login), and returns a
   JWT session cookie + the trusted identity. The client never self-reports
   identity to the game.
2. **Lobby** — The client opens a Socket.io connection and emits `join_lobby` with
   `{ instanceId, identity }`. The `LobbyManager` keys a room by Discord
   `instanceId`, so everyone in the same Activity session shares a lobby.
3. **Game** — When a countdown completes with ≥2 funded players, a `GameRoom` is
   created. It owns the engine `HandContext`, broadcasts per-viewer sanitized
   state, and routes player actions.

## Socket.io event reference

Defined in [`packages/shared/src/events.ts`](../packages/shared/src/events.ts).

### Server → Client

| Event | Payload | Meaning |
|---|---|---|
| `lobby_state_update` | `LobbyState` | Full lobby snapshot (players, ready, config, status, `activeGame`) |
| `countdown_start` | `{ endsAt }` | Pre-game countdown started (absolute epoch ms) |
| `countdown_cancel` | — | Countdown aborted (cancelled or under-funded at expiry) |
| `game_start` | `{ gameId }` | A game session has begun (host-path only; clients switch on `joined_table`) |
| `joined_table` | `{ gameId, role }` | Client should mount the table UI with the given role |
| `left_table` | — | Client should return to the lobby |
| `game_state_update` | `GameState` | Per-viewer sanitized table state |
| `timer_tick` | `{ playerId, remainingMs }` | Live turn-timer broadcast (~every 500ms) |
| `action_rejected` | `{ reason }` | Your last action was illegal |
| `hand_result` | `{ winnerIds, potAmount, handName?, finalState }` | Hand concluded; cards revealed |

### Client → Server

| Event | Payload | Meaning |
|---|---|---|
| `join_lobby` | `{ instanceId, identity }` | Join/reconnect to a lobby (and any running game) |
| `player_ready` / `player_unready` | — | Toggle ready state |
| `start_countdown` | — | Begin the countdown (needs ≥2 ready) |
| `cancel_countdown` | — | Cancel the countdown (ready players only) |
| `update_config` | `Partial<TableConfig>` | Host-only, before anyone readies |
| `player_action` | `PlayerAction` | `fold` / `check` / `call` / `raise{amount}` / `all-in` |
| `join_table` | — | Spectate a running game |
| `sit_in` | — | Queue spectator→seated transition (resolves at next hand boundary) |
| `sit_out` | — | Queue seated→spectator transition (resolves at next hand boundary) |
| `cancel_pending` | — | Cancel a queued `sit_in` / `sit_out` / `leave_table` |
| `leave_table` | — | Leave the table (deferred to hand end if seated; immediate if spectator) |

## Poker engine (`server/src/engine/`)

Pure functions, zero I/O, exhaustively unit-tested. The **deck is never part of
`GameState`** — it lives in the server-only `HandContext`, so cards can't leak.

| Module | Responsibility |
|---|---|
| `cards.ts` / `deck.ts` | Ranks/suits, Fisher-Yates shuffle (injectable RNG), deal |
| `hand-evaluator.ts` | 5-card eval + best-of-7, monotonic comparable score |
| `pot.ts` | Side-pot construction by contribution layer |
| `blinds.ts` | Blind positions (heads-up aware), posting |
| `actions.ts` | `validateAction` / `applyActionToState` (min-raise, all-in rules) |
| `game-state.ts` | `startHand`, `act`, street transitions, all-in run-out |
| `showdown.ts` | Winner determination, split + side pots, odd-chip rule |

State machine: `WAITING → PRE_FLOP → FLOP → TURN → RIVER → SHOWDOWN → HAND_COMPLETE`.

## Server authority & state sanitization

The `GameRoom` is the only mutator of game state. Before broadcasting, every
update passes through `viewFor(state, viewerId)`
([`rooms/state-view.ts`](../packages/server/src/rooms/state-view.ts)):

- you always see **your own** hole cards;
- opponents' hole cards are `null` during play;
- at showdown, non-folded hands are revealed; folded hands never are.

Each player therefore receives a *different* `game_state_update`. The
`hand_result.finalState` is the public showdown view.

## Turn timer

`GameRoom` runs a per-turn `setTimeout` and broadcasts `timer_tick` ~twice a second.
On expiry the player is auto-**checked** (if free) or auto-**folded**. The timer
resets each turn and is cleared whenever the hand advances.

**Host-configurable duration.** `TableConfig.turnSeconds` (integer 10–120, multiple
of 5, default 30) is set by the host via the lobby's Turn Timer stepper before the
game starts. `rooms/index.ts` translates it when constructing the `GameRoom`:

```ts
timing: { ...options.gameTiming, turnMs: options.gameTiming?.turnMs ?? config.turnSeconds * 1000 }
```

Test code still injects a short `gameTiming.turnMs` (which takes precedence), so
unit tests don't need real-time waits. `sanitizeConfig` in `rooms/lobby.ts` rejects
out-of-range or non-step values.

## Chip transactions & idempotency

Persistent bankroll lives in `players.chip_balance`. Chips move through
`adjustChips()` ([`db/index.ts`](../packages/server/src/db/index.ts)), which runs
in a **single transaction**: it inserts a `chip_transactions` row with
`onConflictDoNothing` on a **unique `idempotency_key`**, then updates the balance.
A duplicated/retried call (e.g. a socket replay) is a no-op — chips can never be
double-credited.

**Accounting model** (a deliberate simplification of the original per-hand plan):

- **Game start** — deduct `buyIn` from each player's bankroll
  (`idempotencyKey = ${gameId}:buyin:${playerId}`); the table stack lives in memory.
- **During play** — chip movement happens entirely in the in-memory engine state.
- **Leave / game end** — cash the remaining table stack back to the bankroll
  (`${gameId}:cashout:${playerId}`).

This is chip-conserving and far less error-prone than per-hand DB writes; the
integrity tests assert the ledger nets to zero. The `ChipService` interface is
injected, so the server uses the real DB-backed ledger when `DATABASE_URL` is set
and an in-memory no-op otherwise (dev/mock mode).

## Database schema

[`db/schema.ts`](../packages/server/src/db/schema.ts):

| Table | Role | Used today |
|---|---|---|
| `players` | bankroll per Discord user | ✅ active |
| `chip_transactions` | append-only ledger, unique `idempotency_key` | ✅ active |
| `player_hand_stats` | append-only per-hand **fact** table (stats source of truth) | ✅ active |
| `player_stats` | denormalized per-player **aggregate** counters | ✅ active |
| `games`, `game_players`, `hands`, `hand_actions` | audit/history | provisioned; live game state is in-memory |

> Live game state is held in memory by the `GameRoom` for latency; the bankroll,
> the chip ledger, and **player statistics** are persisted today. The
> `games`/`hands` audit tables remain ready for hand-history persistence without a
> schema change (the stats fact table is separate — see below).

## Player statistics

A **hybrid** capture pipeline records a wide range of per-player stats so
leaderboards, stat pages, and challenges can be built later — including
retrospectively over historical data. UIs are out of scope; this delivers
capture → storage → read APIs. Spec:
[`docs/superpowers/specs/2026-06-20-player-statistics-tracking-design.md`](./superpowers/specs/2026-06-20-player-statistics-tracking-design.md).

**Storage (two tables).**

- `player_hand_stats` — append-only **fact** table, one row per player per hand:
  chips contributed/won, net, result, hand category (incl. `royal-flush`), pot,
  went-to-showdown, VPIP/PFR/aggression, all-in, final street, duration. This is
  the retrospective source of truth. `UNIQUE (game_id, player_id, hand_number)`;
  indexes on `(player_id, created_at)` and `(game_id)`.
- `player_stats` — denormalized per-player **aggregate** counters (hands, chips
  bet/won/lost, net profit, biggest pot, showdowns, VPIP/PFR/action counts,
  per-category `jsonb` tally, total play time, games played). Always recomputable
  from the fact table.

**Capture flow.** Capture lives entirely in `GameRoom`, keeping the engine pure:

1. `startHand()` creates a pure `HandStatsTracker` ([`rooms/hand-stats.ts`](../packages/server/src/rooms/hand-stats.ts)).
2. `handleAction()` records each applied action **with the street captured before
   `act()`** mutates the phase — so VPIP/PFR/aggression/final-street (which the
   final state can't reconstruct) are accurate.
3. `concludeHand()` assembles one `PlayerHandStat` per dealt-in player via
   `buildHandFacts(...)` (royal-flush detected from the winning cards) and writes
   them through the injected `StatsService`.
4. Per-seat play-time is accrued from join → leave/disconnect (reconnect-aware)
   and written once at game end via `recordSession`.

**Idempotency & atomicity.** `dbStatsService.recordHand` ([`db/stats.ts`](../packages/server/src/db/stats.ts))
runs one transaction: bulk-insert facts with `onConflictDoNothing`, then fold
**only the newly-inserted** facts into the aggregates (read-modify-write via the
pure reducer in `stats-aggregate.ts`). A replayed hand can never double-count.
Session recording is at-most-once (guarded), and `total_play_ms`/`games_played`
are **not** present in the fact table, so the `stats:recompute` backfill rebuilds
every hand-derived aggregate but **preserves** those session columns.

**Derived, never stored.** Ratios (win rate, VPIP, PFR, aggression factor,
showdown-win%) are computed at read time in `toPlayerStatsSummary`; only raw
counts/sums live in the DB, so the definitions can evolve without migration.

**Read API (REST, not Socket.io).** `StatsRepository` is exposed via `statsRouter`
([`routes/stats.ts`](../packages/server/src/routes/stats.ts)), mounted at
`/api/stats`. All routes require a valid `poker_session` JWT cookie (same auth as
the rest of `/api`); without a DB they no-op (mock mode).

| Method | Route | Returns |
|---|---|---|
| GET | `/api/stats/:playerId` | `PlayerStatsSummary` (404 if none) |
| GET | `/api/stats/leaderboard?metric=&limit=&since=` | `LeaderboardEntry[]` (400 on unknown metric) |
| GET | `/api/stats/:playerId/hands?limit=&since=` | recent `PlayerHandStat[]` |

`metric` ∈ `net_profit \| chips_won \| hands_won \| biggest_pot_won \| hands_played`.
All-time leaderboards read `player_stats`; a `since` window aggregates the fact
table. Contract types live in `@poker/shared`.

> **Postgres 18 / drizzle-kit:** `db:push` requires **drizzle-kit ≥ 0.31** on
> PG17+. Older 0.30.x mis-reads PG's named NOT NULL constraints and emits a
> spurious `DROP CONSTRAINT "<table>_<col>_not_null"` for every column, which
> fails on the `players` PK column (`42P16`).

## Table membership (spectate / join / leave)

`GameRoom` owns the full table population as a list of role-tagged **`Member`**
objects (`role: 'seated' | 'spectator'`). A spectator is a connected member with
no engine seat — they receive a sanitized table view (hole cards hidden as normal)
but are never dealt in.

### Member model

```ts
interface Member {
  id: string;          // Discord user id
  socketId: string;
  role: 'seated' | 'spectator';
  seatIndex?: number;  // only when role === 'seated'
  seatSession: string; // unique UUID per seat occupancy
  pending?: 'sit_in' | 'sit_out' | 'leave_table';
  left?: true;         // marked gone; entry retained until hand boundary cleanup
}
```

### Hand-boundary transition resolver (`applyPending`)

Queued role changes resolve **at hand boundaries** (top of `startHand` and
`scheduleNextHand`) via a centralised `applyPending()` call:

- **`sit_in`** (spectator → seated): a new `seatSession` UUID is minted, the
  buy-in is charged (`ChipService`), and the member is assigned the next
  available seat. Gated on the lobby-known `bankroll ≥ buyIn`.
- **`sit_out`** (seated → spectator): the table stack is cashed out and the seat
  is released; the member keeps watching from the rail.
- **`leave_table`** (deferred): the stack is cashed out and the member is emitted
  to the lobby via `left_table`. For spectators `leave_table` is immediate (no
  hand boundary needed).
- **`cancel_pending`**: clears the queued transition.

A seated player who **busts** (stack reaches 0 at settle) is automatically moved
to spectator with a cash-out of 0, so they can watch the rest of the game
without being stuck.

### Teardown: idle-at-1 / end-at-0

- **≥ 2 seated** — game runs normally.
- **Exactly 1 seated** — `waitingForPlayers` flag is set; the table idles until a
  spectator sits in or the remaining player leaves.
- **0 seated** — game ends: all remaining members (including spectators) receive
  `left_table` and are ejected to the lobby.

### `seatSession`-scoped ledger keys

Because a player can leave and rejoin the same game, the buy-in and cash-out
idempotency keys carry the per-occupancy `seatSession` UUID:

```
${gameId}:buyin:${playerId}:${seatSession}
${gameId}:cashout:${playerId}:${seatSession}
```

This ensures each distinct seat occupancy is a separate accounting unit, so
leave→rejoin in the same game re-deducts the buy-in correctly rather than
hitting the `onConflictDoNothing` guard from the first occupancy.

### `activeGame` lobby summary + player filtering

While a game is running, `LobbyRoom.toState()` folds a cards-free
**`ActiveGameSummary`** into `LobbyState.activeGame`:

```ts
interface ActiveGameSummary {
  gameId: string;
  seatedCount: number;
  watchingCount: number;
  members: Array<{ id: string; name: string; role: 'seated' | 'spectator' }>;
  buyIn: number;
  waitingForPlayers: boolean;
}
```

Table members are **filtered out of the lobby player list** (a `MemberProvider`
interface is injected into `LobbyRoom` so it can ask the current `GameRoom` which
players are at the table). `GameRoom` calls `onMembershipChange()` whenever
membership changes so the lobby re-broadcasts immediately.

### `joined_table` / `left_table` view-switch protocol

The client-side lobby↔table switch is driven by two server→client events:

| Event | Payload | Effect |
|---|---|---|
| `joined_table` | `{ gameId, role }` | `App.tsx` mounts the table UI (spectator or seated) |
| `left_table` | — | `App.tsx` returns to the lobby |

This replaces the old `game_start`-based switch, which had a latent bug where
non-ready players were yanked into the table view when a game started.

Client→server events that drive transitions:

| Event | Meaning |
|---|---|
| `join_table` | Spectate a running game |
| `sit_in` | Queue a spectator→seated transition (next hand) |
| `sit_out` | Queue a seated→spectator transition (next hand) |
| `cancel_pending` | Undo a queued transition |
| `leave_table` | Leave the table (deferred to hand end if seated; immediate if spectator) |

## Lobby & countdown logic

`LobbyManager` ([`rooms/lobby.ts`](../packages/server/src/rooms/lobby.ts)) keys a
`LobbyRoom` per `instanceId`. The first joiner is **host** (may edit config while
waiting, before anyone readies). The countdown is a server-side `setTimeout`:
any ready player can cancel it, it does **not** reset when new players ready
mid-countdown, and at expiry it re-validates that ≥2 players still hold ≥ buy-in
before creating the game.

## Disconnect & reconnect

- **Disconnect** — the seat is flagged `disconnected` and auto-folds on its turn;
  committed chips are forfeited to the pot. Disconnected seats are excluded from
  the ≥2 quorum that continues to the next hand, so tables don't zombie.
- **Reconnect** — rejoining the instance (`join_lobby`) rebinds the seat to the
  new socket, clears the flag, and resends the current state. You can reconnect
  mid-hand; if you missed the action you're folded for that hand and active again
  next hand.

## Dev mock mode

For zero-setup local play: the client's `setupDiscord()` returns a fake identity
from URL params when `import.meta.env.DEV && ?mock`, and the server falls back to
the in-memory `ChipService` when `DATABASE_URL` is unset. See
[SETUP.md → Quick local play](./SETUP.md#a-quick-local-play-no-discord-no-database).

## Migration to production (Railway + Vercel)

The split is designed so going live is **env-only**:

1. **Railway** — create a project, add a PostgreSQL service, deploy the `server`
   package. Set `DATABASE_URL`, `DISCORD_*`, and `JWT_SECRET`. Run `npm run db:push`
   against the production database.
2. **Vercel** — deploy the `client` package; set `VITE_DISCORD_CLIENT_ID` and
   `VITE_SERVER_URL` to the Railway URL.
3. **Discord Developer Portal** — remove the Activity URL override (the Activity
   URL becomes the Vercel URL) and point the `/api` URL mapping at the Railway URL.

CORS already allows `*.discordsays.com`, `*.trycloudflare.com`, and `localhost`,
so no server code changes are required to switch environments.
