# CLAUDE.md

Project guidance for Claude Code working in this repository.

## What this is

**Discord Poker** — a multiplayer Texas Hold'em game that runs as a **Discord
Activity** (an embedded iframe app launched from a Discord voice channel).
Players play with persistent chip balances; the table is a 2D cartoon canvas.

## Stack & layout

npm-workspaces monorepo. The **server is the authoritative source of truth** for
all game state; clients render what they receive and send action intents.

```
packages/
├── shared/   @poker/shared — TS types + Socket.io event contracts (ESM, builds to dist/)
├── server/   Node + Express + Socket.io + Drizzle/Postgres
│   └── src/{index.ts, routes/{auth,stats}.ts, discord.ts, db/, engine/, rooms/}
└── client/   React + Phaser 3 (the Activity iframe)
    └── src/{discord.ts, socket.ts, Lobby.tsx, ActionBar.tsx, GameCanvas.tsx, game/}
```

- **engine/** — pure poker rules (deck, hand-evaluator, pot, blinds, actions,
  game-state, showdown). No I/O. Fully unit-tested. Keep it pure.
- **rooms/** — `LobbyManager` (ready/countdown), `GameRoom` (drives the engine,
  turn timer, chip ledger, per-viewer state sanitization, **stats capture**),
  `hand-stats.ts` (pure per-hand stat tracker + fact assembly), `state-view.ts`.
- **db/** — `schema.ts`, `index.ts` (pool + `adjustChips`), and the stats layer:
  `stats.ts` (DB-backed `StatsService` writer + `StatsRepository` reads),
  `stats-aggregate.ts` (pure reducer + summary shaping), `stats-leaderboard.ts`
  (pure metric/rank mapping), `stats-recompute.ts` (backfill script/CLI).

See `docs/ARCHITECTURE.md` for the full picture and `docs/SETUP.md` to run it.

## Status

All 7 implementation batches are complete (scaffold → engine → lobby → game
backend → Phaser UI → edge cases → docs). **82 tests pass**; all packages build.
Current focus: **live setup** — wiring a real Discord application + local
PostgreSQL so it can launch inside Discord (see `docs/SETUP.md`, path B).

Player statistics tracking (per-hand fact table + per-player aggregates + read
APIs at `/api/stats`) is implemented; see
`docs/superpowers/specs/2026-06-20-player-statistics-tracking-design.md`.

## Commands (run from repo root)

| Command | What |
|---|---|
| `npm run dev` | Build `shared`, then run server (:3001) + client (:5173) in watch |
| `npm test` | Vitest suite (engine + lobby + game backend) |
| `npm run build` | Type-check + build all three packages |
| `npm run db:push` | Sync Drizzle schema to Postgres (uses the `pg` driver + `DATABASE_URL`) |
| `npm run stats:recompute` | Rebuild `player_stats` aggregates from the `player_hand_stats` fact table |

After any change, verify with `npm test` and `npm run build` before claiming done.

## Run modes

- **Dev mock mode** (zero setup): `npm run dev`, then open
  `http://localhost:5173/?mock=1&name=Alice` and `...&name=Bob` in two tabs. The
  client fakes Discord identity (gated by `import.meta.env.DEV` + `?mock`) and the
  server uses an in-memory chip ledger when `DATABASE_URL` is unset.
- **Real Discord**: requires a Discord app + local Postgres (the auth route
  upserts players into the DB). Full steps in `docs/SETUP.md` path B.

## Conventions & gotchas

- **No Docker for local Postgres** — install Postgres natively (user preference).
- **Env**: a single **root `.env`** (gitignored) is the source of truth. The
  server loads it via `packages/server/src/env.ts` (resolves `../../.env` from the
  workspace cwd); the Vite client reads it via `envDir` → repo root. `.env.example`
  is the template.
- **Chip model**: bankroll persists in `players.chip_balance`; chips move via
  `adjustChips()` in a single transaction with a **unique `idempotency_key`**.
  Buy-in deducted at game start (`${gameId}:buyin:${id}`), remaining stack cashed
  out on leave/game-end (`${gameId}:cashout:${id}`). Live game state is in memory;
  bankroll + ledger + **player stats** are persisted (the `games`/`hands` audit
  tables exist but still aren't written — stats use their own tables, below).
- **Security**: the deck is never part of `GameState` (lives in the server-only
  `HandContext`); opponents' hole cards are nulled via `viewFor()` until showdown.
  Identity is resolved server-side from the OAuth code — never trust client claims.
- **Module resolution**: `@poker/shared` is ESM (NodeNext) and built to `dist/`.
  The server consumes the **built** package via the workspace symlink — do **not**
  re-add a `paths` alias to `shared/src` in `packages/server/tsconfig.json` (it
  breaks `rootDir`). Keep `shared/src` to `.ts` only (no compiled artifacts).
- **ChipService / StatsService** are both injected (`rooms/index.ts`), so
  `GameRoom`/engine stay DB-free and unit-testable; tests use fake recording
  services + a fake io. Real DB impls bind only when `DATABASE_URL` is set; no-op
  otherwise (mock mode).
- **Player stats** (hybrid model): `GameRoom` captures per-hand facts via the pure
  `HandStatsTracker` and writes them through `StatsService`. Two tables:
  `player_hand_stats` (append-only **fact** table, the retrospective source of
  truth) and `player_stats` (denormalized per-player **aggregates** for fast
  reads). Facts are idempotent on `UNIQUE (game_id, player_id, hand_number)`
  (`onConflictDoNothing`); only newly-inserted facts update aggregates, so a
  replay can't double-count. Ratios (win rate, VPIP, PFR, aggression, showdown%)
  are **derived at read time, never stored**. `player_hand_stats.game_id` has **no
  FK** (the in-memory game id; the games table isn't written); `player_id` columns
  do FK to `players`. Session play-time/`games_played` are recorded at-most-once
  at game end and are **not** rebuildable from facts, so `stats:recompute`
  preserves them while rebuilding everything else. Reads are served by
  `StatsRepository` over `GET /api/stats/*` (session-cookie auth; no-op in mock
  mode). See `docs/ARCHITECTURE.md` → Player statistics.
- **Postgres 18 + drizzle-kit**: `db:push` needs **drizzle-kit ≥ 0.31** on PG17+.
  Older 0.30.x mis-reads PG's named NOT NULL constraints and emits a spurious
  `DROP CONSTRAINT "<table>_<col>_not_null"` for every column, failing on the
  `players` PK (`42P16: column … is in a primary key`). Avoid columns that are
  **both** PRIMARY KEY and FOREIGN KEY where possible — older drizzle-kit pushes
  also choke on them.
- **Tests** live next to source as `*.test.ts` (excluded from the `tsc` build).

## Deferred / not yet done

- Live Discord OAuth + `db:push` against real Postgres + a 2-tab Discord session
  (needs the user's credentials/infra — in progress).
- Persisting hand history to the games/hands audit tables (separate from the
  player_hand_stats fact table, which IS written).
- Production deploy (Railway + Vercel) — migration notes in `docs/ARCHITECTURE.md`.
