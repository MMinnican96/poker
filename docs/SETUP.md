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

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Under **Settings → Activities**, enable Activities.
3. **OAuth2**: note the **Client ID** and **Client Secret**. The app requests these
   scopes at runtime: `identify`, `guilds.members.read`, `rpc.activities.write`.
4. **Bot**: add a bot, copy the **Bot Token** (used server-side to read the
   player's server nickname + guild avatar). Invite the bot to your test server.
5. **Activities → URL Mappings**: add a mapping
   - Prefix `/api` → Target `localhost:3001` (dev) — later your Railway URL in prod.
6. Leave the **Activity URL override** for after you start the tunnel (step 5).

### 2. Set up local PostgreSQL (no Docker)

Install Postgres 16 natively, then create the role and database. Using `psql`:

```sql
CREATE ROLE poker WITH LOGIN PASSWORD 'poker';
CREATE DATABASE poker OWNER poker;
```

(On Windows you can run these in the `psql` shell or pgAdmin; on macOS:
`brew install postgresql@16 && brew services start postgresql@16`.)

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
Portal as the **Activity URL override**. (The Vite dev server already allows
`*.trycloudflare.com` hosts and proxies `/api` + `/socket.io` to the backend, so
the tunnel only needs to expose port 5173.)

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
