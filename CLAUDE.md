# CLAUDE.md

**Ratbag Poker Night**: multiplayer no-limit Texas Hold'em that runs as a
**Discord Activity** (an iframe app launched from a voice channel). Persistent
chip bankrolls, one table per Activity instance, and around it a leaderboard,
stats, challenges with XP and levels, a cosmetics shop, profile cards, room chat
and DMs. Live in production on Railway.

## How you should act

- Read current documentation (context7 / `find-docs`) before using a library
  API. The stack is recent: React 19, Vite 8, Vitest 5, Tailwind 4, Drizzle 0.45,
  PGlite 0.5, Socket.io 4.
- Every change ships with tests: unit tests next to the source, and an e2e test
  in `packages/server/src/test/e2e/` when it crosses the socket or REST boundary.
- Keep the docs true: update `docs/` and this file in the same change as the
  behaviour they describe.
- Sub-agents that write code run on Opus. Orchestrate work as
  **implement → review → fix**: one agent implements, a separate agent reviews
  the diff against the spec and the invariants below, the findings get fixed.
- Done means `npm test` and `npm run build` both pass.

## Layout

npm-workspaces monorepo. The server is the single source of truth; clients
render what they're sent and send intents.

```
packages/
  shared/   @poker/shared: wire types + socket contract (events.ts), table rules
            and validation, hand evaluator, shop catalog, levels/challenges, format
  server/
    src/index.ts        boot: DB + migrations, lease, recovery, listen, graceful shutdown
    src/app.ts          Express + Socket.io app factory (createApp), serves client/dist
    src/auth.ts         session JWTs, mock-auth gate      src/discord.ts  Discord HTTP calls
    src/engine/         pure poker rules (hand.ts, pots.ts, deck.ts)
    src/rooms/          InstanceRoom + RoomManager, TableRoom, Serial queue + RateLimiter
    src/services/       bank, leases, recorder, hand-facts, stats-repo, rewards, shop,
                        chat, profiles, players, recompute (CLI)
    src/socket/realtime.ts   socket auth + every event handler
    src/http/api.ts          REST routes
    src/db/             schema.ts, client.ts (Postgres or PGlite), migrate-cli.ts
    drizzle/            SQL migrations + journal (applied at boot)
    src/test/           useTestDb, table Harness, e2e/ (real app on a random port)
  client/src/
    app/        session, api, socket, store (reducer), client, nav, lazy, Boot, Toaster
    ui/         design-system primitives (Button, Modal, Drawer, Tabs, ChipAmount...)
    cosmetics/  catalog-driven renderers (Felt, CardBack, PlayingCard, AvatarFrame...)
    lobby/      Shell, NavBar, Header, RoomPanel, TableHome, MiniTable, dialogs
    table/      TableScreen, TableStage, layout.ts (geometry engine), Seat, ActionBar,
                PreActions, FxLayer, TopBar, TableMenu, HeroDock, sound/
    features/   leaderboard, stats, challenges, shop, messages, profile (lazy chunks)
    index.css   every design token (@theme)
```

## Running

| Mode | How |
|---|---|
| Zero-setup dev | Leave `DATABASE_URL` blank, `npm run dev`, open `http://localhost:5173/?mock=1&name=Alice` and `...&name=Bob`. The server runs embedded **PGlite** (in memory, or on disk with `PGLITE_DATA_DIR`). `&room=x` picks the room (default `dev-room`). |
| Local Postgres | Set `DATABASE_URL` in the root `.env`; migrations apply at boot. |
| Real Discord | Discord app + tunnel; see `docs/SETUP.md`. |
| Production | One Railway service + Railway Postgres; see `docs/SETUP.md`. |

## Commands

