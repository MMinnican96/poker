# Poker Table Redesign (React/DOM) — Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Source design:** `Ratbag Poker Table.dc.html` (Claude Design project
`4cc73c3e-6ccf-47e1-8e0e-571f2feadb7d`)

## Summary

Overhaul the in-game **table view** so it matches the Ratbag Poker Night visual
language already used in the lobby (Tailwind v4 design tokens, Fredoka/Nunito,
felt-green + gold cartoon styling). This is primarily a **UI redesign**: the
authoritative game engine and socket contracts are unchanged except for two
small, contained additions called out below.

The current table is rendered with **Phaser 3** on a `<canvas>`
(`GameCanvas.tsx` + `game/TableScene.ts`). The new design — and the entire lobby
— is **React + Tailwind DOM**, and it explicitly reuses the lobby's React
pop-out and profile-modal components, which cannot live inside a Phaser canvas.
Therefore the redesign **replaces the Phaser renderer with a React/DOM table**
built the same way the lobby is built.

## Goals

- The table view is visually uniform with the lobby (same tokens, fonts,
  shadows, button styles, copy tone).
- Players can read and interact with the table easily — this is the primary
  gameplay screen.
- Reuse existing lobby components where possible (`UserPopout`,
  `PlayerProfileModal`, `StatTile`, `useStats`).
- Drive everything from the existing authoritative `GameState` / socket events,
  adding the minimum server data needed for the design.

## Non-goals (out of scope)

- **Phase 2 — reveal-all-at-hand-end**: a future feature to reveal every
  remaining player's hand at hand end. This phase only reveals the hands that
  are already revealed at showdown (which the server already exposes). Called
  out here so it is not conflated with the showdown reveal.
- Any new gameplay rules or engine behaviour changes beyond `lastAction`.
- The mock's standalone "You left the table" overlay with **Undo** — the app
  already routes leavers back to `LobbyScreen`, and the "leaving after this
  hand" case is the existing `cancel_pending` pending banner.
- Settings toggles in the user pop-out — they remain **Coming Soon**, matching
  the lobby.

## Decisions (from brainstorming)

1. **Renderer:** Replace Phaser with React/DOM. Drop the `phaser` dependency
   from the client; remove `GameCanvas.tsx`, `game/TableScene.ts`,
   `game/bridge.ts`, `game/createGame.ts`.
2. **Per-seat action labels:** Add a small server field (`lastAction`) so the
   Call/Check/Raise/Bet/Fold/All-In pill under each seat is accurate.
3. **Hero hand strength:** Move the pure hand-evaluator into `@poker/shared` so
   the client can name the hero's current hand from hole + community cards.

## Architecture & component breakdown

A new `packages/client/src/table/` folder mirrors `lobby/`. `App.tsx` renders
`<TableScreen>` (instead of `<GameCanvas>`) when `atTable` is true; the
lobby↔table routing via `joined_table` / `left_table` is unchanged.

| Component | Responsibility |
|---|---|
| `TableScreen.tsx` | Top-level container. Owns socket state (`game_state_update`, `timer_tick`, `hand_result`), viewer id, and overall layout (header / felt / hero HUD / action bar). Replaces `GameCanvas`. |
| `TableHeader.tsx` | Logo + blinds label, "Hand #N", spectator **eye** count with hover popout (spectator list from `spectators[]`), and the user-profile button that opens `UserPopout`. |
| `Felt.tsx` | Elliptical felt + rail + dashed ring, and the center cluster (state pill, community cards, pot + side pots). |
| `Seat.tsx` | One opponent seat: Discord avatar image + active-turn countdown ring, name/stack panel, role badge (D/SB/BB), action pill, floating bet chip, fanned hole cards (hidden back vs revealed face). |
| `CommunityCards.tsx` | Board cards (deal-in animation) + empty dashed slots. |
| `PotDisplay.tsx` | Main pot pill + side-pot pill(s). |
| `HeroHud.tsx` | Bottom HUD: your fanned hole cards, hand-strength line, table chip stack, bank balance, turn timer. Also renders the spectating variant. |
| `ActionBar.tsx` | Rebuilt action controls: quick-raise presets (½ Pot / Pot / 2×), raise slider + live value, Fold / Call(Check) / Raise / All-In; plus pending, acted ("waiting…" / deal-next), and spectating (Join / Leave) states. |
| `SeatLayout.ts` | Pure helper. Given seated members and the viewer's index, returns each seat's `%` position on the felt ellipse, rotating the viewer to bottom-center and evenly distributing the rest. Unit-tested. |

Seat geometry follows the mock: an ellipse at roughly `rx ≈ 49%`, `ry ≈ 51%`
of the table box, bet chips at ~0.66 of that radius toward the center. The hero
is always anchored at bottom-center (~`top: 90%`); opponents fill the remaining
arc evenly for any seat count up to `config.maxPlayers`.

