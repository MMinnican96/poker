# Spectate, Join & Leave the Table

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan
**Scope:** Let players join an in-progress game from the lobby as **spectators**,
take a seat at hand boundaries, leave the table back to the lobby, and move
between playing and spectating — while the game continues for everyone else.
Adds a lobby "Join Active Game" view and minimal (throwaway) table affordances.

Source mock: `Ratbag Poker Lobby.dc.html` (Claude Design project
`4cc73c3e-6ccf-47e1-8e0e-571f2feadb7d`). The mock's join card is adapted to a
**single** action (spectate-first) — its separate "Join Game — Buy In" button is
dropped.

---

## Goals

- A lobby player can **Join Table** an active game and become a spectator.
- Spectators see the game but never see face-down hole cards; they are not dealt in.
- Spectators can **Join Next Hand** (take a seat) when a slot is free and they can
  afford the buy-in; otherwise the control is greyed with a hover reason.
- Seated players can **Move to Spectate** (cash out, keep watching) or **Leave
  Table** (cash out, return to lobby). Both apply at the end of the current hand.
- A seated player who **busts** is automatically moved to spectate.
- Mid-hand leave/spectate requests are deferred to hand end so an active hand is
  never disrupted; spectators may leave at any time.
- A **cancel** affordance undoes a queued transition before it applies.
- The lobby shows who is **playing** vs **watching** at the active game.
- The table stays alive while ≥1 player is seated; it idles at exactly 1 seated and
  tears down (all → lobby) at 0 seated.
- Concurrent divergent states are first-class: some players in lobby, some
  spectating, some playing, each seeing a correctly sanitized view.

## Non-goals (deferred)

- Table UI redesign (a separate effort using `Ratbag Poker Table.dc.html`). Table
  affordances here are intentionally minimal/functional.
- Multiple concurrent games per instance (product decision: one game at a time).
  The member model would extend to a per-room map if ever needed — not built now.
- Host/admin controls over spectators; spectator chat; custom buy-in amounts.

---

## Design decisions (resolved with user)

1. **Entry model: spectate-first.** The lobby's active-game card has a single
   **Join Table** button → you enter as a spectator. Taking a seat is a separate
   action from the table view (**Join Next Hand**). The design mock's second
   "Join Game — Buy In" button is dropped.
2. **Seated players can stop playing two ways:** **Move to Spectate** (cash out,
   stay at the table watching) and **Leave Table** (cash out, return to lobby).
   Bust is the one *automatic* Playing → Spectate.
3. **Teardown:** the table stays alive while ≥1 player is seated. With exactly 1
   seated, the table idles in a "waiting for players" state (the lone player keeps
   their seat and chips, no hand is dealt) and spectators may join to resume. When
   seated count reaches 0 (last player leaves or moves to spectate), the game ends
   and **everyone present — including all spectators — returns to the lobby**.
4. **Cancel pending:** a queued `leave` / `spectate` / `seat` transition can be
   cancelled before the hand boundary applies it.
5. **Architecture: Approach A** — generalize `GameRoom` to own the whole table
   population (seated + spectators) with role-based members and hand-boundary
   transition resolution. Engine stays pure; `viewFor` is reused unchanged; the
   lobby gets a read-only `activeGame` summary.

---

## Architecture

One Discord instance has one authoritative state. **Every outbound message is
sanitized per recipient**, so three audiences coexist at the same instant:

| Audience | Source of truth | Receives | Hole cards |
|---|---|---|---|
| In lobby (not at table) | `LobbyRoom` | `lobby_state_update` incl. cards-free `activeGame` summary | none |
| Spectating at table | `GameRoom` | `game_state_update` = `viewFor(state, theirId)` (never seated) | all hidden until showdown |
| Seated & playing | `GameRoom` | `game_state_update` = `viewFor(state, theirId)` | own only |

The `GameRoom` broadcast loop already iterates members and calls `viewFor` per
socket; it is extended to include spectators. Concurrent divergent views are the
default behavior, not a special case. The model is O(members) and scales to
arbitrarily many spectators.

### Membership model

`GameRoom` replaces its fixed `Seat[]` with a role-tagged `Member[]`:

```ts
Member {
  discordUserId, displayName, avatarUrl, socketId
  role: 'seated' | 'spectator'
  slot: number | null      // 0..maxPlayers-1 when seated; null when spectating
  chipStack: number        // 0 for spectators
  seatSession: number      // ++ each time they take a seat → unique buy-in/cashout keys
  pending: null | 'leave' | 'spectate' | 'seat'   // deferred hand-boundary transition
  disconnected, disconnectedAt, joinedAt, playMs
}
```

**Seat slots.** A fixed layout of `maxPlayers` slots. Seated members occupy a slot;
the dealer button advances to the next *occupied* slot each hand; a joiner takes the
lowest free slot. This gives stable seat positions and clean dealer rotation as
membership churns. Each hand, `seeds` are built from currently-seated members only;
spectators are never seeded.