| Command | What |
|---|---|
| `npm run dev` | Build `shared`, then watch shared + server (:3001) + client (:5173) |
| `npm run build` | Type-check and build shared, server, client |
| `npm test` | Server (type-checks tests, then Vitest incl. e2e on PGlite) and client (Vitest + RTL) |
| `npm test -w @poker/shared` | Shared package tests (the root `npm test` leaves these out) |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` by hand (boot does this too) |
| `npm run db:generate -w @poker/server` | Generate a migration from `schema.ts` |
| `npm run stats:recompute` | Rebuild `player_stats` from the `player_hand_stats` facts |
| `TEST_DATABASE_URL=... npm run test:pg -w @poker/server` | DB-backed tests against real Postgres, files run serially |

Schema changes go through migrations (`db:generate`, then make the SQL
idempotent). There is no `db:push`.

## Invariants

- **Server authoritative.** Identity comes from the signed session token, and
  balances, cards and legal actions come from the server. Payloads from
  clients are validated field by field (`pickRules`, `num`, `validateRules`).
- **Engine is pure.** `engine/` has no I/O, timers or DB; randomness is injected
  (`RandomInt`). The chip-conservation property test must stay green.
- **Chips move only through `Bank`** (`services/bank.ts`). A chip lives in exactly
  one place: `players.chip_balance` or an open `table_seats` row (escrow). Every
  movement is one transaction with a `chip_transactions` row whose
  `idempotency_key` is unique. CHECK constraints keep balances, stacks and item
  quantities ≥ 0. Lock order is player row, then seat row. The bank API works by
  seat id.
- **TableRoom serial queue.** Buy-ins, top-ups, cash-outs, checkpoints, boundary
  resolution and dealing all run through the table's `Serial`, and the queued
  step re-checks its preconditions. Keep new bank-touching table work in it.
- **Leases and recovery.** Each process holds a `server_leases` row (heartbeat
  10 s, DB clock). Seats carry the lease that opened them. Recovery (boot +
  every 30 s) refunds only seats whose lease is missing or stale (60 s) at their
  last checkpoint. A process that loses its lease voids its tables without
  cashing out (`table_left 'interrupted'`) and re-registers. SIGTERM/SIGINT
  cashes every table out (15 s budget, 18 s hard exit), then drops the lease;
  `railway.json` sets `drainingSeconds: 20` and starts `node` directly.
- **Migrations run at boot** for both PGlite and Postgres. `0000_init.sql` and
  `0001_leases.sql` are hand-written to be idempotent (`IF NOT EXISTS`,
  `DO ... EXCEPTION WHEN duplicate_object`) so they also upgrade the
  pre-overhaul `db:push` database in place. Every new migration must be
  idempotent too.
- **One DB code path.** Services are written once against Drizzle; PGlite and
  node-postgres share it. Tests run real SQL on PGlite.
- **Auth.** `POST /api/auth/token` (Discord) or `/api/auth/mock` returns an HS256
  JWT (24 h). The socket sends it in `handshake.auth.token`; REST sends
  `Authorization: Bearer`. Mock sign-in is refused whenever `NODE_ENV=production`
  or a Railway env var is present, and the client offers it only in dev builds.
- **Card privacy.** The deck lives only in the server-side `Hand`. `viewFor()`
  shows a player their own cards, and others' only at showdown, in an all-in
  run-out, or when that player chose to show them (`show_cards`), and then only
  once the hand is complete. Hand history hides opponents' unshown cards (cards
  shown by choice included).

## Conventions

- `@poker/shared` builds to `dist/`. The server consumes the build, so rebuild
  shared after changing it (`npm run dev` watches it). The client resolves
  shared from source via an alias.
- Styling uses tokens only: colours, fonts and shadows come from `@theme` in
  `packages/client/src/index.css`, and cosmetic colours come from the shared
  catalog. See `docs/DESIGN_STANDARDS.md`.
- The table layout (`table/layout.ts`) models every piece as a rectangle and
  checks itself; `layout.test.ts` keeps `layoutConflicts()` empty for 2 to 9
  seats at the supported sizes. A layout change must keep it empty.
- Copy is sentence case and says what happens ("Take a seat"). Ack errors are
  player-facing sentences.
- Tests sit next to the source (`*.test.ts(x)`). Server e2e tests are in
  `src/test/e2e/`, built on `helpers.ts` (`startServer`, `TestClient`,
  `driveUntil`, `playHands`); assert a non-event by waiting for a later
  sentinel event on the same socket. Table unit tests use `test/table-harness.ts`.
  Server Vitest only includes `src/**/*.test.ts`, so a stale `dist/` is ignored.

## Preferences

- Local Postgres is installed natively. The project has no Docker or
  docker-compose files, and should stay that way.
- One root `.env` is the source of truth (the server loads it via `src/env.ts`,
  Vite via `envDir`). `.env.example` is the template.
- Production is a single Railway service (client, REST and WebSocket on one
  origin) plus Railway Postgres, pinned in `railway.json`.

## Docs

- `docs/ARCHITECTURE.md`: data flow, table lifecycle, engine rules, bank,
  stats pipeline, REST and socket contracts, client architecture.
- `docs/SETUP.md`: local dev, Discord app, Railway, upgrading, troubleshooting.
- `docs/DESIGN_STANDARDS.md`: tokens, components, copy, motion, accessibility.
- `docs/To-do.md` (ideas) and `RELEASE_NOTES.md`.
- `docs/superpowers/` holds dated specs and plans. They're history, except
  `specs/2026-09-23-overhaul-design.md`, which describes the current system.
