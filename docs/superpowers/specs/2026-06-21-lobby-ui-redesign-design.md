# Lobby UI Redesign — "Ratbag Poker Night"

**Date:** 2026-06-21
**Status:** Approved design, pending implementation plan
**Scope:** Port the Claude Design "Ratbag Poker Lobby" mock into the React client as
the new lobby screen, establish a Tailwind-based design-token system, and write a
design standards doc for future pages. This is primarily a UI implementation that
hooks up existing backend functionality; one small backend feature (configurable
turn timer) is added because the design exposes it.

Source mock: `Ratbag Poker Lobby.dc.html` (Claude Design project
`4cc73c3e-6ccf-47e1-8e0e-571f2feadb7d`).

---

## Goals

- Replace the current `packages/client/src/Lobby.tsx` with a faithful implementation
  of the new design (header nav, 3-column layout, user popout, player modal, 4 tabs).
- Introduce Tailwind CSS v4 with a design-token theme drawn from the mock, and a
  `docs/DESIGN_STANDARDS.md` that future pages follow.
- Wire the new UI to **existing** backend functionality only, except for making the
  turn timer host-configurable (a deliberate, scoped feature addition).
- Keep `npm test` and `npm run build` green; add focused tests for new logic.

## Non-goals (deferred — see "Deferred features")

Titles, levels, Shop, Leaderboard/Stats tab data, friends, populated Recent
Activity, functional user Settings toggles, full View Profile page, Log Out.

---

## Design decisions (resolved with user)

1. **Styling:** Tailwind CSS v4 (CSS-first config via `@tailwindcss/vite`), not inline
   styles or a JS Tailwind config.
2. **Turn timer:** wire it fully — add `turnSeconds` to `TableConfig` and thread it
   into the game's turn timer.
3. **User Settings tab:** the tab exists but shows a "Coming Soon" placeholder; no
   toggles are implemented.
4. **Empty stats:** show **sample stats in mock dev mode**; show `—` placeholders when
   real data is unavailable (404/empty).
5. **Turn timer default:** `30s`, range `10–120`, step `5`.
6. **Blinds:** a single stepper that walks a **preset ladder** of `[smallBlind, bigBlind]`
   pairs (from the mock), emitting both values together.

---

## Architecture

### File layout

```
packages/client/src/
  index.css                 // NEW — Tailwind import + @theme design tokens
  main.tsx                  // import './index.css'
  App.tsx                   // route to <LobbyScreen> (rename from <Lobby>)
  lobby/
    LobbyScreen.tsx         // top-level: socket subscription, tab + modal state, layout
    Header.tsx              // logo, nav tabs, user button (opens popout)
    PlayersPanel.tsx        // left aside: players list + "X / max" count
    PlayerRow.tsx           // one clickable player row → opens PlayerProfileModal
    TableSettings.tsx       // center Home tab: steppers, status pills, action buttons
    ComingSoon.tsx          // generic placeholder for Leaderboard / Stats / Shop tabs
    RecentActivity.tsx      // right aside: scaffolded feed, empty state, no data
    UserPopout.tsx          // top-right popout: Profile / Settings (Coming Soon) / How to Play
    PlayerProfileModal.tsx  // quick-view stats for a clicked player
    StatTile.tsx            // shared stat tile; renders "—" when value is null
    useStats.ts            // hook: fetch /api/stats/:id, sample data in mock mode
```

`packages/client/src/Lobby.tsx` is deleted. `App.tsx` imports `LobbyScreen` from
`./lobby/LobbyScreen` and renders it with the same props (`socket`, `identity`,
`instanceId`, `onGameStart`).

### Component responsibilities & interfaces

- **LobbyScreen** — owns the `lobby_state_update`/`game_start` subscription (moved from
  the old `Lobby`), the countdown tick, and local UI state: `activeTab`
  (`'home' | 'leaderboard' | 'stats' | 'shop'`), `userPopoutOpen`,
  `selectedPlayerId`. Computes derived values (`isHost`, `readyCount`,
  `someoneReady`, `canEditConfig`, `secondsLeft`, per-player status) and passes them
  down. Renders `Header`, the 3-column `main`, the `UserPopout`, and the
  `PlayerProfileModal`.
- **Header** — props: `activeTab`, `onTabChange`, `identity`, `onOpenUser`. Pure
  presentational; tabs other than Home are still clickable (they switch to a
  Coming Soon panel).
- **PlayersPanel / PlayerRow** — props: `players` (with derived `status`),
  `maxPlayers`, `onSelectPlayer(id)`. Avatar uses the Discord `avatarUrl` (`<img>`),
  not initials.
- **TableSettings** — props: `config`, `canEditConfig`, `isHost`, `status`,
  `readyCount`, `playerCount`, `secondsLeft`, `insufficientChips`, `meIsReady`, and
  callbacks (`onUpdateConfig(patch)`, `onReadyToggle`, `onStartCountdown`,
  `onCancelCountdown`, `onLeave`). Contains the buy-in / blinds / turn-timer steppers,
  the READY STATUS + TABLE STATUS pills, and the action region (Start / Cancel /
  Waiting-for-host / Leave) including the countdown display.