### State machine

| Event | When applied | Chip effect |
|---|---|---|
| Lobby → **Join Table** (spectate) | immediate | none |
| Spectator → **Join Next Hand** (`sit_in`) | next hand boundary (`pending:'seat'`) | buy-in deducted, `seatSession++` |
| Seated → **Leave Table** (`leave_table`) | end of current hand (`pending:'leave'`); immediate if no hand running | cash out remaining → lobby |
| Seated → **Move to Spectate** (`sit_out`) | end of current hand (`pending:'spectate'`) | cash out remaining → stays watching |
| Seated **busts** (stack → 0) | automatic, at hand settle | nothing to cash; role → spectator |
| Spectator → **Leave Table** (`leave_table`) | immediate (any time) | none → lobby |
| **Cancel** (`cancel_pending`) | immediate | clears `pending`; a cancelled `seat` is never charged |

**Gating `sit_in`:** allowed only if a free slot exists (`seatedCount < maxPlayers`)
**and** bankroll ≥ `config.buyIn`; otherwise the button is greyed with a hover reason.

**Hand-boundary resolver** (runs before dealing the next hand): apply all `pending`
transitions and bust → spectator, recompute the seated set, then:
- seated ≥ 2 → deal next hand.
- seated == 1 → idle **`waitingForPlayers`** (no deal); the lone player keeps seat + chips.
- seated == 0 → end game: eject all spectators (`left_table`) → lobby, tear down room.

**Disconnect:** a seated player who drops is auto-folded for the current hand
(unchanged) and treated as `pending:'leave'` (cashed out at hand end unless they
reconnect first); a dropped spectator is simply removed.

### Buy-in idempotency fix

The current key `${gameId}:buyin:${id}` collides on leave→rejoin within the same
game (second buy-in silently not deducted). Keys become
`${gameId}:buyin:${id}:${seatSession}` and `${gameId}:cashout:${id}:${seatSession}`
so each seating is a distinct ledger entry. A regression test pins this.

### Lobby composition

`GameRoom` is the single source of truth for table population. `LobbyState.players`
is filtered to connected identities **not** in the GameRoom population, and
`activeGame` is built from the GameRoom. A `GameRoom → onMembershipChange` callback
triggers a lobby re-broadcast whenever roles change, so the lobby's counts and seat
list stay live.

---

## Protocol & shared types (`@poker/shared`)

```ts
export type TableRole = 'seated' | 'spectator';

export interface TableMember {            // cards-free
  discordUserId: string; displayName: string; avatarUrl: string;
  role: TableRole;
  chipStack: number;          // 0 for spectators
  seatIndex: number | null;   // slot when seated, null when watching
}

export interface ActiveGameSummary {      // safe for everyone in lobby
  gameId: string; handNumber: number;
  buyIn: number; maxPlayers: number;
  playingCount: number; spectatingCount: number;
  members: TableMember[];     // drives the "AT THE TABLE" seat list
  waitingForPlayers: boolean;
}
```

- `LobbyState` gains `activeGame: ActiveGameSummary | null`.
- `GameState` gains **GameRoom-populated** fields (engine untouched; GameRoom
  augments the view before broadcast):
  - `spectators: { discordUserId; displayName; avatarUrl }[]` — drives the in-game
    eye-icon / hover watcher list.
  - `waitingForPlayers: boolean` — idle-at-1-seated state.
  - `viewerPending: 'leave' | 'spectate' | 'seat' | null` — stamped per recipient so
    the client can render the "…after this hand — Cancel" toggle. The viewer derives
    its own role by whether its id is in `players` vs `spectators`.

**Client → Server (new):**

| Event | Meaning |
|---|---|
| `join_table` | from lobby: become a spectator at the active game |
| `sit_in` | spectator: request a seat for the next hand (server validates slot + funds) |
| `sit_out` | seated: move to spectate at end of current hand |
| `cancel_pending` | clear the caller's queued transition before it applies |
| `leave_table` *(exists, repurposed)* | seated → deferred cash-out → lobby; spectator → immediate → lobby |

**Server → Client (new):** explicit view-switch events so the client never *infers*
which screen to show:

| Event | Effect on recipient |
|---|---|
| `joined_table { gameId, role }` | switch to the table (GameCanvas) |
| `left_table` | switch back to the lobby |

This **retires the broadcast `game_start` as a view-switch trigger** (a latent bug
where non-ready players were yanked to the table). At game start the server sends
`joined_table` only to the now-seated (ready) players; everyone else gets a
`lobby_state_update` whose `activeGame` is now populated, flipping their lobby from
the ready/settings panel to the "Join Active Game" card.

---

## Client UI

