# Join/Leave/Spectate Fixes + Host Refactor — Design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan

## Goal

Fix five reported issues in the spectate/join/leave table system and refactor the
lobby host model from "first player to join is host" to an explicit
"anyone can **Create a Game**" model. Only one game can be hosted at a time
(unchanged). Styling reuses the existing lobby design.

## Background

The spectate/join/leave feature shipped (see
`docs/superpowers/specs/2026-06-20-*` and `docs/ARCHITECTURE.md` → Table
membership). `GameRoom` owns the full table population as role-tagged `Member[]`
(`seated | spectator`), resolving transitions at hand boundaries via
`applyPending()`. The lobby folds a cards-free `ActiveGameSummary` into
`LobbyState.activeGame` and currently **filters table members out** of the lobby
player list. Client lobby↔table routing is driven by `joined_table` /
`left_table` events.

Reported issues (from `docs/To-do.md` → Known Bugs):

1. **Blank screen until your turn.** When the game launches and it isn't your
   turn, the table is blank until it becomes your turn; then it renders correctly
   and stays correct. Can also affect the initial player.
2. **Departed player still shown seated.** With 2 players, when one moves to
   spectate/leaves, that player still shows on the table instead of being moved
   off.
3. **No rejoin UI.** Once a player is in spectate there's no visible way to
   cancel spectate / rejoin the table.
4. **Lobby status + chips stale.** The lobby player-list status doesn't update
   when a player returns to the lobby (still shows "In-Game" instead of
   "In Lobby"); chip values also don't refresh until a full reload. Want richer
   statuses: "In-Game · At Table" and "In-Game · Spectating".
5. **Can't start a new game after a table ends; broken host tracking.** With 2
   players, when the host leaves after the other player, back in the lobby the
   non-host can ready up but the original host can't start. Host must be
   re-tracked. Refactor host so it's not the first joiner: when there's no active
   game, anyone can **Create a Game** with their selected settings; once hosted,
   the view switches to ready-up as today.

## Out of Scope

- The unrelated all-in over-call bug (To-do "Known Bugs" #3 — a follow-up all-in
  should call for the correct amount, not shove). Not in this effort.
- Multiple concurrent games / lobby list. Still exactly one game at a time.
- Persisting hand history to the games/hands audit tables (already deferred).

## Approved Decisions

1. **Pre-create settings:** each lobby player edits their **own local draft** of
   the steppers (client-only state). Whoever clicks "Create a Game" locks in
   *their* current settings as the game config.
2. **Host leaves before start:** **auto-transfer** the host role to another
   remaining player; the formed game and its settings persist, ready states kept.
3. **Table members in lobby:** show them **inline in the Players list** tagged
   "In-Game · At Table" / "In-Game · Spectating" (stop filtering them out).
4. **Host can disband:** add a **"Cancel Game"** control that returns the lobby to
   the no-host waiting state before the countdown starts.

---

## Architecture

Server stays authoritative. Three coordinated changes:

1. **Lobby host model** (`rooms/lobby.ts`): `hostId` becomes an explicit,
   transferable field surfaced in `LobbyState`. New `createGame` / `cancelGame`
   operations; host-only `startCountdown`; reset on game end. The host can keep
   editing the config after creation (`update_config`, host-only while forming).
2. **Game view correctness** (`rooms/game.ts`): a single `currentView(viewerId)`
   that renders a synthetic **waiting** `GameState` from the real seated members
   when the table is idle (`<2` seated) or `ctx` is null, instead of the stale
   last-hand `ctx`. A `request_game_state` event lets a freshly-mounted (or
   reconnecting) client pull the current view. `member.bankroll` is kept in sync
   and changes are pushed to the lobby for live chip display.
3. **Client** (`App.tsx`, `GameCanvas.tsx`, `lobby/*`): host derived from
   `lobby.hostId`; Create-a-Game / Cancel-Game UI; richer per-player status
   labels; request state on mount.

