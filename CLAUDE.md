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
│   └── src/{index.ts, routes/auth.ts, discord.ts, db/, engine/, rooms/}
└── client/   React + Phaser 3 (the Activity iframe)
    └── src/{discord.ts, socket.ts, Lobby.tsx, ActionBar.tsx, GameCanvas.tsx, game/}
```

- **engine/** — pure poker rules (deck, hand-evaluator, pot, blinds, actions,
  game-state, showdown). No I/O. Fully unit-tested. Keep it pure.
- **rooms/** — `LobbyManager` (ready/countdown), `GameRoom` (drives the engine,
  turn timer, chip ledger, per-viewer state sanitization), `state-view.ts`.

See `docs/ARCHITECTURE.md` for the full picture and `docs/SETUP.md` to run it.

## Status

All 7 implementation batches are complete (scaffold → engine → lobby → game
backend → Phaser UI → edge cases → docs). **54 tests pass**; all packages build.
Current focus: **live setup** — wiring a real Discord application + local
PostgreSQL so it can launch inside Discord (see `docs/SETUP.md`, path B).

## Commands (run from repo root)

| Command | What |
|---|---|
| `npm run dev` | Build `shared`, then run server (:3001) + client (:5173) in watch |
| `npm test` | Vitest suite (engine + lobby + game backend) |
| `npm run build` | Type-check + build all three packages |
| `npm run db:push` | Sync Drizzle schema to Postgres (uses the `pg` driver + `DATABASE_URL`) |

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
- **Env is per-package**: server vars in `packages/server/.env`, client vars in
  `packages/client/.env` (both gitignored). `.env.example` at root is the template.
- **Chip model**: bankroll persists in `players.chip_balance`; chips move via
  `adjustChips()` in a single transaction with a **unique `idempotency_key`**.
  Buy-in deducted at game start (`${gameId}:buyin:${id}`), remaining stack cashed
  out on leave/game-end (`${gameId}:cashout:${id}`). Live game state is in memory;
  only bankroll + ledger are persisted (the `games`/`hands` audit tables exist but
  aren't written yet).
- **Security**: the deck is never part of `GameState` (lives in the server-only
  `HandContext`); opponents' hole cards are nulled via `viewFor()` until showdown.
  Identity is resolved server-side from the OAuth code — never trust client claims.
- **Module resolution**: `@poker/shared` is ESM (NodeNext) and built to `dist/`.
  The server consumes the **built** package via the workspace symlink — do **not**
  re-add a `paths` alias to `shared/src` in `packages/server/tsconfig.json` (it
  breaks `rootDir`). Keep `shared/src` to `.ts` only (no compiled artifacts).
- **ChipService** is injected (`rooms/index.ts`), so `GameRoom`/engine stay
  DB-free and unit-testable; tests use a fake recording ledger + a fake io.
- **Tests** live next to source as `*.test.ts` (excluded from the `tsc` build).

## Deferred / not yet done

- Live Discord OAuth + `db:push` against real Postgres + a 2-tab Discord session
  (needs the user's credentials/infra — in progress).
- Persisting hand history to the audit tables.
- Production deploy (Railway + Vercel) — migration notes in `docs/ARCHITECTURE.md`.