**App routing.** `App.tsx` stops keying the table view off `gameId`-from-
`game_start`; it tracks an `atTable` flag driven by `joined_table` / `left_table`.
At table → `<GameCanvas>`, else → `<LobbyScreen>`.

**Lobby — "Join Active Game" card** (`LobbyScreen` + new `ActiveGameCard`, adapted
from the mock's join card, single-action):
- Shown on the `home` tab when `lobby.activeGame != null` (replaces `TableSettings`,
  mirroring the mock's `showJoin` vs `showSettings`).
- Renders the **AT THE TABLE** pill (`playingCount` PLAYING / `spectatingCount`
  WATCHING), the member list (Playing rows show chips, Spectating rows show "—"),
  the `LIVE` / "Game in Progress" header, and a `waitingForPlayers` note when idle.
- One button: **Join Table** → `socket.emit('join_table')`.
- `PlayersPanel` (left) lists only lobby-side players (server already filters table
  members out of `activeGame`).

**Table — minimal / throwaway** (`GameCanvas` / `ActionBar`):
- **Spectator banner** when `viewerRole === 'spectator'`: "You're watching" +
  **Join Next Hand** (`sit_in`, greyed with hover reason when slots full or
  underfunded) + **Leave Table** (`leave_table`).
- **Seated controls** beside `ActionBar`: **Move to Spectate** (`sit_out`) and
  **Leave Table** (`leave_table`). When `viewerPending` is set, the matching control
  flips to "…after this hand — **Cancel**" (`cancel_pending`).
- **Spectator indicator**: 👁 eye icon + count; hover/tap shows the watcher list from
  `state.spectators`.
- **Waiting overlay**: "Waiting for players…" when `waitingForPlayers`.

Table styling stays minimal pending the later table redesign.

---

## Testing

TDD per repo convention (tests next to source; `npm test` runs server + client).

**Engine** — unchanged (pure). One added check: `startHand` deals correctly when the
seeded seat set changes hand-to-hand (joins/leaves/busts).

**`GameRoom`** (fake io / chips / stats):
- Spectator join is immediate; their view has all hole cards `null` pre-showdown;
  reveals at showdown.
- `sit_in` queues `seat`, applied next hand, buy-in charged with a `seatSession`-
  scoped idempotency key.
- **Leave→rejoin same game re-deducts** (idempotency-key regression test).
- `sit_out` → cash out + spectator at hand end; `leave_table` (seated) → deferred
  cash-out → lobby, immediate when no hand running; spectator `leave_table` →
  immediate.
- `cancel_pending` cancels `leave`/`spectate` (stays seated, chips intact) and `seat`
  (stays spectator, never charged).
- Bust → auto-spectate at settle.
- Teardown: seated → 1 idles `waitingForPlayers` (no deal); a spectator `sit_in`
  resumes; seated → 0 ends game, ejects spectators via `left_table` → lobby.
- `sit_in` gating: rejected when slots full or bankroll `< buyIn`.
- Disconnect: seated → auto-fold + pending leave + cash-out at hand end; spectator
  drop just removed.

**`state-view`**: `spectators` populated, `waitingForPlayers` flag, per-viewer
`viewerPending` stamping.

**Lobby/integration** (`rooms/index`): `activeGame` populated while a game runs and
`players` filtered to exclude table members; `join_table` emits `joined_table` and
removes from lobby list; game start sends `joined_table` only to seated players
(lobby players keep the join card); membership changes re-broadcast the lobby.

**Client (RTL):** `App` routes on `joined_table` / `left_table`; `ActiveGameCard`
renders counts/seat list/Join Table and appears only when `activeGame` set;
spectator banner + greyed "Join Next Hand" with hover reason; seated controls with
pending → Cancel toggle; eye-icon watcher list.

**Docs:** update `ARCHITECTURE.md`, `CLAUDE.md`, and `docs/To-do.md` (mark Spectate
System done; clear the two Known Bugs this fixes — the bust-stuck table and "no way
to exit to the lobby". The all-in over-call bug is out of scope and stays open.)

---

## Files touched (anticipated)

- `packages/shared/src/types.ts`, `events.ts` — new types + events.
- `packages/server/src/rooms/game.ts` — member model, transitions, resolver,
  teardown, idempotency keys, augmented broadcast.
- `packages/server/src/rooms/state-view.ts` — spectators / waiting / viewerPending.
- `packages/server/src/rooms/lobby.ts`, `rooms/index.ts` — `activeGame` summary,
  player filtering, membership-change re-broadcast, view-switch events.
- `packages/client/src/App.tsx`, `socket.ts` — `joined_table` / `left_table` routing.
- `packages/client/src/lobby/LobbyScreen.tsx` + new `ActiveGameCard.tsx`,
  `PlayersPanel.tsx`.
- `packages/client/src/GameCanvas.tsx`, `ActionBar.tsx` — spectator banner, seated
  controls, eye-icon list, waiting overlay.
- Tests alongside each, plus doc updates.
