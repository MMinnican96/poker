# Setup

How to run Ratbag Poker Night locally, inside Discord, and in production on
Railway, and how to upgrade an existing deployment.

| Path | You get | Needs |
|---|---|---|
| [A. Zero-setup dev](#a-zero-setup-dev) | Full game in browser tabs, embedded database | Node |
| [B. Local Postgres](#b-local-postgres) | Data kept in a real Postgres | Node, PostgreSQL (native) |
| [C. Real Discord](#c-real-discord) | The Activity inside Discord | A Discord app, a tunnel |
| [D. Production on Railway](#d-production-on-railway) | The live deployment | Railway project + Railway Postgres |
| [E. Upgrading an existing database](#e-upgrading-an-existing-database) | Moving a pre-overhaul deployment over | |

## Prerequisites

- Node.js 22 (LTS) and npm.
- `npm install` at the repo root.
- One `.env` at the repo root, copied from [`.env.example`](../.env.example). The
  server loads it through `packages/server/src/env.ts`; Vite reads it through
  `envDir`. Every variable is optional for path A.

## A. Zero-setup dev

```bash
npm install
npm run dev        # builds shared, then watches shared + server :3001 + client :5173
```

Open two tabs:

- `http://localhost:5173/?mock=1&name=Alice`
- `http://localhost:5173/?mock=1&name=Bob`

What happens:

- `DATABASE_URL` is blank, so the server starts **PGlite**, an embedded Postgres,
  and applies the migrations to it. The log says
  `DATABASE_URL not set — using embedded PGlite (in memory)`. Data is lost on
  restart unless you set `PGLITE_DATA_DIR` (for example `.data/pglite`; the path
  is relative to `packages/server`, and `.data/` is gitignored).
- `?mock=1&name=Alice` signs in as the stable id `mock-alice` with 10,000 starting
  chips. Mock sign-in exists only in a Vite dev build, and the server allows it
  only outside production (`MOCK_AUTH=0` turns it off locally).
- Tabs share a room called `dev-room`. Add `&room=<name>` to use another one.
- Without `JWT_SECRET` the server uses a random secret per run, so restarting it
  signs everyone out. Reload the tabs.

To run a second stack beside the first (for example to compare branches), start
another server on another port and point Vite at it with `VITE_PROXY_TARGET`:

```powershell
$env:PORT = "3002"; npm run dev -w @poker/server
$env:VITE_PROXY_TARGET = "http://localhost:3002"; npm run dev -w @poker/client -- --port 5174
```

## B. Local Postgres

Install PostgreSQL natively. There's no Docker setup for this project.

**Windows:**

```powershell
winget install PostgreSQL.PostgreSQL.17
```

The installer registers a service on port 5432 and creates the `postgres`
superuser. **macOS:** `brew install postgresql@17 && brew services start postgresql@17`.
**Debian/Ubuntu:** `sudo apt install postgresql && sudo systemctl enable --now postgresql`.

Create a role and database (SQL Shell, pgAdmin or `psql -U postgres`):

```sql
CREATE ROLE poker WITH LOGIN PASSWORD 'poker';
CREATE DATABASE poker OWNER poker;
```

Set it in the root `.env`:

```
DATABASE_URL=postgresql://poker:poker@localhost:5432/poker
```

Start the app with `npm run dev`. The server applies any pending migrations at
boot and logs `using Postgres (DATABASE_URL)`. To apply them without starting
the server, run `npm run db:migrate`.

Changing the schema:

1. Edit `packages/server/src/db/schema.ts`.
2. `npm run db:generate -w @poker/server` writes a new SQL file in
   `packages/server/drizzle/`.
3. Make the SQL idempotent by hand (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   `DO $$ ... EXCEPTION WHEN duplicate_object ...`), matching `0000` and `0001`.
4. Restart the server or run `npm run db:migrate`.

Keep schema changes on this path; there is no `db:push` any more (it bypassed
the migration journal).

Running the DB-backed tests against this Postgres instead of PGlite (they share
one database, so files run one at a time):

```powershell
$env:TEST_DATABASE_URL = "postgresql://poker:poker@localhost:5432/poker_test"
npm run test:pg -w @poker/server
```

## C. Real Discord

### 1. Create the Discord application

In the [Developer Portal](https://discord.com/developers/applications):

1. **New Application**, name it.
2. **OAuth2**: copy the **Client ID** and **Client Secret**. Add a redirect
   (`https://127.0.0.1` works); the Embedded App SDK's `authorize()` needs one.
   The client only asks for the `identify` scope.
3. **Installation**: enable **User Install** and **Guild Install**.
4. **Activities → Settings**: turn on **Enable Activities** (this creates the
   Launch entry point command).
5. **Bot**: add a bot, reset and copy the **Bot Token**. It's used server-side to
   read server nicknames and guild avatars, and for the optional instance check.
   No privileged intents are needed.
6. **OAuth2 → URL Generator**: tick `bot`, no permissions, and invite the bot to
   your test server. Unverified Activities only launch in servers with fewer
   than 25 members.

### 2. URL mappings

Discord serves the Activity through its proxy (`<client id>.discordsays.com`).
The client calls `/api` and `/socket.io` on its own origin, so a single mapping
covers everything:

| Prefix | Target |
|---|---|
| `/` | Your tunnel host in development (`<random>.trycloudflare.com`), or your Railway domain in production |

With the root mapping in place, `/api/*` and `/socket.io/*` reach the same
target: Vite proxies them to the server in development, and the server answers
them directly in production. No extra `/api` or `/socket.io` mappings are
needed as long as client and server share that origin.

Avatars load straight from `https://cdn.discordapp.com`. Discord's Activity CSP
allows `cdn.discordapp.com/avatars/` without a mapping, but not guild-specific
avatars (`/guilds/.../avatars/`) or default avatars (`/embed/avatars/`). Those
show the player's initials instead.

### 3. Environment

```
DISCORD_CLIENT_ID=<application id>
DISCORD_CLIENT_SECRET=<client secret>
DISCORD_BOT_TOKEN=<bot token>
VITE_DISCORD_CLIENT_ID=<same as DISCORD_CLIENT_ID>
JWT_SECRET=<long random string>
```

`DATABASE_URL` can stay blank (PGlite) or point at local Postgres.

### 4. Run with a tunnel

```bash
npm run dev
cloudflared tunnel --url http://localhost:5173
```

Put the `https://<random>.trycloudflare.com` host in the root (`/`) URL mapping.
Vite already accepts `*.trycloudflare.com` and proxies `/api` and `/socket.io`
to :3001, so only port 5173 needs exposing. The free tunnel host changes on
every restart; update the mapping each time.

### 5. Launch

1. Discord **User Settings → Advanced**: turn on **Developer Mode**, then
   **Application Test Mode** with your application id.
2. Join a voice channel in the test server, open **Activities**, find the app
   by name, and launch it.

## D. Production on Railway

The whole app is one always-on Railway service plus a Railway Postgres service
in the same project. The server serves the built client, so client, REST and
WebSocket share one origin behind the Discord proxy.

`railway.json` pins the build: builder `RAILPACK`, `npm run build`, start
command `node packages/server/dist/index.js` (run directly so SIGTERM reaches
Node — don't wrap it in `npm run`), healthcheck `/api/health` (120 s timeout),
restart on failure (up to 10 times), and `drainingSeconds: 20` so a deploy
waits for graceful shutdown to cash tables out. The root `package.json` has a
matching `start` script.

In production the server refuses to boot without `DATABASE_URL` (unless
`PGLITE_DATA_DIR` is set deliberately), so an unresolved reference can't
silently start an empty in-memory database. Every statement has a 10 s
timeout.

### 1. Project and database

1. **New Project → Deploy from GitHub repo**, pick this repo. Root directory is
   the repo root.
2. **+ New → Database → PostgreSQL**. Its variables include `DATABASE_URL`
   (private `*.railway.internal` host) and `DATABASE_PUBLIC_URL` (TCP proxy).
3. App service **Settings → Networking → Generate Domain**.

### 2. Variables on the app service

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | A reference to the Postgres service (the name must match). Resolves to the private host. |
| `JWT_SECRET` | Long random string | Required: the server refuses to start in production without it. Changing it signs everyone out. |
| `DISCORD_CLIENT_ID` | Application id | |
| `DISCORD_CLIENT_SECRET` | Client secret | |
| `DISCORD_BOT_TOKEN` | Bot token | Nicknames, guild avatars, instance check |
| `VITE_DISCORD_CLIENT_ID` | Same as `DISCORD_CLIENT_ID` | Inlined into the client **at build time**; changing it needs a redeploy |
| `VERIFY_ACTIVITY_INSTANCE` | `1` (optional) | Refuse `join_room` unless Discord confirms the player is in that Activity instance. Off by default. |

Leave these unset:

- `PORT`: Railway injects it and the server reads it.
- `VITE_SERVER_URL`: the client always uses its own origin. The variable is no
  longer read.
- `MOCK_AUTH`: mock sign-in is always off on Railway (any `RAILWAY_ENVIRONMENT*`
  variable or `NODE_ENV=production` disables it), and production client builds
  don't offer it.
- `PGLITE_DATA_DIR`: only used when `DATABASE_URL` is blank.

### 3. Deploy

1. Push to the deploy branch or press **Deploy**.
2. Watch the logs for `using Postgres (DATABASE_URL)`,
   `serving client from …/client/dist` and `listening on port …`. Migrations run
   before the server listens; nothing needs to run in the build (private
   networking isn't available at build time anyway).
3. In the Developer Portal, set the root (`/`) URL mapping to the Railway domain.

To run migrations or `stats:recompute` from your machine against Railway
Postgres, use the public URL for that one command and don't commit it:

```powershell
$env:DATABASE_URL = "<DATABASE_PUBLIC_URL>"
npm run db:migrate          # or: npm run stats:recompute
```

### Restarts and deploys

- On SIGTERM the server voids any hand in progress, cashes every seated player
  out at their stack from before that hand, tells them the server is restarting,
  and releases its lease.
- If the process dies first, each open seat stays in escrow until a server's
  recovery sees the dead lease go stale (60 s) and refunds the last checkpoint.
  Recovery runs at boot and every 30 s.
- During a rolling deploy the new process leaves the old one's seats alone while
  the old one still heartbeats.

## E. Upgrading an existing database

The first overhaul deploy upgrades the pre-overhaul database in place. There's
no manual step.

- At boot `0000_init.sql` runs against the existing `db:push` schema. It keeps
  `players` (balances), `chip_transactions`, `player_hand_stats` and
  `player_stats`; adds the new tables (`table_seats`, `hand_history`,
  `player_items`, `player_challenges`, `chat_messages`, `chat_reads`), columns
  (XP, daily streak, loadout, `big_blind`, `flops_seen`), CHECK constraints,
  foreign keys and indexes; and drops the never-written `games`, `hands`,
  `game_players` and `hand_actions` tables. `0001_leases.sql` adds
  `server_leases` and `table_seats.lease_id`.
- Every statement is idempotent, so a migration interrupted halfway is safe to
  rerun, and a database that was already `db:push`ed to the new schema is left
  as it is.
- Back up first anyway: Railway Postgres → **Backups**, or
  `pg_dump "<DATABASE_PUBLIC_URL>" > before-overhaul.sql`.

**Deploy with no tables open.** Seats opened by a build without leases have no
lease id, and any running server's recovery treats those as orphaned. If a
lease-less build is still serving a table while the new build boots, the new
build would refund those seats while the old process keeps playing them. The
pre-overhaul build kept stacks in memory and never wrote `table_seats`, so this
matters only when upgrading from an intermediate build without `0001`. Close
tables first (or wait until nobody is playing), then deploy. Every later deploy
is safe with tables open, but hands in progress are voided (see above), so a
quiet moment is still kinder.

Players keep their bankroll, ledger and lifetime stats. XP, levels, items and
challenges start from zero for everyone.

## Scripts

Root scripts (`npm run <name>`):

| Script | Does |
|---|---|
| `dev` | Build shared, then watch shared, server and client |
| `build` | Type-check and build shared, server, client |
| `start` | Start the built server (`packages/server/dist/index.js`) |
| `test` | Server tests (type-check, then Vitest incl. e2e on PGlite) and client tests |
| `db:migrate` | Apply migrations to `DATABASE_URL` |
| `db:studio` | Drizzle Studio |
| `stats:recompute` | Rebuild `player_stats` from `player_hand_stats` |
| `db:generate` | Generate a migration from `schema.ts` (then make it idempotent) |
| `test:pg` | Server tests against `TEST_DATABASE_URL`, files run serially |

Workspace scripts: `npm run db:generate -w @poker/server`,
`npm run test:pg -w @poker/server`, `npm run typecheck -w @poker/server`,
`npm test -w @poker/shared` (shared's own tests; the root `test` doesn't run
them).

`db:migrate` and `stats:recompute` use `DATABASE_URL`. With it blank they run
against a throwaway in-memory PGlite unless `PGLITE_DATA_DIR` is set.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Open this from Discord" in the browser | You opened the app outside Discord without `?mock=1`. Add `?mock=1&name=Alice` (dev server only). |
| Everyone is signed out after a server restart in dev | No `JWT_SECRET`, so each run uses a new random secret. Set one in `.env`. |
| "Your session expired" | The 24 h token lapsed, or `JWT_SECRET` changed. Reload the Activity. |
| Server exits with `JWT_SECRET must be set in production` | Set `JWT_SECRET` on the Railway service. |
| `POST /api/auth/mock` returns 404 | Mock sign-in is off: production, a Railway env var, or `MOCK_AUTH=0`. |
| `ECONNREFUSED 127.0.0.1:5432` on Railway | `DATABASE_URL` isn't resolving to Railway Postgres. Use the reference `${{Postgres.DATABASE_URL}}` with the right service name; the resolved value should be a `*.railway.internal` host. |
| Local `ECONNREFUSED ::1:5432` | Postgres isn't running, or `DATABASE_URL` points at the wrong port. Blank it to use PGlite. |
| "Sign-in didn't go through" / log `Discord token exchange failed (401)` | Wrong `DISCORD_CLIENT_SECRET` or `DISCORD_CLIENT_ID`. |
| "This build isn't set up for Discord" | `VITE_DISCORD_CLIENT_ID` was empty at build time. Set it and redeploy. |
| `join_room` refused with "You're not in this activity." | `VERIFY_ACTIVITY_INSTANCE=1` and Discord didn't list the player, or `DISCORD_BOT_TOKEN` is missing (the log shows `instance check failed`). |
| Avatars show initials inside Discord | The avatar is a guild avatar or a default avatar, which the Activity CSP blocks. See [URL mappings](#2-url-mappings). |
| Log: `refunded N chips from M seats left open by a stopped server` | Recovery after a crash or a shutdown that ran out of time. Expected; players got their last checkpoint back. |
| Log: `tables did not finish cashing out in time` | Shutdown hit its 15 s budget. Recovery refunds the rest. Check `drainingSeconds` in `railway.json`. |
| Migration error on boot | Read the failing statement in the log. A new migration that isn't idempotent fails on databases that already have the object. |
| Blank page at `/` on Railway, no `serving client from` log | The client build didn't land in `packages/client/dist`. Check the build log for `npm run build`. |
| `EADDRINUSE :3001` | Another server is running. Stop it or set `PORT` (dev only). |
| Tunnel host rejected by Vite | `allowedHosts` covers `.trycloudflare.com`; other tunnel providers need adding in `packages/client/vite.config.ts`. |
| Server can't find `@poker/shared` exports after editing shared | The server uses shared's built `dist/`. Run `npm run build -w @poker/shared` (or keep `npm run dev` running). |

How the pieces fit together is in [ARCHITECTURE.md](./ARCHITECTURE.md).
