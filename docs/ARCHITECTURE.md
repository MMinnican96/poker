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
        ├── discord.ts         # SDK handshake (+ dev mock)
        ├── socket.ts          # typed Socket.io client
        ├── Lobby.tsx, ActionBar.tsx, GameCanvas.tsx
        └── game/              # Phaser scene + React↔Phaser bridge
```

`@poker/shared` is the contract glued to both ends: it defines `GameState`,
`LobbyState`, `Card`, `TableConfig`, and the typed Socket.io event maps, so the
client and server can never drift on the wire format.

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
| `lobby_state_update` | `LobbyState` | Full lobby snapshot (players, ready, config, status) |
| `countdown_start` | `{ endsAt }` | Pre-game countdown started (absolute epoch ms) |
| `countdown_cancel` | — | Countdown aborted (cancelled or under-funded at expiry) |
| `game_start` | `{ gameId }` | A game session has begun |
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
| `leave_table` | — | Leave + cash out (between hands only) |

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

`GameRoom` runs a per-turn `setTimeout` (default 10s) and broadcasts `timer_tick`
~twice a second. On expiry the player is auto-**checked** (if free) or
auto-**folded**. The timer resets each turn and is cleared whenever the hand
advances.

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
