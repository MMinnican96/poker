# Ratbag Poker Night — overhaul design

Date: 2026-09-23 · Branch: `feat/overhaul`

## Goals

1. Poker rules that are correct by construction (engine rewrite, property-tested).
2. A chip bank that can never lose, mint or double-spend chips — including across
   server restarts.
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
shared/   types + socket contracts + pure game data (catalog, challenges, levels, hand-eval)
server/
  engine/     pure rules: startHand, legalActions, applyAction, progress, settle
  db/         schema, client (node-postgres OR PGlite), migrations
  services/   bank, recorder (stats+XP+challenges), shop, profiles, chat, leaderboard
  rooms/      LobbyRoom (presence/host) + TableRoom (seats, hands, timers)
  http/       REST routes (bearer-token auth)
  socket/     auth middleware + event wiring
client/
  app/        session, api, socket, stores
  ui/         design-system primitives
  lobby/ table/ features/{leaderboard,stats,challenges,shop,profile,messages}
```

### One database code path

`DATABASE_URL` set → node-postgres. Unset → **PGlite** (embedded Postgres in WASM,
in-memory or `PGLITE_DATA_DIR`). Every service is written once against Drizzle;
mock mode and tests run real SQL. PGlite gets its schema from the generated
migrations in `packages/server/drizzle/`; production Postgres keeps using
`db:push` as before.

### Auth

`POST /api/auth/token` (Discord) and `POST /api/auth/mock` (dev only; refused in
production / on Railway) both return a signed session token. The socket handshake
must carry it (`auth.token`); identity and balance come from the server, never the
client. REST uses `Authorization: Bearer`.

## Engine rules

- Persistent seat numbers; simplified moving button (next occupied, dealt-in seat).
- Heads-up: button posts SB and acts first pre-flop, last post-flop.
- Optional ante. Short blinds/antes post what they can and are all-in.
- Legal actions are computed in one place (`legalActions`) and validation uses it.
- Raise rights: a player who already acted may only re-raise if facing at least a
  full raise since they acted (TDA rule). Min raise = current bet + last full raise.
- Raising requires another player able to respond; "all-in" becomes a call when no
  raise is possible.
- Uncalled chips are returned before pots are built.
- Pots built by contribution layers; odd chips to the first winner left of the button.
- When betting is over, the board is run out one street at a time (the room adds
  delays for suspense).
- Invariant (property-tested): chips are conserved every hand.

## Bank

Chips move between `players.chip_balance` and `table_seats` (escrow) in single
transactions, with a `chip_transactions` ledger row per movement.

- Buy-in / top-up: balance → seat (fails atomically if short).
- After every hand: stacks checkpointed to `table_seats`.
- Cash-out: seat (open → closed) → balance; idempotent on seat status.
- Boot recovery: any seat still open from a dead process is refunded at its last
  checkpoint (the interrupted hand is voided).
- Rewards (daily bonus, level-ups, challenge claims) and shop purchases go through
  the same ledger with unique idempotency keys.

## Table model

One table per instance. The host opens it with rules (blinds, ante, buy-in range,
seats, turn timer, felt). Anyone can watch or take a seat with a chosen buy-in.
The host starts the first hand; afterwards hands deal automatically while ≥2
players are active. Transitions (leave, stand up, sit out, top-up) queue until the
hand boundary when the player is in the hand, and apply immediately otherwise.
Disconnected players are auto-folded by the timer, then sat out, then stood up.

## Progression

XP per hand played and won; levels unlock chip rewards. Three daily and three
weekly challenges are chosen deterministically from a pool, progress is updated
from hand facts in the same transaction as stats, and completed challenges are
claimed for chips + XP.

## Shop

Static catalog in `shared`. Categories: felts (table theme, chosen by host), card
backs, avatar frames, titles, win celebrations, emote packs and throwables
(consumables). Purchases debit the ledger with a client nonce for idempotency.

## Messages

Room chat per instance (shared by lobby and table, persisted), direct messages
between players (persisted, unread counts), rate-limited, 280-char limit.

## Visual direction — "The back room"

The rat's card club from the logo: tactile materials rather than glossy gradients.

| Token | Hex | Role |
|---|---|---|
| Baize | `#1F5B3F` | felt, primary surfaces |
| Deep baize | `#0F3526` | table shadow, content wells |
| Walnut | `#2A1D17` | room background, rails |
| Chip red | `#C8272D` | primary action, danger |
| Card stock | `#F3E6C8` | text on dark, profile cards |
| Brass | `#D9A441` | chips, highlights, placards |

Type: **Alfa Slab One** (display, pot/stack numbers) + **Barlow** (UI, tabular
figures). Sentence case throughout. The one bold element: the felt, printed with
the Ratbag crest like club baize. Motion is reserved for game events (deal, chips,
wins) and responses to the player.
