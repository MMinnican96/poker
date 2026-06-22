# Sound Effects & Showdown Polish — Design

**Date:** 2026-06-22
**Status:** Approved design, pending implementation plan
**Area:** `packages/client` (sound engine, settings, showdown UI, celebration),
`packages/server` (showdown data + timing), `packages/shared` (types)

## Goal

Bring the poker table to life with sound effects and make the showdown
readable: today the game jumps to the next hand too fast to see opponents'
cards, and it is not clear who won or what everyone held. This work adds:

1. Sound effects for the existing chip/check/deal clips plus new fold, suspense,
   and win sounds.
2. A pitch-escalating suspense sting on consecutive raises.
3. Player audio controls (mute + volume) — the first live feature in the
   currently "Coming Soon" Settings tab.
4. A clear, longer showdown: winner banner, per-player hand labels, a gold
   confetti celebration from the winner, and a longer pause.

## Decisions (resolved during brainstorming)

- **New audio files** are sourced as CC0 / royalty-free clips and committed with
  attribution. (Requires web access at implementation time.)
- **Suspense escalation:** one sting whose **pitch rises per consecutive raise**;
  the consecutive-raise counter **resets after any call or check** (and at hand
  start).
- **Showdown pause:** a single fixed longer delay (~6.5s) for **all** concluded
  hands, including fold-outs.
- **Reveal detail:** highlight the winner(s), show a banner, and label every
  revealed player's hand type.
- **Chip sound** plays on **any chips entering the pot** — bet, raise, call, all-in.
- **Celebration:** gold confetti burst originating from the winning player(s),
  fired on **every** pot win (contested or fold-out).
- **Audio controls:** mute toggle **+** volume slider, persisted to
  `localStorage`, placed in the shared `UserPopout` Settings tab.

## 1. Audio assets & serving

Move the existing files into `packages/client/public/audio/` (Vite serves
`public/` at the web root and bundles it into `client/dist` for the single-origin
Railway build). Add the sourced CC0 files alongside.

| Event | File | Source |
|---|---|---|
| Bet / raise / call / all-in (chips) | `bet.mp3` | existing |
| Check (knock) | `check.mp3` | existing |
| Community deal (flop / turn / river) | `muck-deal.mp3` | existing (renamed, no spaces) |
| Fold | `fold.mp3` | CC0, new |
| Suspense sting (consecutive raise) | `suspense.mp3` | CC0, new |
| Win / showdown fanfare | `win.mp3` | CC0, new |

Attribution for any sourced files recorded in `packages/client/public/audio/CREDITS.md`.

## 2. Sound engine (client)

New module under `packages/client/src/table/sound/`. No heavy dependency — a
thin wrapper over the Web Audio API.

- **`SoundManager`**
  - Lazily creates a single `AudioContext`; preloads each clip into an
    `AudioBuffer` on first use.
  - `play(name, { rate?, volume? })` creates an `AudioBufferSourceNode` →
    `GainNode` → destination.
  - **Pitch escalation:** `suspense.mp3` is played with an increasing
    `playbackRate` (or `detune`) per consecutive raise step, so the same clip
    rises in pitch.
  - Respects the current mute + master volume (from settings, §3).
  - **Autoplay unlock:** the `AudioContext` is `resume()`-d on the first user
    gesture (any action-bar click). Until then, sounds are no-ops.

- **`useTableSounds(view)` hook**
  - Holds the previous `GameState` in a ref and diffs each incoming
    `game_state_update` to fire sounds. One engine action produces one state
    broadcast, so transitions map cleanly to single events.
  - Triggers:
    - A player's `lastAction` newly becomes `raise` / `all-in` →
      **chip sound + suspense sting** at the current escalation step;
      increment the consecutive-raise counter.
    - `call` → chip sound, **reset** counter.
    - `check` → knock sound, **reset** counter.
    - `fold` → fold sound (counter unchanged).
    - `communityCards.length` increased → deal sound.
    - `view.showdown.winnerIds` newly populated (§4) → win fanfare.
  - The consecutive-raise counter also resets at hand start (`handNumber`
    change / phase returning to `pre-flop` / `waiting`).
  - Non-action broadcasts (membership changes, timer-driven re-sends) carry the
    same `lastAction` values, so they produce no diff and no sound.