- **ComingSoon** — props: `title`, optional `icon`/`blurb`. One component reused by the
  Leaderboard, Stats, and Shop tabs.
- **RecentActivity** — no data; renders header + empty state. Hidden below 1080px
  (Tailwind `hidden xl:flex` or a custom breakpoint matching the mock's 1080px).
- **UserPopout** — props: `identity`, `stats` (from `useStats`), `onClose`. Sub-tabs:
  Profile (StatTiles), Settings (ComingSoon placeholder), How to Play (static copy).
- **PlayerProfileModal** — props: `player` (lobby player), `stats`, `onClose`. Stat
  tiles CHIPS / WIN RATE / HANDS WON / BIGGEST POT. "Add Friend" removed; "View
  Profile" present but disabled/Coming Soon.
- **StatTile** — props: `label`, `value: string | null`, optional `accent`. Renders
  `—` when `value` is null.
- **useStats(playerId)** — returns `{ stats: PlayerStatsSummary | null, loading }`.
  In mock mode (`import.meta.env.DEV && ?mock`/`VITE_MOCK_DISCORD`) returns
  deterministic sample data derived from a hash of `playerId` (no fetch). Otherwise
  `fetch('/api/stats/' + playerId, { credentials: 'include' })`; on non-OK or empty,
  returns `null` (UI shows placeholders).

---

## Backend change — configurable turn timer

**`packages/shared/src/types.ts`**
- Add `turnSeconds: number` to `TableConfig`.
- Add `turnSeconds: 30` to `DEFAULT_TABLE_CONFIG`.

**`packages/server/src/rooms/lobby.ts`**
- In `sanitizeConfig`, accept `turnSeconds` when it is an integer in `[10, 120]`
  (and, for tidiness, a multiple of 5 — round or reject non-multiples; reject is
  simplest). Existing host/`waiting`/no-one-ready gating already applies.

**`packages/server/src/rooms/index.ts`**
- When constructing the `GameRoom`, set
  `timing: { ...options.gameTiming, turnMs: options.gameTiming?.turnMs ?? config.turnSeconds * 1000 }`.
  This preserves test injection (tests pass short `gameTiming.turnMs`) while using
  the host's configured value in production.

No change to `GameRoom` itself — it already reads `timing.turnMs ?? 10_000`.

**Client** — the turn-timer stepper emits `update_config({ turnSeconds })` over the
existing `update_config` event (already typed `Partial<TableConfig>`).

---

## Data wiring (existing backend → UI)

| UI element | Source / mapping |
|---|---|
| Players list | `lobby.players`; avatar `avatarUrl` (Discord), name `displayName` |
| Player status | `isReady` → `Ready` / `In Lobby`; `lobby.status === 'in-game'` → `In-Game` |
| Player count | `lobby.players.length` / `lobby.config.maxPlayers` |
| Buy-in stepper | `config.buyIn`; emit `update_config({ buyIn })` |
| Blinds stepper | preset ladder of `[SB,BB]`; emit `update_config({ smallBlind, bigBlind })` |
| Turn-timer stepper | `config.turnSeconds`; emit `update_config({ turnSeconds })` |
| Host gating | `isHost && lobby.status === 'waiting' && readyCount === 0` (same as today) |
| READY STATUS pill | `readyCount` / `players.length` |
| TABLE STATUS / countdown | `lobby.status`, `lobby.countdownEndsAt` → `secondsLeft` |
| Ready / Start / Cancel | `player_ready`/`player_unready`, `start_countdown`, `cancel_countdown` |
| Leave (non-host) | `leave_table` |
| Insufficient chips notice | `identity.chipBalance < config.buyIn` |
| Quick-view stats | `useStats(playerId)` → `PlayerStatsSummary` |
| Chips tiles | `chipBalance` from lobby player / identity |

### Blinds preset ladder

```
[ [10,20], [25,50], [25,100], [50,100], [100,200], [200,400] ]
```

The stepper finds the current index by matching `config.smallBlind`/`config.bigBlind`
(defaulting to the `[25,50]` entry, which matches `DEFAULT_TABLE_CONFIG`), and
+/- moves within the ladder bounds.

### Stat tile mappings

- **Player modal:** CHIPS = `player.chipBalance`; WIN RATE = `winRate` (as `%`);
  HANDS WON = `handsWon`; BIGGEST POT = `biggestPotWon`.
- **User popout Profile:** HANDS WON, WIN RATE, BIGGEST POT, NET PROFIT
  (`handsWon`, `winRate`, `biggestPotWon`, `netProfit`). Replaces the mock's
  level/rank tile (no levels).
- Numbers formatted with `toLocaleString('en-US')`; `winRate`/`showdownWinRate`
  rendered as percentages. `null` stats → `—`.

### Mock-mode sample stats

`useStats` detects mock mode the same way `discord.ts` does. It returns a
`PlayerStatsSummary` with deterministic values seeded from a hash of `playerId`
(so each player looks distinct and stable across renders) covering at least
`handsWon`, `handsPlayed`, `winRate`, `biggestPotWon`, `netProfit`. This keeps the
modal/popout looking alive in local `?mock` testing where there is no DB/session.

---

## Tabs

- **Home** — full content via `TableSettings` (+ players panel + recent activity).
- **Leaderboard / Stats / Shop** — `<ComingSoon title=… />`. No data, even though
  stats data exists; per scope only Home has real content. Quick-view stat tiles in
  the popout/modal still show real (or sample) data.

---

## Styling system (Tailwind v4)

- Add deps: `tailwindcss@^4`, `@tailwindcss/vite@^4`.
- `vite.config.ts`: add the `@tailwindcss/vite` plugin to `plugins`.
- `src/index.css`: `@import "tailwindcss";` + an `@theme` block defining tokens.
  Imported once in `main.tsx`.
- `index.html`: add Google Fonts `<link>` for Fredoka (400–700) and Nunito (400–900),
  matching the mock.

### Tokens (from the mock)

- **Colors:** felt gradient stops `#1d6044 / #134632 / #0b2c1f`; panels `#1c4836`,
  `#163f2e`, `#0e3325`; outline/ink `#0c2418`; gold `#ffc63d` / border `#c8920d` /
  shadow `#ad7a04`; mint `#44e0a3` / `#1e9e6e`; blue `#5bb8ff`; red `#ff6b6b` /
  `#d63d3d`; text `#f4f1e8`, muted greens `#7fb89c` / `#9ed7bd` / `#8fbfa8`.
- **Fonts:** `--font-display: Fredoka`, `--font-body: Nunito`.
- **Shadows:** chunky offset button shadows (`0 4px 0 …`, `0 6px 0 …`) and panel
  shadow (`0 16px 36px rgba(0,0,0,.35)` + inset highlight).
- **Radii:** the 11–28px rounded family.

These tokens are the single source of truth referenced by `DESIGN_STANDARDS.md`.

---

## Design standards doc

New `docs/DESIGN_STANDARDS.md` covering:
- Token reference (palette, fonts, shadows, radii, spacing) and their Tailwind
  utility names.
- Component patterns: chunky button (hard offset shadow, `:active` press-down),
  panel/aside card, pill/badge, stepper row, stat tile, modal/popout.
- Interaction conventions: hover lift, active press, the `rpn-pop`/`rpn-fade`
  keyframes for modals/popouts (ported into `index.css`).
- Layout: the 3-column lobby grid, the 1080px breakpoint that hides the right rail.
- "How to build a new page" checklist so future pages stay on-system.

---

## Deferred features (for later review)

Surfaced visually where trivial, otherwise marked Coming Soon / omitted:

- Host vs non-host distinction — logic exists; surfaced in TableSettings UI.
- Per-player **In-Game** status while others remain in the lobby — not supported by
  the current single-transition architecture; only `lobby.status === 'in-game'` maps
  to In-Game.
- Player **titles** and **levels** — omitted.
- **Shop**, **Leaderboard** data, **Stats** tab data — Coming Soon.
- **Friends / Add Friend** — removed.
- **Recent Activity** data — scaffold only (empty state).
- **User Settings** toggles — Settings tab is a Coming Soon placeholder.
- **View Profile** full page — button present but disabled/Coming Soon.
- **Log Out** — visual only.

---

## Testing

Client (add dev deps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`,
`jsdom`; add a `test` script + Vitest config for the client workspace):
- `TableSettings`: host can edit (steppers emit correct `update_config` patches);
  non-host steppers are read-only; Ready/Start/Cancel/Leave fire the right callbacks;
  insufficient-chips notice shows.
- `useStats`: mock mode returns sample data without fetching; real mode maps a 200
  response; 404/empty → `null`.
- `PlayerRow`/status mapping: `isReady`→Ready, else In Lobby; `in-game`→In-Game.

Server:
- `lobby.test.ts`: `sanitizeConfig` accepts valid `turnSeconds`, rejects out-of-range.
- A test asserting `turnSeconds` flows into `GameRoom` turn timing (or that
  `update_config({ turnSeconds })` is honored under host gating).

Gate: `npm test` and `npm run build` must both pass before completion.

---

## Documentation updates

- `CLAUDE.md`: note the Tailwind setup, the `lobby/` component structure, the new
  `turnSeconds` config field, and `docs/DESIGN_STANDARDS.md`.
- `docs/ARCHITECTURE.md`: update the client section for the new lobby structure and
  `turnSeconds`.
- `.env.example`: no change (no new env vars).
```