## Reused lobby components

- **`UserPopout`** (top-right account menu) — extended via new **optional**
  props to render a **"Your Seat"** section:
  - **Spectate** → `sit_out` (when seated and playing).
  - **Join Table** → `sit_in`, with the disabled + reason treatment from the
    mock when the buy-in is unaffordable (`viewerBankroll < config.buyIn`) or the
    table is full.
  - **Pending banner + Cancel** → `cancel_pending` (when a leave/spectate is
    queued for the hand boundary).
  - **Leave Table** → `leave_table`.
  - When rendered from the lobby (seat props omitted) it behaves exactly as
    today. The **Settings** tab stays Coming Soon; Profile and How-to-Play are
    wired.
- **`PlayerProfileModal`** + **`useStats`** + **`StatTile`** — reused unchanged
  for the click-a-player modal. Player status (In Game / Folded / All-In)
  derives from `GamePlayer.status`.

## Data flow & mapping (existing `GameState`)

All table rendering is driven by the sanitized `GameState` the server already
sends, plus `timer_tick` and `hand_result`:

| UI element | Source |
|---|---|
| Opponent seats | `players` (viewer rotated to bottom; `sitting-out` filtered) |
| Community cards | `communityCards` |
| Main pot / side pots | `pots[]` |
| Dealer / SB / BB badges | `dealerIndex` / `smallBlindIndex` / `bigBlindIndex` |
| Active-turn ring + countdown | `currentPlayerIndex` + `timer_tick.remainingMs` |
| Per-seat action pill | `lastAction` (new) + `status` + `betThisRound` |
| Hero hole cards | `players[me].holeCards` |
| Hero hand-strength line | client evaluator over `holeCards` + `communityCards` |
| Table chip stack | `players[me].chipStack` |
| Bank balance | `viewerBankroll` |
| Spectator list / count | `spectators[]` |
| Pending banner | `viewerPending` |
| Idle/waiting view | `waitingForPlayers` |
| Buy-in affordability | `viewerBankroll` vs `config.buyIn` |

**Showdown reveal** already works: the server nulls opponents' `holeCards` via
`viewFor()` until showdown, then sends real cards. Seats whose `holeCards` are
non-null and not folded flip face-up with a CSS `rotateY` reveal animation.

## Server-side additions

1. **`lastAction`** — add `lastAction?: ActionType | null` to `GamePlayer` in
   `@poker/shared`. The engine sets it when a player acts
   (fold/check/call/raise/all-in) and clears it (to `null`) at the start of each
   betting street and at the start of a new hand. It is **not secret**, so it
   passes through `viewFor()` unchanged. Drives the per-seat action pill; the
   client maps it to label + colour (Fold red, Call/Check mint, Raise/Bet gold,
   All-In purple).
2. **Hand evaluator in `@poker/shared`** — move the pure hand-evaluator (deck +
   evaluator) into `@poker/shared` (or a thin shared module) and have the server
   engine import it from there. The client uses it in `HeroHud` to name the
   hero's best current hand. The evaluator is already pure and unit-tested; its
   tests move with it. Engine purity and existing behaviour are preserved.

## Animations

Port the mock's keyframes into `index.css` (`@theme` + `@keyframes`):

- `rpn-deal` — cards drop in from above with a staggered delay (community +
  hero hole cards on a new hand / new street).
- `rpn-reveal` — `rotateY` flip from card-back to face at showdown.
- Turn-ring countdown — a `conic-gradient` ring around the active player's
  avatar that depletes with the timer and shifts green → red as time runs low.

Honour `prefers-reduced-motion`: when set, cards appear without the drop/flip
and the ring shows a static remaining-time arc.

## Testing

Client (Vitest + RTL, jsdom), tests next to source:

- `SeatLayout.test.ts` — geometry + viewer-rotation for various seat counts.
- `Seat.test.tsx` — role badges, action-pill mapping, revealed vs hidden cards,
  folded dimming.
- `HeroHud.test.tsx` — hand-strength line, chip stack, bank, turn timer,
  spectating variant.
- `ActionBar.test.tsx` — quick-raise math (½/Pot/2×, clamped to min-raise and
  stack), call vs check label, raise confirm, all-in.
- `UserPopout` — seat actions (Spectate/Join/Leave/Cancel), disabled Join with
  reason, lobby-mode behaviour unchanged.
- `TableScreen.test.tsx` — socket wiring (state/timer/result), waiting view.

Server: engine test that `lastAction` is set on action and cleared per street /
per hand.

Shared: existing hand-evaluator unit tests move with the evaluator.

Run `npm test` and `npm run build` before claiming done (per CLAUDE.md).

## Documentation

Update `docs/ARCHITECTURE.md` (client table section: React/DOM replaces Phaser;
`table/` component folder; `lastAction`; shared evaluator) and the client layout
line in `CLAUDE.md`.
