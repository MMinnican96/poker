# Architecture

Ratbag Poker Night is a no-limit Texas Hold'em game that runs as a Discord
Activity. This document describes the system as it's built on `feat/overhaul`.
For running it see [SETUP.md](./SETUP.md); for the visual system see
[DESIGN_STANDARDS.md](./DESIGN_STANDARDS.md).

## Contents

1. [Packages](#packages)
2. [Data flow](#data-flow)
3. [Authentication](#authentication)
4. [Rooms and the table lifecycle](#rooms-and-the-table-lifecycle)
5. [Engine rules](#engine-rules)
6. [Bank, escrow, leases and recovery](#bank-escrow-leases-and-recovery)
7. [Stats, XP, levels and challenges](#stats-xp-levels-and-challenges)
8. [Shop and cosmetics](#shop-and-cosmetics)
9. [Chat, DMs and activity](#chat-dms-and-activity)
10. [Database](#database)
11. [REST API](#rest-api)
12. [Socket contract](#socket-contract)
13. [Privacy guarantees](#privacy-guarantees)
14. [Client architecture](#client-architecture)
15. [Testing](#testing)
16. [Production hosting](#production-hosting)

## Packages

npm-workspaces monorepo with three packages.

| Package | Role |
|---|---|
| `@poker/shared` | Wire types and the Socket.io contract (`events.ts`), table rules and `validateRules` (`table.ts`), hand evaluator with descriptive labels (`hand-eval.ts`), shop catalog (`shop.ts`), levels, XP, daily bonus and challenges (`progression.ts`), lobby, chat and stats types (`social.ts`), number formatting (`format.ts`). ESM, built to `dist/`. |
| `@poker/server` | Node + Express + Socket.io + Drizzle. Postgres through node-postgres when `DATABASE_URL` is set, embedded PGlite otherwise. |
| `@poker/client` | React 19 + Tailwind 4 single-page app, the Activity iframe. Built with Vite 8. |

The server consumes shared's built `dist/` through the workspace symlink; the
client aliases `@poker/shared` to `shared/src` in both `vite.config.ts` and
`tsconfig.json`.

Server source map:

| Path | Contents |
|---|---|
| `index.ts` | Boot: open DB (migrations), register lease, recovery at boot and every 30 s, `createApp`, listen, graceful shutdown |
| `app.ts` | `createApp()`: Express (CORS, 32 kB JSON limit, JSON body errors), Socket.io, `/api`, static client with SPA fallback, `close()` |
| `auth.ts` | JWT sign/verify (HS256, 24 h), `resolveSecret`, `isProduction`, `mockAuthAllowed`, mock identities |
| `discord.ts` | OAuth code exchange, `/users/@me`, guild member lookup, Activity instance check |
| `engine/` | Pure rules: `startHand`, `legalActions`, `applyAction`, `progress`, pots, deck |
| `rooms/instance-room.ts` | `InstanceRoom` (presence, activity feed, the table) and `RoomManager` |
| `rooms/table-room.ts` | `TableRoom`: seats, hands, timers, boundary changes, per-viewer views |
| `rooms/serial.ts` | `Serial` (one-at-a-time async queue) and `RateLimiter` |
| `socket/realtime.ts` | Socket auth middleware and every event handler |
| `http/api.ts` | REST routes |
| `services/` | `bank`, `leases`, `recorder`, `hand-facts`, `stats-aggregate`, `stats-repo`, `rewards`, `shop`, `chat`, `profiles`, `players`, `recompute` |
| `db/` | `schema.ts`, `client.ts` (`openDatabase`, `openPglite`), `migrate-cli.ts` |
| `drizzle/` | `0000_init.sql`, `0001_leases.sql`, `meta/` journal and snapshots |

## Data flow

```
 Discord client ──SDK authorize(code)──▶ client ──POST /api/auth/token──▶ server
                                           ◀── { token, accessToken, me } ──┘
 client ──socket.io (auth.token)──▶ realtime.ts ──▶ RoomManager ──▶ InstanceRoom
        ◀── me / lobby_state / table_state / chat / notice ──┐        │
                                                             │        ▼
 client ──REST (Bearer)──▶ http/api.ts ──▶ services ◀──── TableRoom ──▶ engine (pure)
                                              │              │ Serial queue
                                              ▼              ▼
                                   Postgres / PGlite  ◀──  Bank, HandRecorder
```

1. The client signs in (Discord or mock) and gets a session token plus its own
   `PlayerSelf`.
2. It opens one socket with the token and sends `join_room` with its Activity
   instance id. The server replies with `lobby_state`, `activity_history` and the
   room's `chat_history`.
3. Commands (`take_seat`, `act`, ...) go to the `TableRoom` for that instance.
   The table asks the engine what's legal, drives timers, and moves chips only
   through the `Bank`.
4. After every change the table sends each member a `table_state` built for that
   viewer, and the instance broadcasts a cards-free `lobby_state`.
5. Everything outside a live hand (profiles, stats, leaderboard, shop,
   challenges, DM history) is REST.

## Authentication

- **Discord.** The client calls `sdk.commands.authorize` with scope `identify`
  only and posts the code to `POST /api/auth/token` with the `guildId`. The
  server exchanges the code, reads `/users/@me`, and with the bot token reads the
  guild member for the server nickname and guild avatar. It upserts the player
  (new players start with 10,000 chips) and returns a signed session token and
  the Discord access token, which the client passes to
  `sdk.commands.authenticate`.
- **Mock (development).** `POST /api/auth/mock { name }` makes a stable
  `mock-<slug>` identity with a default Discord avatar. The server refuses it
  (404) when `mockAuthAllowed()` is false: always in production (`NODE_ENV=production`,
  `RAILWAY_ENVIRONMENT` or `RAILWAY_ENVIRONMENT_NAME` set), and when
  `MOCK_AUTH=0`. The client only tries it in a Vite dev build with `?mock` in
  the URL.
- **Session token.** HS256 JWT, 24 h, claims `{ sub, name, avatar }`. Tokens
  signed with any other algorithm are refused. `JWT_SECRET` is required in
  production; elsewhere a random per-process secret is used, so dev sessions end
  on restart.
- **Transport.** Socket.io reads `handshake.auth.token` in middleware and loads
  the player row; failure is `connect_error('unauthorized')`. REST reads
  `Authorization: Bearer <token>`; failure is `401 { error: 'Sign in again.' }`.
  The client shows "Your session expired" for either.
- **Instance check (optional).** With `VERIFY_ACTIVITY_INSTANCE=1`, `join_room`
  asks Discord (bot token) whether the player is in that Activity instance and
  refuses otherwise. Off by default.

## Rooms and the table lifecycle

### Rooms

`RoomManager` holds one `InstanceRoom` per Discord Activity instance. A room
tracks presence (a player is present while any of their sockets is joined), a
feed of the last 40 activity events (in memory), and at most one `TableRoom`.
Rooms are pruned when nobody is present and no table is open. Lobby presence is
`lobby`, `playing` (seated) or `watching`.

### Opening and starting

```
             open_table (host)                start_table (host, ≥2 eligible)
  no table ─────────────────────▶ open ─────────────────────────────▶ running
                                   │ rules editable (host)               │ hands deal automatically
                                   │ watch / take seat                   │ rules locked
                                   ▼                                     ▼
                        close_table / everyone leaves ─────────▶ closed (table_left to members)
```

- `open_table` needs the opener present in the room, no existing table, rules
  that pass `validateRules`, a felt the opener owns, and a bankroll of at least
  the minimum buy-in. The opener becomes host and joins as a spectator.
- Table rules: name (1 to 32 chars), a blind level from `BLIND_LEVELS`, ante
  (0 to the small blind), buy-in range (10 to 500 big blinds), seats (2 to 9),
  turn timer (10 to 120 s in steps of 5), felt. Unknown fields are dropped.
- While the table is `open` the host can change rules (`update_rules`), except
  shrinking seats below an occupied one or picking a felt they don't own.
- `start_table` switches to `running` once two players are eligible. There's no
  way back to `open`.

### Seats and hands

- **Members** are seated players or spectators. `watch_table` joins as a
  spectator. `take_seat { seat, buyIn }` joins first if needed, then buys in
  (bank transaction) and takes the seat; the player is dealt in from the next
  hand.
- **Eligible for a hand**: seated, not sitting out, stack above 0, no pending
  change, connected. With fewer than two eligible the table idles.
- **Dealing** is scheduled `handGapMs` after the previous hand and runs inside
  the table's serial queue, which re-checks eligibility. So a hand is never dealt
  while a buy-in, top-up or cash-out is in flight.
- **Pacing** (`DEFAULT_TIMING`): 700 ms before the next street, 1.5 s per street
  in an all-in run-out, result held 6.5 s after a showdown or 2.5 s after a
  fold-out, 1.5 s between hands.

### Changes at hand boundaries

A seated player in a hand can't leave mid-hand. These requests queue and apply
when the hand ends; otherwise they apply at once:

| Request | Mid-hand | Applied |
|---|---|---|
| `leave_table` | `pending: 'leave'` | Cash out, `table_left { code: 'left' }`, back to the lobby |
| `stand_up` | `pending: 'stand'` | Cash out, stay as a spectator |
| `top_up { amount }` | `pendingTopUp += amount` | Chips move before the next hand, trimmed to stay within `maxBuyIn` (with a notice) |
| `cancel_pending` | Clears the pending leave/stand and any queued top-up | |

`sit_out { sittingOut }` applies immediately: the player keeps the seat and
isn't dealt in. Spectators can leave at any time.

Boundary resolution runs in the serial queue in this order: retry failed
cash-outs; then for each seated player, pending leave, pending stand, queued
top-up, bust (stack 0: stood up with "You're out of chips"), and disconnect
handling. After it, the host is handed on if needed and an abandoned table
closes.

### Timeouts and disconnects

- **Turn timer.** When it runs out the server checks if it can, otherwise folds.
  Two timeouts in a row sit the player out, with a notice ("Tap I'm back").
  `HandView.actionStartedAt` / `actionEndsAt` are server-clock epoch ms, and
  `serverNow` lets the client correct for clock skew.
- **Disconnect.** A spectator who loses their last socket leaves the table. A
  seated player is marked disconnected and isn't dealt into further hands; at
  the next boundary they're sat out, and after 90 s away they're removed
  (cashed out, `table_left { code: 'removed' }`). An idle table sweeps for this
  every 10 s. Reconnecting (`join_room`, then `request_state`) restores them.

### Host transfer and closing

- If the host leaves, the host passes to the first seated member (else any
  member), who gets a notice.
- `close_table` (host only) closes at once between hands, or sets `closing` and
  closes when the current hand ends. Every seated player is cashed out and every
  member gets `table_left { code: 'host-closed' }`.
- The table closes as `abandoned` when it has no members, or when it's running
  with nobody seated and no hand in progress.
- On server shutdown every table closes with `shutdown` (see below).

### `table_left` codes

| Code | Meaning |
|---|---|
| `left` | You left the table |
| `host-closed` | The host closed the table |
| `abandoned` | Everyone left |
| `removed` | Away too long; your chips went back to your bankroll |
| `shutdown` | The server is restarting; your chips are back in your bankroll |
| `not-member` | Answer to `request_state` when you aren't at the table |

The client routes on `code` and shows `reason` as a toast, except for `left`
(and a host who closed their own table sees "You closed the table.").

## Engine rules

`engine/hand.ts` is pure: no I/O, no timers, randomness injected (crypto-secure
by default, seeded in tests). The hand's deck lives only in the server-side
`Hand` object.

| Topic | Rule |
|---|---|
| Seats | Persistent seat numbers; dealt-in players ordered by seat. |
| Button | Simplified moving button: the next dealt-in seat clockwise from the previous button (`nextButton`). No dead button or dead small blind. |
| Blinds | Small blind left of the button, big blind next. Heads-up the button posts the small blind, acts first pre-flop and last after. A short blind posts what it can and is all-in; the bet to call is still the full big blind. |
| Ante | Optional, per player, posted before blinds; doesn't count toward the bet to call. |
| Dealing | One card at a time from left of the button; a burn before each street. |
| Legal actions | Computed once in `legalActions` and used for validation and the client's action bar. |
| Raise rights (TDA) | A player who has acted may re-raise only when facing at least one full raise since they acted. An incomplete all-in raise doesn't reopen betting. Minimum raise is current bet + last full raise; a short all-in may be below it. |
| Pointless raises | No raise is offered when no opponent can put in more than the current bet. `maxRaiseTo` is capped at the most any opponent can call. |
| Capped shoves | `all-in` means "as much as matters": a raise to `maxRaiseTo` when raising is possible, otherwise a call (or check). A big stack facing a smaller all-in calls rather than shoving. |
| Uncalled bets | Returned to the bettor before pots are built (`returned` in the result). |
| Pots | Built from contribution layers; folded chips stay in but folded players are never eligible; adjacent layers with the same contenders merge. |
| Run-out | When fewer than two players can still bet, remaining streets are dealt one at a time, paced by the room. |
| Showdown | Every live hand is tabled automatically (no muck option). Best five of seven; ties split. |
| Odd chips | Go to the first winner clockwise from the button's left. |
| Conservation | A randomised property test checks chips are conserved every hand. |

## Bank, escrow, leases and recovery

### Where chips live

A chip is in exactly one place: a player's bankroll (`players.chip_balance`) or
an open seat (`table_seats.stack`, escrow). `Bank` (`services/bank.ts`) is the
only code that moves chips. Every movement is one transaction that updates the
balance and writes a `chip_transactions` row with a unique `idempotency_key`.
CHECK constraints stop balances, stacks and item quantities going negative, and
`move()` throws if a balance would.

| Operation | Effect | Ledger type and key |
|---|---|---|
| `buyIn({ tableId, playerId, amount })` | Bankroll → new open seat; returns `seatId` | `buy-in`, `buyin:<seatId>` |
| `topUp({ seatId, playerId, amount })` | Bankroll → open seat | `top-up`, `topup:<seatId>:<uuid>` |
| `checkpoint(hand, [{ seatId, stack }])` | Absolute stacks written after every hand | none (escrow only) |
| `cashOut({ seatId, playerId, stack })` | Close seat, credit bankroll; a second call finds it closed and does nothing | `cash-out`, `cashout:<seatId>` |
| `recoverOpenSeats()` | Refund orphaned open seats at their last checkpoint | `recovery`, `recovery:<seatId>` |
| `credit(...)` / `creditIn(tx, ...)` | Idempotent reward credit | `daily-bonus`, `level-up`, `challenge`, `grant` |
| Shop purchase (`move`) | Bankroll debit | `purchase`, `purchase:<player>:<nonce>` |

Rules the bank keeps: lock the player row first, then the seat row, everywhere;
one open seat per player per table (partial unique index); bank operations
address seats by id, so a stale cash-out can never touch a newer seat.

`TableRoom` runs buy-ins, top-ups, cash-outs, checkpoints, boundary resolution
and dealing through its `Serial` queue. Membership commands from one player are
also serialised across all their sockets in `realtime.ts`, so a double-tapped
`take_seat` can't strand a buy-in. A cash-out that fails (DB down) is retried at
each boundary and by the idle sweep.

### Leases

Each server process registers a `server_leases` row at boot and heartbeats it
every 15 s. Every seat it opens carries its lease id.

`recoverOpenSeats()` runs at boot and every 30 s. It refunds an open seat only
when its lease is missing, stale (no heartbeat for 60 s) or null (seats from
before leases), and never one of its own. It re-checks each seat under a row
lock, and forgets dead leases that own no open seats. This makes rolling deploys
safe: the new process leaves the old process's live seats alone.

A refund returns the last checkpoint, so a hand interrupted by a crash is
voided.

### Graceful shutdown

On SIGTERM or SIGINT (`index.ts`):

1. Stop the recovery timer.
2. `rooms.shutdown()`: every table voids any hand in progress and cashes every
   seated player out at their pre-hand stack, telling members
   `table_left { code: 'shutdown' }` while sockets are still open. The budget is
   `SHUTDOWN_CASHOUT_MS` (15 s).
3. Release the lease, so anything left open is recoverable at once by the next
   process.
4. `app.close()`: the same cash-out (idempotent) within what's left of the
   budget, then close sockets and HTTP. Close the DB and exit.

Railway only waits for this if `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` is set (see
SETUP). Without it the process is killed and recovery refunds the seats once the
lease goes stale.

## Stats, XP, levels and challenges

### Pipeline

```
hand completes (TableRoom.conclude)
  ├─ buildHandFacts(state)   one PlayerHandStat per dealt-in player   (pure)
  ├─ buildHistory(state)     board, pots, cards, results, card backs  (pure)
  └─ Serial queue:
       Bank.checkpoint(stacks)
       HandRecorder.recordHand(facts, history)   ── one transaction ──
         insert facts ON CONFLICT DO NOTHING → only fresh facts continue
         insert hand_history
         update player_stats aggregates (rows locked, sorted ids)
         add XP, credit level-up rewards
         add challenge progress, mark completed
       notices (level-up, challenge complete) + activity feed
       refreshMe → `me` + lobby update for each player
```

Facts are unique on `(table, player, hand)`, and only newly inserted facts feed
aggregates, XP and challenges, so a replay never double-counts. Session play
time is recorded once when a player leaves a seat (`recordSession`); it can't be
rebuilt from facts.

Ratios (win rate, VPIP, PFR, aggression factor, showdown win rate) are derived
at read time. `npm run stats:recompute` rebuilds aggregates from facts and keeps
the session columns.

### Progression rules (`shared/progression.ts`)

| Item | Rule |
|---|---|
| XP per hand | 2, +6 for a win, +4 more if won at showdown |
| Levels | XP to next level = 100 + 60 × (level − 1); max level 100 |
| Level-up reward | 250 × new level chips, credited once per level |
| Daily bonus | 500 + 250 × (streak day − 1), capped at day 7 (2,000). Consecutive UTC days grow the streak; a missed day resets it. |
| Challenges | 3 daily and 3 weekly, picked deterministically from the pool by period key (UTC day, ISO week), so everyone gets the same set. Progress comes from hand facts; completed challenges are claimed for chips and XP. |
| Badges | Derived at read time in `profiles.ts` (quads, straight flush, royal, hands played, biggest pot, level, items owned). |

### Leaderboard

`GET /api/leaderboard` ranks with `rank() over (order by value desc)`, so ties
share a rank, and returns the top entries plus your own entry wherever you rank.

| Metric | All time from | Weekly (last 7 days) from |
|---|---|---|
| `net_profit`, `chips_won`, `hands_won`, `biggest_pot_won`, `hands_played` | `player_stats` (players with ≥1 hand) | `player_hand_stats` |
| `bankroll` | balance + chips in open seats | all-time only |
| `level` | ranked by XP, shown as level | all-time only |

## Shop and cosmetics

- The catalog is static data in `shared/shop.ts`: felts, card backs, avatar
  frames, titles, win celebrations, emote packs and throwables. Items have a
  price, rarity, optional `minLevel`, and a `visual` the client renders.
  Price-0 items are owned by everyone.
- `POST /api/shop/purchase { itemId, nonce }` debits the bankroll through the
  ledger. The nonce makes retries idempotent. Permanent items can be bought
  once; throwables add their quantity.
- The loadout (one equipped item per slot: felt, card back, frame, title,
  celebration) lives on the `players` row and is changed with
  `POST /api/shop/equip`. Other players see your `Cosmetics` (frame, card back,
  title text, celebration) in every `PublicPlayer`.
- The felt shown at a table is the host's choice in the table rules, and the
  host must own it.
- Emotes: every emote in an owned pack (the free pack always). Throwables are
  consumed one per throw, at a seated player other than yourself. Emotes and
  throws share a limit of 3 per 4 s per player and go to the whole room as
  `table_fx`.

## Chat, DMs and activity

- **Room chat** (`room:<instanceId>`) is shared by the lobby and the table and
  persisted. The last 50 messages arrive with `join_room`.
- **DMs** (`dm:<idA>:<idB>`, ids sorted) are persisted; unread counts come from
  `chat_reads`. The conversation list and paged history are REST; new messages
  arrive live on the socket to both players.
- Limits: 5 messages per 5 s per player; 1 to 280 characters after stripping
  control, zero-width and bidi-override characters and collapsing blank lines.
  A malformed target is refused, never sent to the room.
- **Activity feed** (in memory, last 40 per room): table opened or started,
  level-ups, completed challenges, big wins (payout ≥ 50 big blinds), rare hands
  (four of a kind or better).

## Database

Drizzle schema in `packages/server/src/db/schema.ts`; migrations in
`packages/server/drizzle/`.

| Table | Purpose |
|---|---|
| `players` | One row per Discord user: bankroll (`chip_balance ≥ 0`), XP, daily streak, loadout, timestamps |
| `chip_transactions` | Append-only ledger; unique `idempotency_key` |
| `table_seats` | Escrow: one row per buy-in; `open`/`closed`, `stack ≥ 0`, `last_hand` checkpoint, `lease_id` |
| `server_leases` | One row per live server process, heartbeat timestamp |
| `player_hand_stats` | Append-only fact per player per hand; unique `(game_id, player_id, hand_number)`. `game_id` is the table session id (no FK). |
| `player_stats` | Per-player aggregates; rebuildable from facts except session columns |
| `hand_history` | One row per hand: board, pots, each player's cards/result/card back; GIN index on `player_ids` |
| `player_items` | Owned items and consumable quantities (`≥ 0`) |
| `player_challenges` | Progress, completion and claim per player, period and challenge |
| `chat_messages`, `chat_reads` | Room and DM messages; last-read time per player and channel |

`openDatabase()` applies migrations before returning, for Postgres and PGlite
alike, so every boot upgrades its own database. `0000_init.sql` is written to be
idempotent: it creates a fresh database, or upgrades a pre-overhaul `db:push`
database in place (drops the never-written `games`/`hands`/`game_players`/
`hand_actions` tables, adds new tables, columns, constraints and indexes, and
keeps players, balances, ledger and stats). `0001_leases.sql` follows the same
pattern. New migrations must be idempotent as well.

## REST API

All routes are under `/api`. JSON in and out. Bodies over 32 kB get 413;
malformed JSON gets 400; unhandled errors get `500 { error }`. Business-rule
refusals are `409 { ok: false, error }`.

| Route | Auth | Returns |
|---|---|---|
| `GET /health` | none | `{ status: 'ok', timestamp }` (Railway healthcheck) |
| `POST /auth/token` `{ code, guildId? }` | none | `AuthResponse { token, accessToken, me }`; 400 missing code; 502 Discord failure |
| `POST /auth/mock` `{ name }` | none | `AuthResponse`; 404 when mock sign-in is off; 400 bad name |
| `GET /me` | Bearer | `PlayerSelf` |
| `POST /me/daily` | Bearer | `{ ok, amount, balance, streak }` or 409 |
| `GET /players/:id/profile` | Bearer | `ProfileCard` (bankroll includes escrow) or 404 |
| `GET /players/:id/stats` | Bearer | `{ summary: PlayerStatsSummary, curve }` (curve: last 200 hands, cumulative) |
| `GET /me/hands?limit=` | Bearer | Your recent hands (1 to 50, default 20), opponents' unshown cards removed |
| `GET /leaderboard?metric=&period=all\|week&limit=` | Bearer | `{ entries, me }` (limit 1 to 100, default 25); 400 unknown metric |
| `POST /shop/purchase` `{ itemId, nonce }` | Bearer | `{ ok, balance, quantity }` or 409 |
| `POST /shop/equip` `{ slot, itemId }` | Bearer | `{ ok, loadout }`, 400 unknown slot, or 409 |
| `GET /challenges` | Bearer | `ChallengeStatus[]` for the current day and week |
| `POST /challenges/claim` `{ periodKey, challengeId }` | Bearer | `{ ok, chips, xp, balance, levelUps }` or 409 |
| `GET /messages/conversations` | Bearer | `Conversation[]`, most recent first, with unread counts |
| `GET /messages/history?channel=&before=` | Bearer | Up to 50 `ChatMessage`s, oldest first; 403 unless it's your DM or a room you're in |

Successful purchases, equips, claims and daily bonuses push a fresh `me` over
the socket.

## Socket contract

Types live in `packages/shared/src/events.ts`. Rooms used by the server:
`inst:<instanceId>` (everyone in the room), `inst:<instanceId>:user:<id>` (one
player's sockets in that room: table views) and `user:<id>` (all of a player's
sockets: `me`, notices, DMs).

### Client to server

Every command except `chat_read` and `request_state` takes an ack callback that
receives `{ ok: true }` or `{ ok: false, error }`, where `error` is a sentence to
show the player. A handler that throws acks "Something went wrong. Try again."
The client resolves an unanswered command after 10 s with "The server didn't
answer. Try again." and refuses immediately while offline.

| Event | Payload | Notes |
|---|---|---|
| `join_room` | `{ instanceId }` | Id must match `^[\w:.-]{1,128}$`; optional Discord instance check. Replies `lobby_state`, `activity_history`, `chat_history`. Switching rooms leaves the old one. |
| `open_table` | `{ rules: Partial<TableRules> }` | See [Opening and starting](#opening-and-starting) |
| `update_rules` | `{ rules: Partial<TableRules> }` | Host only, while `open` |
| `start_table` | none | Host only; ≥2 eligible players |
| `close_table` | none | Host only; deferred to the end of a hand |
| `watch_table` | none | Join as a spectator |
| `take_seat` | `{ seat, buyIn }` | Joins first if needed; buy-in within the table range and your bankroll |
| `top_up` | `{ amount }` | Stack + queued + amount ≤ max buy-in; queued mid-hand |
| `stand_up` | none | Deferred mid-hand |
| `leave_table` | none | Deferred mid-hand for seated players |
| `sit_out` | `{ sittingOut }` | Immediate |
| `cancel_pending` | none | Clears pending leave/stand and queued top-up |
| `act` | `{ type: 'fold'\|'check'\|'call'\|'raise'\|'all-in', amount? }` | `amount` is the raise-to total for this street |
| `emote` | `{ emote }` | Must own it; rate limited |
| `throw_item` | `{ itemId, targetId }` | Consumes one; target seated, not you |
| `chat_send` | `{ to: { room: true } \| { dm: playerId }, body }` | Rate and length limited |
| `chat_read` | `{ channel }` | No ack. Your DMs or your current room only |
| `request_state` | none | No ack. Members get `table_state`; others get `table_left { code: 'not-member' }` |

### Server to client

| Event | Payload | Sent |
|---|---|---|
| `me` | `PlayerSelf` | On connect, and after anything changes your balance, XP, items or unread counts (coalesced) |
| `lobby_state` | `LobbyState { instanceId, members, table: TableSummary \| null }` | On join, then to the room on every change. Cards-free. |
| `table_state` | `TableView` | To each table member on every change, built for that viewer |
| `table_left` | `{ code, reason }` | When you stop being a member, or in answer to `request_state` |
| `table_fx` | `{ id, kind: 'emote'\|'throw', fromId, toId?, value }` | To the room |
| `chat_message` | `ChatMessage` | Room messages to the room; DMs to both players |
| `chat_history` | `{ channel, messages }` | Room history on join |
| `activity` / `activity_history` | `ActivityEvent` / `ActivityEvent[]` | Live / on join |
| `notice` | `{ id, tone, title, body? }` | To one player (level-ups, sat out, top-up trimmed, host transfer, ...) |

`TableView` carries the rules, status, host, all seats (`SeatPlayer` with stack,
state, connection, cards when visible, last action, pending change), spectators,
the hand (`HandView`: street, board, settled pots, pot total, button and blind
seats, seat to act, turn start and deadline, current bet, result), and `you`
(`ViewerInfo`: role, seat, bankroll, pending change, legal actions when it's
your turn, your emotes).

## Privacy guarantees

- The deck exists only in the server's `Hand`; no payload contains it.
- `TableRoom.viewFor(viewerId)` sets `holeCards` for a seat only when it's the
  viewer's own, or the player is live and either the hand ended at showdown with
  their hand tabled, or betting is over with an all-in run-out (live hands turn
  face up). Folded cards are never shown. Otherwise `holeCards` is null and
  `hasHiddenCards` says whether cards are there.
- Spectators get the same view as any non-owner.
- `lobby_state` never carries cards.
- `GET /me/hands` returns only hands you played, with other players' cards only
  if they were shown at showdown.
- The e2e suite plays full multi-client games and asserts no client ever
  receives an opponent's unshown cards.

## Client architecture

### Boot and state

```
App ── startSession() ──▶ Session { mode, token, me, instanceId, sdk? }
     └─ createClient(session)
          ├─ connectSocket(token)      socket.io, same origin
          ├─ AppStore                  pure reduce(state, event), useSyncExternalStore
          ├─ createCommands(socket)    typed, ack'd, 10 s timeout
          ├─ bindSocket(...)           server events → store; on (re)connect: join_room, request_state
          └─ createApi(token)          typed REST client, 401 → "session expired"
     └─ ClientProvider → NavProvider → ProfileCardProvider → Main + Toaster
```

- `app/session.ts`: Discord SDK or mock sign-in (dev build + `?mock`, optional
  `&name=` and `&room=`). One in-flight sign-in per page load, so StrictMode
  and HMR don't call `authorize()` twice. Failures are typed
  (`outside-discord`, `config`, `auth`, `network`) for the boot screen.
- `app/store.ts`: the whole client state is reduced from events: `me`, `lobby`,
  `table`, `tableLeft`, chat per channel, activity, notices, connection status,
  and `clockOffset` (server clock minus local). `lobby_state` is the source of
  truth for which table exists: if the lobby shows ours gone, the stale table
  view is dropped and late `table_state`s for it are ignored (`closedTables`).
- Hooks (`app/client.tsx`): `useMe`, `useLobby`, `useTable`, `useCommands`,
  `useApi`, `useChannel`, `useRoomChat`, `useTableFx`, `useAppState(selector)`.
- `Main` shows the table screen while you're a table member and the section is
  `table`; everything else is the `Shell` (header, nav rail or phone tab bar,
  section, room sidebar or drawer below 1024 px).

### Code splitting

`app/lazy.ts` wraps `React.lazy` for named exports with a `preload()`. The table
screen, each feature screen (leaderboard, stats, challenges, shop, messages) and
the profile card are separate chunks, preloaded when the page is idle.

### Design system and cosmetics

- `ui/`: store-free primitives (Button, IconButton, Surface, Panel, Modal,
  Drawer, Tabs, Segmented, Field, AmountInput, Slider, ChipAmount, Avatar,
  LevelBadge, Placard, CountBadge, Toasts, EmptyState, Spinner, icons). See
  DESIGN_STANDARDS.
- `cosmetics/`: renderers driven by the shared catalog: `Felt` (with the
  printed Ratbag crest), `CardBack`, `PlayingCard`, `AvatarFrame`, `TitleTag`,
  celebrations (canvas-confetti), `ItemPreview`.

### Table screen

- `table/layout.ts` is a pure geometry engine. Seats sit on the rail of an
  oval, spaced evenly by arc length; your seat is display slot 0 at the bottom
  (spectators see seat 0 there). The oval stands on end in portrait. Every
  element (avatar, plate, shown cards, face-down cards, bets, dealer button,
  pot, board, side pots) is a rectangle. The centre cluster goes in the free
  band, and bets, cards and the button search for a spot that overlaps nothing.
  If a size doesn't fit, the table is laid out again smaller, with a compact
  form on short screens. `layoutConflicts()` reports anything that still
  overlaps; tests keep it empty for 2 to 9 seats at 1280×800, 640×360, 390×844
  and four other sizes.
- `TableStage` renders the felt, seats, markers, `CenterCluster` (pot, board,
  side pots, result lines) and `FxLayer` (chips to the pot, payouts, emotes,
  throwables via the Web Animations API).
- `ActionBar` is built from `you.legal`: fold, check or call, bet or raise with
  presets (min, pot fractions, max; "All-in" only when max is the whole stack).
  Shortcuts: F, C, R, Enter, Esc. Folding when you could check needs a second
  press. `PreActions` queues check/fold, check or call any for your next turn;
  a pre-action expires on a new street or hand.
- `TurnTimer` drains a ring from `actionStartedAt` to `actionEndsAt` corrected
  by `clockOffset`. `TurnPill` keeps your clock visible above menus and
  dialogs.
- `TopBar`, `TableMenu` (seat, host controls, sound, the rest of the app, one
  combined pending-change note with "Cancel all"), `HeroDock` (your hand's
  name), `SeatMenu` (profile, throwables), `EditRulesDialog`, `TopUpDialog`.
- `table/sound/`: `cues.ts` diffs consecutive views into sound cues (pure),
  `SoundManager` plays them with Web Audio, `soundStore` keeps mute and volume in
  localStorage. Clips are in `packages/client/public/audio/`.

## Testing

| Where | What |
|---|---|
| `server/src/engine/*.test.ts` | Rules, with stacked decks (`test-helpers.ts`: `setupHand`, `play`) and the randomised chip-conservation test |
| `server/src/services/*.test.ts` | Bank, recorder, shop, rewards, chat, stats on PGlite (`test/db.ts`: `useTestDb`, `makePlayer`) |
| `server/src/rooms/*.test.ts` | `TableRoom` and `InstanceRoom` through `test/table-harness.ts` (`Harness`, `FAST` timing, `chipsInPlay`) |
| `server/src/test/e2e/` | A real app on a random port driven by `fetch` + `socket.io-client` (`helpers.ts`: `startServer`, `signIn`, `TestClient`, `driveUntil`, `playHands`): API, realtime, table, lifecycle |
| `client/src/**/*.test.ts(x)` | Vitest + React Testing Library on jsdom; `test/harness.tsx` renders screens with a fake socket and API |
| `shared/src/*.test.ts` | Hand evaluator, progression, shop, rules; run with `npm test -w @poker/shared` |

`TEST_DATABASE_URL` runs the DB-backed server tests against real Postgres
(`npm run test:pg -w @poker/server`).

## Production hosting

One Railway service runs the server, which also serves the built client
(`express.static` on `packages/client/dist` with an SPA fallback for anything
outside `/api` and `/socket.io`). Client, REST and WebSocket share one origin
behind Discord's `*.discordsays.com` proxy. CORS allows `*.discordsays.com`,
localhost and `*.trycloudflare.com`. Railway Postgres is the database; the
server migrates it at boot. Deployment steps are in [SETUP.md](./SETUP.md).
