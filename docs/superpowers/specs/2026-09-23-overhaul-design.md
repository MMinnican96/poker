# Ratbag Poker Night — overhaul design

Date: 2026-09-23 · Branch: `feat/overhaul` · Status: built (updated 2026-09-24 to
match the implementation; see [Revisions during the build](#revisions-during-the-build)).

This is the design record for the overhaul. The living reference is
[`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md).

## Goals

1. Poker rules that are correct by construction (engine rewrite, property-tested).
2. A chip bank that can never lose, mint or double-spend chips — including across
   server restarts and deploys.
3. One persistent table per Discord instance with full table rules, buy-in ranges,
   seats, spectating, sit-out and host controls.
4. New features: leaderboard, stats, challenges + XP/levels, shop (cosmetics,
   emotes, throwables), profile cards, messages (room chat + DMs).
5. A full UI redesign.

## Problems found in the previous build

| Area | Bug |
|---|---|
| Security | `join_lobby` trusted a client-supplied identity **and chip balance**; anyone could impersonate anyone. |
| Engine | Uncalled bets were never returned (inflated pots/stats). |
| Engine | An incomplete all-in raise reopened betting for players who had already acted. |
| Engine | Odd chips went to the button instead of the first seat left of it. |
| Engine | First-to-act/heads-up detection used the count of players *after* blinds, so all-in blinds broke the order. |
| Engine | "All-in" facing a smaller all-in shoved the whole stack instead of calling. |
| Engine | Seat identity was the index in a shrinking array, so the button skipped/repeated when people left. |
| Chips | Table stacks lived only in memory: a restart mid-game destroyed every bought-in chip. |
| Chips | Buy-ins were fire-and-forget promises racing the next deal. |

## Architecture

```
shared/   types + socket contracts + pure game data (catalog, challenges, levels, hand-eval, rules)
server/
  engine/     pure rules: startHand, legalActions, applyAction, progress, pots
  db/         schema, client (node-postgres OR PGlite), migrate CLI; drizzle/ SQL migrations
  services/   bank, leases, recorder (stats+XP+challenges), hand-facts, stats-repo
              (stats, history, leaderboard), rewards, shop, profiles, chat, recompute
  rooms/      InstanceRoom (presence, activity feed, the table) + RoomManager,
              TableRoom (seats, hands, timers, host), Serial queue
  http/       REST routes (bearer-token auth)
  socket/     auth middleware + event wiring
client/
  app/        session, api, socket, store, nav, lazy loading
  ui/         design-system primitives        cosmetics/  catalog-driven renderers
  lobby/ table/ features/{leaderboard,stats,challenges,shop,profile,messages}
```

### One database code path

`DATABASE_URL` set → node-postgres. Unset → **PGlite** (embedded Postgres in WASM,
in-memory or `PGLITE_DATA_DIR`). Every service is written once against Drizzle;
mock mode and tests run real SQL (`TEST_DATABASE_URL` runs them on Postgres).

Both kinds of database apply the migrations in `packages/server/drizzle/` at
boot, so a deploy upgrades its own database and `db:push` is no longer part of
deploying. The migrations are hand-written to be idempotent: `0000_init` creates
a fresh database or upgrades a pre-overhaul `db:push` database in place (keeping
players, balances, ledger and stats; dropping the never-written audit tables),
and `0001_leases` adds server leases the same way.

### Auth

`POST /api/auth/token` (Discord) and `POST /api/auth/mock` (dev only; refused when
`NODE_ENV=production`, on Railway, or with `MOCK_AUTH=0`) both return a signed
session token (HS256 only, 24 h). The socket handshake must carry it
(`auth.token`); identity and balance come from the server, never the client.
REST uses `Authorization: Bearer`. Optionally (`VERIFY_ACTIVITY_INSTANCE=1`) the
server asks Discord whether a player is really in the instance they join.

## Engine rules

- Persistent seat numbers; simplified moving button (next occupied, dealt-in seat).
- Heads-up: button posts SB and acts first pre-flop, last post-flop.
- Optional ante. Short blinds/antes post what they can and are all-in.
- Legal actions are computed in one place (`legalActions`) and validation uses it.
- Raise rights: a player who already acted may only re-raise if facing at least a
  full raise since they acted (TDA rule). Min raise = current bet + last full raise.
- Raising requires another player able to put in more than the current bet;
  otherwise no raise is offered. `maxRaiseTo` is capped at what an opponent can
  call, and "all-in" becomes a call (or check) when no raise is possible.
- Uncalled chips are returned before pots are built.
- Pots built by contribution layers; odd chips to the first winner left of the button.
- At showdown every live hand is tabled (no muck option).
- When betting is over, the board is run out one street at a time (the room adds
  delays for suspense, and live hands are shown face up during an all-in run-out).
- Invariant (property-tested): chips are conserved every hand.

## Bank

Chips move between `players.chip_balance` and `table_seats` (escrow) in single
transactions, with a `chip_transactions` ledger row per movement. CHECK
constraints keep balances, stacks and item quantities non-negative.

- The table-facing API works by **seat id**: `buyIn` opens a seat and returns its
  id; `topUp`, `cashOut` and `checkpoint` address that seat. One lock order
  everywhere: player row, then seat row.
- Buy-in / top-up: balance → seat (fails atomically if short).
- After every hand: stacks checkpointed to `table_seats` (absolute values).
- Cash-out: seat (open → closed) → balance; idempotent on seat status, so it can
  never touch a newer seat.
- Every bank operation of a table, and dealing itself, runs in the table's serial
  queue, which re-checks its preconditions. A hand is never dealt while chips are
  moving.
- **Server leases**: each process keeps a heartbeating row in `server_leases`
  (15 s), and every seat records the lease that opened it. Recovery runs at boot
  and every 30 s, and refunds (at the last checkpoint, voiding the interrupted
  hand) only seats whose lease is missing or stale (60 s). Rolling deploys
  therefore leave the old process's live tables alone.
- **Graceful shutdown**: on SIGTERM/SIGINT every table voids its hand in
  progress and cashes everyone out at their pre-hand stacks (15 s budget), then
  the lease is released.
- Rewards (daily bonus, level-ups, challenge claims) and shop purchases go through
  the same ledger with unique idempotency keys.

## Table model

One table per instance. The host opens it with rules (blinds, ante, buy-in range,
seats, turn timer, felt the host owns); rules can change until the first hand and
are then locked. Anyone can watch or take a seat with a chosen buy-in. The host
starts the first hand; afterwards hands deal automatically while ≥2 players are
eligible. Transitions (leave, stand up, top-up) queue until the hand boundary when
the player is in the hand, and apply immediately otherwise; sit-out is immediate.
Queued top-ups are trimmed at the boundary to stay within the maximum buy-in.

The turn timer checks or folds; two timeouts in a row sit a player out.
Disconnected players are not dealt in, are sat out at the next boundary, and are
stood up and cashed out after 90 s away. If the host leaves, hosting passes to
another member. A table closes when the host closes it (after the current hand),
when everyone leaves, or on shutdown.

Members who stop being at the table get `table_left { code, reason }` with a
machine-readable code: `left`, `host-closed`, `abandoned`, `removed`, `shutdown`,
or `not-member` (the answer to `request_state` from a non-member). The client
routes on the code.

## Progression

XP per hand played and won; levels unlock chip rewards. Three daily and three
weekly challenges are chosen deterministically from a pool, progress is updated
from hand facts in the same transaction as stats, and completed challenges are
claimed for chips + XP. A daily bonus grows with a consecutive-day streak.
The leaderboard ranks with a window function (ties share a rank) and returns
`{ entries, me }` so a player sees their own place.

## Shop

Static catalog in `shared`. Categories: felts (table theme, chosen by host), card
backs, avatar frames, titles, win celebrations, emote packs and throwables
(consumables). Purchases debit the ledger with a client nonce for idempotency.
Hand history stores each player's card back so past hands draw opponents' backs.

## Messages

Room chat per instance (shared by lobby and table, persisted), direct messages
between players (persisted, unread counts), rate-limited, 280-char limit.

## Client

- A pure reducer store fed by socket events; commands are ack'd with a timeout.
  The lobby state is the source of truth for which table exists, so a stale table
  view is dropped.
- Feature screens, the table screen and the profile card are lazy chunks,
  preloaded when idle.
- The table layout is a pure geometry engine that models every element as a
  rectangle, places bets, shown cards and the button where they overlap nothing,
  and checks itself: tests keep `layoutConflicts()` empty for 2–9 seats at
  640×360, 390×844, desktop and other sizes.

## Visual direction — "The back room"

The rat's card club from the logo: tactile materials rather than glossy gradients.

| Token | Hex | Role |
|---|---|---|
| Baize | `#1F5B3F` | felt, primary surfaces |
| Deep baize | `#0F3526` | table shadow, content wells |
| Walnut | `#2A1D17` | room background, rails |
| Chip red | `#C22328` | primary action, danger (deepened from `#C8272D` for 4.5:1 with card stock) |
| Card stock | `#F3E6C8` | text on dark, profile cards |
| Brass | `#D9A441` | chips, highlights, placards |
| Ink on brass | `#4D3829` | engraved text on brass |
| Bronze | `#805A1A` | third-place plate |

Type: **Alfa Slab One** (display, pot/stack numbers) + **Barlow** (UI, tabular
figures) + **Barlow Condensed** (tight labels), self-hosted. Sentence case
throughout. The one bold element: the felt, printed with the Ratbag crest like
club baize. Motion is reserved for game events (deal, chips, wins) and responses
to the player. The full system is in
[`docs/DESIGN_STANDARDS.md`](../../DESIGN_STANDARDS.md).

## Revisions during the build

Changes from the first version of this spec, made after review and QA:

- Production Postgres is migrated at boot like PGlite (was: keep `db:push`);
  migrations are idempotent and upgrade the old schema in place.
- Server leases, periodic recovery and graceful shutdown (was: boot-time recovery
  only, which would have refunded a live process's seats during a rolling deploy).
- Bank API by seat id with one lock order; dealing moved into the serial queue;
  top-up maximum checked inside the queue.
- No raise offered when no opponent can put in more.
- `validateRules` keeps known fields only; a new felt must be owned by the host.
- `table_left` carries a code; `request_state` from a non-member answers
  `table_left { code: 'not-member' }`.
- `HandView.actionStartedAt` so the turn ring uses the real turn length.
- Leaderboard returns `{ entries, me }`; conversation partners carry level and
  cosmetics; hand history stores card backs.
- Contrast fixes: deeper chip red, ink on brass, bronze.
- The "LobbyRoom" became `InstanceRoom` + `RoomManager`; the host lives on the
  `TableRoom`.
