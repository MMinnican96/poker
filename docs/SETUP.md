# Setup Guide

A multiplayer Texas Hold'em game that runs as a **Discord Activity** (an embedded
iframe app). This guide covers two paths:

- **[A. Quick local play](#a-quick-local-play-no-discord-no-database)** — click through the
  whole game in your browser in ~1 minute, no Discord app and no database.
- **[B. Full Discord Activity](#b-full-discord-activity)** — the real thing, embedded in a
  Discord voice channel with persistent chip balances.

---

## Prerequisites

| Tool | Needed for | Notes |
|---|---|---|
| **Node.js 20+** | everything | `node --version` |
| **PostgreSQL 16** (native install) | path B only | No Docker — install Postgres directly |
| **cloudflared** | path B only | Free HTTPS tunnel for local Discord dev |
| **A Discord application** | path B only | Created at the Developer Portal |

Install dependencies once:

```bash
npm install
```

---

## A. Quick local play (no Discord, no database)

The server boots without a database (it falls back to an in-memory chip ledger),
and the client has a **dev mock mode** that skips Discord auth and takes your
identity from the URL.

```bash
npm run dev
```

This starts the server on **:3001** and the client on **:5173**. You'll see
`running without persistence (dev/mock mode)` in the server log.

Open **two browser tabs** with distinct names:

```
http://localhost:5173/?mock=1&name=Alice
http://localhost:5173/?mock=1&name=Bob
```

Both land in the same lobby (`dev-room`) with 10,000 chips. Ready up in both →
**Start Game** → the table deals and each tab gets its own action bar on its turn.

**Mock URL params:**

| Param | Default | Purpose |
|---|---|---|
| `mock` | — | Presence enables mock mode (dev builds only) |
| `name` | random | Display name (use distinct names per tab) |
| `room` | `dev-room` | Lobby id — change to run separate tables |
| `chips` | `10000` | Starting balance |
| `user` | `mock-<name>` | Stable player id |

> Mock mode is gated by `import.meta.env.DEV` **and** `?mock`, so a production
> build can never bypass real Discord auth.

---

## B. Full Discord Activity

### 1. Create the Discord application

1. **New application.** Go to <https://discord.com/developers/applications> →
   **New Application**, name it, accept the terms.
2. **Client credentials.** Open **OAuth2** in the sidebar and copy the
   **Client ID** and **Client Secret** (reset the secret if needed). The client
   requests these scopes at runtime (already wired in code, nothing to set here):
   `identify`, `guilds.members.read`, `rpc.activities.write`.
3. **Bot + token.** Open **Bot** → **Add Bot**. Click **Reset Token** and copy the
   **Bot Token** (used server-side to read each player's server nickname + guild
   avatar). You don't need any privileged gateway intents — the app reads members
   over REST, which only requires the bot to be in the server.
4. **Invite the bot to your test server.** Go to **OAuth2 → URL Generator**, tick
   the **`bot`** scope, leave permissions empty (default is fine), open the
   generated URL, and add the bot to a server you can test in.
5. **Enable the Activity.** Open **Activities** (sidebar) → enable / set up the
   activity. Under **Activities → URL Mappings** you'll set the **root (`/`)
   mapping** to your tunnel URL in step 5 (once you have it). A single root mapping
   is enough for local dev — the Vite dev server proxies `/api` and `/socket.io`
   to the backend on :3001, so you don't need a separate `/api` mapping in dev.
   (In production you'd add a `/api` prefix mapping pointing at the Railway URL.)

Keep the **Client ID**, **Client Secret**, and **Bot Token** handy for step 3.

### 2. Install and set up local PostgreSQL (no Docker)

#### 2a. Install PostgreSQL 16

**Windows (winget):**

```powershell
winget install PostgreSQL.PostgreSQL.16
```

Approve the UAC prompt. The installer registers a Windows **service** (auto-starts
on boot), creates a `postgres` superuser, and listens on port **5432**. If it asks,
set a superuser password you'll remember and keep the default port 5432. You can
skip Stack Builder at the end.

> Alternatively, download the EDB installer from
> <https://www.postgresql.org/download/windows/> and run it.

**macOS:** `brew install postgresql@16 && brew services start postgresql@16`
**Linux (Debian/Ubuntu):** `sudo apt install postgresql-16 && sudo systemctl enable --now postgresql`

Confirm it's running — something should be listening on 5432:

```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen
```

#### 2b. Create the role and database

Open a SQL shell as the superuser. On Windows the installer adds **"SQL Shell
(psql)"** to the Start menu (press Enter through the prompts, then enter the
`postgres` password). Alternatively use **pgAdmin**, or `psql -U postgres` if
`psql` is on your PATH (it's under
`C:\Program Files\PostgreSQL\16\bin`). Then run:

```sql
CREATE ROLE poker WITH LOGIN PASSWORD 'poker';
CREATE DATABASE poker OWNER poker;
```

> You only need `psql`/pgAdmin to run these two statements. `npm run db:push`
> (step 4) connects through the Node `pg` driver using `DATABASE_URL`, so `psql`
> does **not** need to be on your PATH for the app itself.

### 3. Configure environment variables

Config is loaded per workspace, so create **two** `.env` files (both gitignored).
See [`.env.example`](../.env.example) for the full template.

**`packages/server/.env`**

```bash
DATABASE_URL=postgresql://poker:poker@localhost:5432/poker
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_BOT_TOKEN=your_bot_token
JWT_SECRET=any-long-random-string
PORT=3001
```

**`packages/client/.env`**

```bash
VITE_DISCORD_CLIENT_ID=your_client_id
# Leave VITE_SERVER_URL empty in dev — the Vite proxy forwards to :3001.
VITE_SERVER_URL=
```

### 4. Create the database schema

```bash
npm run db:push     # drizzle-kit: syncs the schema straight to Postgres
```

Optional: `npm run db:studio` opens Drizzle Studio to browse tables.

### 5. Start the dev servers and tunnel

```bash
npm run dev         # shared (built) + server :3001 + client :5173
```

In a second terminal, expose the client over HTTPS:

```bash
cloudflared tunnel --url http://localhost:5173
```

Copy the `https://<random>.trycloudflare.com` URL into the Discord Developer
Portal under **Activities → URL Mappings** as the **root (`/`) mapping** target
(some portal versions also expose a per-developer **Activity URL override** for
local testing — set that too if present). The Vite dev server already allows
`*.trycloudflare.com` hosts and proxies `/api` + `/socket.io` to the backend, so
the tunnel only needs to expose port 5173.

> The free `trycloudflare.com` URL changes every time you restart the tunnel —
> update the mapping whenever it changes.

### 6. Launch in Discord

In a server where your bot is present, join a voice channel → **Activities** →
launch your app. It authenticates you, shows your server nickname + avatar, and
drops you into the lobby.

---

## Scripts

Run from the repo root:

| Script | Action |
|---|---|
| `npm run dev` | Build `shared`, then run server + client in watch mode |
| `npm run build` | Type-check and build all three packages |
| `npm test` | Run the Vitest suite (engine + lobby + game backend) |
| `npm run db:push` | Sync the Drizzle schema to Postgres |
| `npm run db:migrate` | Apply generated migrations |
| `npm run db:studio` | Open Drizzle Studio |

---

## Testing

```bash
npm test          # 54 tests: poker engine, lobby flow, game backend
npm run build     # confirms all packages type-check and build
```

The test suite needs **no** Discord and **no** database — engine logic is pure,
and the lobby/game integration tests run a real in-memory Socket.io server with a
faked chip ledger.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser shows "Couldn't start" | Expected outside Discord — use mock mode (path A) or launch inside Discord. |
| `DATABASE_URL is not set` when hitting `/api/auth/token` | Create `packages/server/.env` with `DATABASE_URL` (path B). |
| Server log: `running without persistence` | No `DATABASE_URL` — fine for mock play, set it for real games. |
| `EADDRINUSE :3001` | Another server instance is running; stop it or change `PORT`. |
| Discord can't load the Activity | Re-check the URL override (must be the current tunnel URL) and the `/api` URL mapping. |
| Tunnel host rejected by Vite | Confirmed allowed via `allowedHosts: ['.trycloudflare.com']` in `packages/client/vite.config.ts`. |

For how it all fits together, see [ARCHITECTURE.md](./ARCHITECTURE.md).