## 3. Audio settings (activates the Settings tab)

Replace the "COMING SOON" panel in `UserPopout`'s `settings` tab with a real
**mute toggle + volume slider**.

- New `useSoundSettings` hook owns `{ muted: boolean, volume: number }`,
  persisted to `localStorage` under `poker.sound`.
- The `SoundManager` reads these (muted → skip playback; volume → master gain).
- Because `UserPopout` is shared between lobby and table, the control is
  available in both. This is the first live Settings feature; the other Settings
  items remain deferred.

## 4. Showdown clarity (server + shared)

The server already computes `result.hands` (a `HandRank` per contested player)
and `result.awards`, but `hand_result` only ships the winner's hand name. Enrich
the state instead so it rides existing flows and stays per-viewer-safe.

- Add an optional block to `GameState` (`packages/shared/src/types.ts`):
  ```ts
  showdown?: {
    winnerIds: string[];
    /** Shown players only; folded / uncontested players have no entry. */
    hands: Record<string, { category: WonHandCategory; label: string }>;
  };
  ```
- `GameRoom.concludeHand()` builds this from `result` (`winnerIds` already
  derived there; map `result.hands[id]` → `{ category, label: name }`) and
  includes it in the `viewFor(state, null)` `finalState` it emits via
  `hand_result`. (Mapping `HandCategory` → `WonHandCategory`: identical strings;
  royal-flush is a display refinement that can stay out of scope.)

## 5. Showdown timing (server)

Today the reveal is held for `handDelayMs` (defaults to 3000ms;
`registerSocketHandlers` passes no timing). Use a single longer delay for all
concluded hands.

- Add **`showdownMs` (~6500ms)** to `GameTiming`, used as the between-hands delay
  after any settled hand (contested or fold-out). `handDelayMs` remains for
  non-showdown scheduling (e.g. idle/seat resolution) if still needed; otherwise
  `showdownMs` supersedes it for the post-`concludeHand` schedule.
- Wire it in: `registerSocketHandlers(io, { chips, stats, gameTiming: { showdownMs } })`.
- Tests continue to inject short values.

## 6. Showdown UI (client)

- **Winner banner** in `CenterCluster`, driven by `view.showdown`:
  - Contested: *"Alice wins with a Flush"* / split: *"Split pot — Alice & Bob · Straight"*.
  - Fold-out (no `hands` entry for the winner): *"Alice wins the pot"*.
- **Per-seat hand labels:** when `view.showdown.hands[id]` exists, render the
  category label (*"Two Pair"*) under that seat's revealed cards in `Seat` and
  under the hero's cards in `HeroHud`.
- **Winner highlight:** a gold ring / pulse on the winning seat(s) for the
  showdown duration.

## 7. Winner celebration

- Add **`canvas-confetti`** (~2kb).
- A `<ConfettiLayer>` mounted at the table root. When `view.showdown.winnerIds`
  resolves, fire a **gold confetti burst originating from each winner's avatar
  position** (origin computed from `SeatLayout` coordinates; the hero token has
  its own anchor). Fires on every pot win. Auto-clears when the next hand deals.

## 8. Testing

- **Server/engine:** `showdown` block populated correctly across single winner,
  split pot, fold-out, and side-pot cases; `showdownMs` used as the post-hand
  delay.
- **Client (RTL, jsdom):**
  - `useTableSounds` diff logic — each trigger fires exactly once per action;
    suspense counter increments on consecutive raises and resets on call/check
    and at hand start. `SoundManager` mocked.
  - `useSoundSettings` persistence (read/write `localStorage`).
  - Showdown UI — winner banner text (single / split / fold-out) and per-seat
    hand labels render from `view.showdown`.
  - Confetti and Web Audio side-effects are mocked (jsdom has neither).
- After changes: `npm test` and `npm run build` must pass.

## Out of scope

- Royal-flush as a distinct shown category (full-house etc. cover the need).
- Persisting per-hand audio history; additional Settings items beyond audio.
- Drama-scaled pacing beyond the single longer delay.