### Data flow (host lifecycle)

```
no active game, hostId = null
  every lobby player: editable steppers (local draft) + "Create a Game"
        │  create_game(config)
        ▼
hostId = creator, status 'waiting' (forming); host can still edit config
  host: START GAME (≥1 other ready) + Cancel Game
  others: Ready toggle
        │  cancel_game (host)        │ start_countdown (host, ≥2 ready)
        ▼                            ▼
   back to hostId = null        status 'countdown' → 'in-game' (GameRoom)
                                     │  game ends (0/1 seated)
                                     ▼
                          reset: hostId = null, ready cleared, status 'waiting'
```

---

## Component Changes

### Shared contracts (`packages/shared/src`)

**`types.ts`:**
- `LobbyState` gains `hostId: string | null`.
- `LobbyStatus` enum is **unchanged** (`'waiting' | 'countdown' | 'in-game'`).
  "Open vs forming" is distinguished by `hostId` nullability while
  `status === 'waiting'`.

**`events.ts`:**
- `ClientToServerEvents`: **add** `create_game: (config: TableConfig) => void`,
  `cancel_game: () => void`, `request_game_state: () => void`. **Keep**
  `update_config` (now host-only live editing while forming).
- `ServerToClientEvents`: unchanged (`game_state_update` carries the requested
  view; `lobby_state_update` carries `hostId`).

### Server — lobby (`packages/server/src/rooms/lobby.ts`)

- `addPlayer`: **do not** auto-assign `hostId`. **Preserve** an existing player's
  `chipBalance` on re-add (mirrors the existing `isReady` preservation), so the
  `join_lobby` re-emit on table→lobby return doesn't clobber the live balance.
- `createGame(socketId, config)`: only when `hostId === null` **and** no active
  game; the caller must afford the buy-in. Validate via existing
  `sanitizeConfig`, set `hostId = caller`, store config, broadcast.
- `cancelGame(socketId)`: host-only, only while `status === 'waiting'` with
  `hostId` set; clear `hostId`, clear all ready flags, broadcast.
- `removeBySocket`: if the removed player is the host and the game is forming or
  in countdown, reassign `hostId` to the next remaining player (or `null` if
  none). Keep the existing "cancel countdown if <2 ready" behaviour.
- `startCountdown(socketId)`: **enforce host-only** (in addition to the existing
  ≥2 ready / waiting checks).
- `updateConfig(socketId, patch)`: **kept**, gating changed to **host-only while
  forming** — allowed when `socketId` is the host and `status === 'waiting'` with
  `hostId` set. The old `readyCount === 0` restriction is dropped so the host can
  still tweak settings after players ready up (funding is re-checked at countdown
  finish, as today). Pre-creation edits remain purely client-local (no
  `update_config` until a game exists).
- `resetAfterGame()`: new method — `hostId = null`, clear ready flags, status
  `'waiting'`, broadcast. Called from `rooms/index.ts` `onEnd`.
- `updateChipBalance(playerId, balance)`: new method — update the stored
  `LobbyPlayer.chipBalance` and broadcast. Called from the `GameRoom` chip hook.
- `toState()`: include `hostId`; **stop filtering table members out** of
  `players` (the client tags them by role from `activeGame.members`).

### Server — game (`packages/server/src/rooms/game.ts`)

- `currentView(viewerId): GameState` — the single source for a viewer's table
  view:
  - If a hand is in progress and `ctx` exists **and** seated ≥ 2:
    `viewFor(ctx.state, viewerId)` augmented with `spectators`,
    `waitingForPlayers`, `viewerPending` (today's `tableView`).
  - Otherwise (idle `<2` seated, or `ctx` null): a synthetic **waiting**
    `GameState` built from the current seated members — `phase: 'waiting'`,
    `players` = seated members with `holeCards: null`, empty `communityCards` /
    `pots`, `waitingForPlayers: true`, plus `spectators` and `viewerPending`.
- `broadcastState()`: send `currentView(...)` to every non-left member; **no
  longer early-returns when `ctx` is null** (so idle/pre-hand broadcasts work and
  spectator-join into an idle table renders).
- `request_game_state` handler: reply to the requesting socket with
  `game_state_update = currentView(viewerId)`.
- Chip-balance sync: keep `member.bankroll` accurate — `-= buyIn` on buy-in and
  sit-in, `+= amount` on cash-out (spectate/leave/bust/game-end) — and invoke a
  new `onChipBalanceChange?(playerId, bankroll)` callback after each change.
- The waiting-view path is what fixes Bugs 2 & 3: a departed player is no longer
  rendered as a seated `GamePlayer`, so the client's `seated` check is correct and
  `SpectatorControls` shows the rejoin controls.

### Server — wiring (`packages/server/src/rooms/index.ts`)

- Register `create_game`, `cancel_game`, `request_game_state`; keep
  `update_config`.
- Set `game.onChipBalanceChange = (id, bal) => lobbyRoom?.updateChipBalance(id, bal)`.
- In `onEnd`, call `lr.resetAfterGame()` (in addition to clearing the active-game
  provider and rebroadcasting).

### Client — routing & game (`App.tsx`, `GameCanvas.tsx`, `SpectatorControls.tsx`)

- `GameCanvas`: on mount (and after reconnect), `socket.emit('request_game_state')`
  so the initial view is never missed (fixes Bug 1).
- `SpectatorControls`: no code change required for the rejoin button itself — it
  already renders "Join Next Hand" when `!seated`; it starts working once the
  server stops reporting a departed player as seated. (Verify with a test.)

### Client — lobby (`lobby/LobbyScreen.tsx`, `TableSettings.tsx`, `PlayersPanel.tsx`, `PlayerRow.tsx`)

- `LobbyScreen`:
  - `isHost = lobby.hostId === identity.discordUserId` (not list order).
  - When `hostId === null` and no active game: hold the config steppers in **local
    React state** (seeded from `DEFAULT_TABLE_CONFIG` / `lobby.config`), render the
    Create-a-Game variant of `TableSettings`, and on create emit
    `create_game(localConfig)`.
  - When `hostId` set: render the forming UI. The host sees **editable** steppers
    (each change emits `update_config`) plus START + Cancel Game; non-hosts see
    `lobby.config` read-only plus the Ready toggle. `canEditConfig` becomes
    `isHost && status === 'waiting'` (the old `readyCount === 0` clause is gone).
- `TableSettings`:
  - New "no host yet" mode: steppers editable as a local draft; primary button is
    **"Create a Game"** (disabled if the creator can't afford the buy-in). Edits go
    to a local `onUpdateConfig` (no server round-trip until create).
  - Host (forming) mode: steppers stay editable and emit `update_config` to the
    server; add a **"Cancel Game"** button alongside START.
  - The component receives `onCreateGame` / `onCancelGame` callbacks in addition to
    the existing `onUpdateConfig` (which the parent routes to either local draft
    state or the `update_config` socket emit depending on whether a host exists).
- `PlayerRow.playerStatus`: new labels —
  `'In Lobby' | 'Ready' | 'In-Game · At Table' | 'In-Game · Spectating'`. The
  in-game labels are derived from the player's role in `activeGame.members`
  (seated → At Table, spectator → Spectating). The generic `'In-Game'` label and
  its style entry are replaced.
- `PlayersPanel`: pass `activeGame` (or a precomputed role map) so `PlayerRow`
  can resolve the per-player table role.

---

## Error Handling & Edge Cases

- **Create when not allowed** (game already hosted, or active game running):
  server ignores `create_game`. The client only shows the button in the no-host /
  no-active-game state.
- **Cancel by non-host or after countdown:** server ignores `cancel_game`.
- **Host disconnects while forming:** `removeBySocket` transfers `hostId`; if no
  players remain, `hostId = null` and status returns to open waiting.
- **Host disconnects during countdown:** transfer host; countdown still cancels if
  ready players drop below 2.
- **Underfunded creator:** Create button disabled; server also rejects a
  `create_game` from a caller who can't afford the buy-in.
- **Spectator joins an idle table:** `broadcastState` now renders a waiting view
  (no early return on null `ctx`), so they see the seated player(s) + waiting
  banner instead of a blank screen.
- **Return to lobby clobbering balance:** `addPlayer` preserves the existing
  `chipBalance`; live balance survives the `join_lobby` re-emit.
- **Mock mode (no DB):** chips are a no-op returning balance `0`, so the displayed
  balance is tracked in the lobby (`member.bankroll` deltas → `updateChipBalance`),
  independent of persistence.

---

## Testing Strategy

TDD throughout. Update and extend:

**Server `rooms/lobby.test.ts`:**
- `createGame` sets `hostId` and config; rejected when a game is already hosted or
  active, or when the caller is underfunded.
- `cancelGame` clears host + ready flags (host-only; ignored otherwise).
- Host transfer on `removeBySocket` while forming and during countdown; `hostId`
  becomes null when the last player leaves.
- `startCountdown` is host-only.
- `updateConfig` is host-only while forming (applies for the host; ignored for a
  non-host and when no host is set), including after a player has readied up.
- `resetAfterGame` clears host/ready/status.
- `updateChipBalance` updates and rebroadcasts; `addPlayer` preserves an existing
  `chipBalance`.
- `toState` includes `hostId` and no longer filters out table members.

**Server `rooms/game.test.ts`:**
- Idle table (`<2` seated) broadcasts a waiting view that does **not** list the
  departed player as a seated player and lists them under `spectators`.
- `request_game_state` replies with the current view (including the waiting view
  when idle / pre-hand).
- `onChipBalanceChange` fires with the updated bankroll on buy-in, sit-in,
  cash-out, leave, bust, and game end.

**Client:**
- `App.test.tsx`: `request_game_state` emitted on entering the table view.
- `SpectatorControls.test.tsx`: rejoin controls render when the viewer is not in
  `state.players` (spectator), including the idle/waiting view.
- `TableSettings.test.tsx`: Create-a-Game mode (steppers editable, create disabled
  when underfunded, emits `create_game`); host Cancel Game button emits
  `cancel_game`.
- `PlayerRow.test.tsx`: the four status labels, including At Table / Spectating
  derived from `activeGame.members`.
- `ActiveGameCard.test.tsx`: unchanged behaviour still holds.

After changes: `npm test` and `npm run build` must pass.

## Documentation

- `docs/ARCHITECTURE.md` → Table membership / lobby sections: document the host
  model (Create a Game, transfer, cancel, reset), the waiting-view rendering, and
  the live chip-balance hook.
- `docs/To-do.md`: tick the five Known Bugs and the "Host/Player" / "Player
  Status" items.
- `CLAUDE.md`: update the lobby/membership notes (host model, removed
  `update_config`, new events).

## Files Touched

- `packages/shared/src/types.ts`, `packages/shared/src/events.ts`
- `packages/server/src/rooms/lobby.ts`, `rooms/game.ts`, `rooms/index.ts`
- `packages/client/src/App.tsx`, `GameCanvas.tsx`, `SpectatorControls.tsx`
- `packages/client/src/lobby/LobbyScreen.tsx`, `TableSettings.tsx`,
  `PlayersPanel.tsx`, `PlayerRow.tsx`
- Tests: `rooms/lobby.test.ts`, `rooms/game.test.ts`, `App.test.tsx`,
  `SpectatorControls.test.tsx`, `lobby/TableSettings.test.tsx`,
  `lobby/PlayerRow.test.tsx`, `lobby/ActiveGameCard.test.tsx`
- Docs: `docs/ARCHITECTURE.md`, `docs/To-do.md`, `CLAUDE.md`
