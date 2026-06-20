# Player Statistics Tracking — Design

**Date:** 2026-06-20
**Status:** Approved (pre-implementation)

## Purpose

Track a wide range of per-player poker statistics from an early stage of the
game so that leaderboards, stat pages, and challenges can be built later —
including **retrospectively** over historical data. This feature delivers
**capture → storage → read APIs**. It does **not** build the leaderboard, stats,
or challenge UIs.

The stats explicitly requested: chips bet, chips won, chips lost, play time
(time at table), hands won, hands lost, hands played, type of hand won (high card
through royal flush), biggest pot won, win rate. The design captures a richer
"poker-grade" superset so future metrics are backfillable.

## Key decisions

- **Hybrid storage**: an append-only per-hand **fact** table is the source of
  truth; a denormalized per-player **aggregate** table serves fast reads and is
  always recomputable from the facts. This maximizes retrospective flexibility.
- **Rich facts**: each per-hand fact captures enough to reconstruct classic poker
  metrics later (VPIP, PFR, aggression factor, showdown win %, BB/100), not just
  the explicitly-listed stats.
- **Raw quantities, derived ratios**: store raw counts/sums (chips contributed,
  chips won, net result); compute ratios (win rate, VPIP%, PFR%, aggression
  factor) at read time. Never persist a ratio that can go stale.
- **Engine stays pure**: capture happens in `GameRoom`; the stats writer is an
  injected `StatsService`, mirroring the existing injected `ChipService`. The
  engine remains DB-free and unit-testable.
- **Idempotent writes**: per-hand facts have a natural unique key so a
  reconnect/replay can never double-record, mirroring the chip-ledger discipline.

## Out of scope

- Leaderboard page, stats page, challenge page (any UI).
- Challenge logic / definitions.
- Persisting full hand-action history to the existing `hand_actions` audit table
  (separate deferred work).

The fact table + raw aggregates + read APIs are designed so the above can be
built later, including retrospectively over existing data.

---

## 1. Data model (Drizzle / Postgres)

Two new tables, plus timestamp columns added to the existing `game_players`.

### `player_hand_stats` — append-only fact table

One row per player per hand. The retrospective source of truth.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `defaultRandom()` |
| `game_id` | uuid | **no FK** — the in-memory game's `randomUUID()`. The `games`/`game_players` audit tables are not written yet (deferred), so this column only groups rows and forms the dedup key. |
| `player_id` | text → `players.discord_user_id` | `players` is written, so this FK is safe |
| `hand_number` | integer | |
| `seat_index` | integer | |
| `position` | integer | seats clockwise from button (0 = button) |
| `chips_contributed` | integer | engine `totalBetThisHand` |
| `chips_won` | integer | from `winningsByPlayer` |
| `net_result` | integer | `chips_won - chips_contributed` |
| `result` | text | `won` / `lost` / `folded` |
| `hand_category` | text null | `high-card` … `straight-flush`, `royal-flush`; null if folded pre-showdown |
| `pot_total` | integer | total pot this hand |
| `went_to_showdown` | boolean | |
| `vpip` | boolean | voluntarily put money in (non-blind) preflop |
| `pfr` | boolean | raised preflop |
| `aggressive_actions` | integer | bets + raises this hand |
| `passive_actions` | integer | calls this hand |
| `was_all_in` | boolean | |
| `final_street` | text | last street the player was live on (`pre-flop`/`flop`/`turn`/`river`/`showdown`) |
| `duration_ms` | integer | hand wall-clock duration |
| `created_at` | timestamptz | `defaultNow()`; enables time-windowed leaderboards/challenges |

- **Idempotency:** `UNIQUE (game_id, player_id, hand_number)`. Inserts use
  `onConflictDoNothing`.
- **Indexes:** `(player_id, created_at)` for per-player / time-window queries;
  `(game_id)` for session rollups.

### `player_stats` — denormalized aggregate counters

One row per player. Fast leaderboard reads; fully recomputable from
`player_hand_stats`.

| column | type | notes |
|---|---|---|
| `player_id` | text pk → `players.discord_user_id` | |
| `hands_played` | integer | |
| `hands_won` | integer | |
| `hands_lost` | integer | |
| `chips_bet` | bigint | sum of `chips_contributed` |
| `chips_won` | bigint | sum of `chips_won` |
| `chips_lost` | bigint | gross losing contributions (sum of `chips_contributed` on lost/folded hands) |
| `net_profit` | bigint | sum of `net_result` |
| `biggest_pot_won` | integer | max `pot_total` over won hands |
| `showdowns_won` | integer | |
| `showdowns_seen` | integer | |
| `vpip_count` | integer | |
| `pfr_count` | integer | |
| `aggressive_actions` | integer | |
| `passive_actions` | integer | |
| `category_counts` | jsonb | `{ "pair": 12, "flush": 3, "royal-flush": 1, … }` |
| `total_play_ms` | bigint | |
| `games_played` | integer | |
| `updated_at` | timestamptz | `defaultNow()` |

`bigint` is used for cumulative chip sums and play time that can exceed 32-bit
range over a player's lifetime. (Drizzle: `bigint(..., { mode: 'number' })`.)

Ratios (win rate, VPIP%, PFR%, aggression factor, showdown-win%) are **derived at
read time**, never stored. Both `chips_lost` (gross) and `net_profit` are stored,
so either loss definition is available.

### Play-time (no schema dependency on `game_players`)

Play-time is **not** tracked via the `game_players` audit table (it is not
written yet — deferred work). Instead `GameRoom` records each seat's join time in
memory and computes per-player `playMs` at leave / cash-out / game end, then
persists it through `recordSession` into the `player_stats` aggregate
(`total_play_ms`, `games_played`). No new column on `game_players` is required.

---

## 2. Capture wiring

Capture happens entirely inside `GameRoom` (`packages/server/src/rooms/game.ts`).

### Per-hand action tracker

VPIP, PFR, aggression, and per-player final street **cannot** be reconstructed
from the hand's final state — they must be observed as actions happen.

- A lightweight `HandStatsTracker` is created in `GameRoom.startHand()` and
  records the hand's start time.
- In `handleAction`, before calling `act()`, capture `phaseBefore =
  ctx.state.phase` and the acting player. On `result.ok`, record
  `{ playerId, street: phaseBefore, actionType, amount }`. Capturing the phase
  *before* the action keeps the street accurate even when an action closes a
  betting round.
- From this log the tracker derives per player: `vpip` (any non-blind
  call/raise pre-flop), `pfr` (any raise pre-flop), `aggressive_actions`
  (bets + raises), `passive_actions` (calls), `final_street` (last street the
  player was live on / where they folded), `was_all_in`.

### Assembling facts at hand end

In `concludeHand()` — which already holds `settleHand`'s `winningsByPlayer`,
`awards`, per-player `HandRank`, and the pot total — for each seated player build
one `PlayerHandStat`:

- `chips_contributed` = `totalBetThisHand`; `chips_won` from `winningsByPlayer`;
  `net_result` = won − contributed.
- `result`: `won` if `chips_won > 0`, else `folded` if the player folded, else
  `lost`.
- `hand_category`: from `result.hands[playerId].category`, upgraded to
  `royal-flush` when the category is `straight-flush` and the best five cards are
  T–A of one suit (detected from `HandRank.cards`). `null` if the player folded
  pre-showdown.
- `pot_total`, `went_to_showdown`, `position` (seats clockwise from button via
  dealer index), `duration_ms` (now − tracker start).

The batch is passed to `statsService.recordHand(facts)`.

### Play-time / session

- `GameRoom` stamps each seat's join time in memory at game start (and on
  reconnect-resume the original join time is preserved).
- Per-player `playMs` is computed at leave / cash-out / game end.
- At game end, `recordSession` folds `games_played` and accumulated
  `total_play_ms` into the aggregate per player.

---

## 3. Service, injection & idempotency

### `StatsService` (write side)

Injected into `GameRoom` exactly like `ChipService`, keeping the engine pure and
the room unit-testable.

```ts
interface PlayerHandStat { /* fields mirroring player_hand_stats columns */ }

interface StatsService {
  recordHand(facts: PlayerHandStat[]): Promise<void>;
  recordSession(input: {
    gameId: string;
    players: { playerId: string; playMs: number }[];
  }): Promise<void>;
}
```

- `recordHand` runs **one transaction**: bulk-insert facts
  (`onConflictDoNothing` on `(game_id, player_id, hand_number)`) **and**
  incrementally upsert aggregates via
  `INSERT … ON CONFLICT (player_id) DO UPDATE SET col = player_stats.col +
  excluded.col` (with `GREATEST` for `biggest_pot_won` and a JSONB merge for
  `category_counts`). Atomic, so facts and aggregates never diverge. To preserve
  idempotency at the aggregate level, aggregates are only incremented for facts
  that were actually inserted (use the `RETURNING` set from the fact insert).
- `recordSession` upserts `games_played` / `total_play_ms`.
- `noopStatsService` is used when `DATABASE_URL` is unset (dev/mock mode),
  mirroring `noopChipService`.
- The DB-backed implementation lives in `db/index.ts` (or a new `db/stats.ts`)
  next to `adjustChips`; it is wired in `rooms/index.ts` / `index.ts` next to the
  chip service.

### Recompute / backfill script

A script rebuilds the hand-derived `player_stats` columns from
`player_hand_stats`. This is the repair path, proves those aggregates are
derivable, and lets new aggregate columns be added later and recomputed from
history. Note: `total_play_ms` and `games_played` are session-level and **not**
present in the fact table, so the recompute preserves their existing values
rather than reconstructing them.

---

## 4. Read layer (the APIs)

### `StatsRepository` (read side)

Typed read functions in `db/stats.ts`. Pure shaping logic is split out so it is
unit-testable without a DB.

- `getPlayerStats(playerId)` → reads the `player_stats` row and returns a
  `PlayerStatsSummary` with **derived ratios computed in code** (win rate,
  VPIP%, PFR%, aggression factor, showdown-win%). The pure shaping function
  `toPlayerStatsSummary(row)` is unit-tested.
- `getLeaderboard({ metric, limit, since? })` → ranked list. All-time queries
  read `player_stats` (fast); a `since` window queries/aggregates
  `player_hand_stats`. `metric` is a typed enum (`net_profit`, `chips_won`,
  `hands_won`, `biggest_pot_won`, …). The sort/limit shaping is unit-tested.
- `getPlayerHandHistory(playerId, { limit, since })` → recent fact rows, for
  future stat pages / charts.

### HTTP routes

New `statsRouter` (`routes/stats.ts`), mounted at `/api/stats` in `index.ts`:

- `GET /api/stats/:playerId` → player summary (404 if no row).
- `GET /api/stats/leaderboard?metric=&limit=&since=` → leaderboard.
- `GET /api/stats/:playerId/hands?limit=&since=` → hand history.

- **Auth:** endpoints require a valid session cookie (`verifySession`), matching
  the rest of `/api`.
- **Mock mode:** without `DATABASE_URL`, routes respond gracefully (empty
  leaderboard / 404 summary) rather than throwing — same spirit as the no-op
  ledger.

### Shared contracts

Add to `@poker/shared` so the client can type-consume them later:
`PlayerStatsSummary`, `LeaderboardEntry`, `LeaderboardMetric`, `PlayerHandStat`.

---

## 5. Testing

- The pure poker engine is untouched; the existing 54 tests are unaffected.
- New `GameRoom` tests use a **fake recording `StatsService`** (alongside the
  existing fake chip ledger + fake io) and assert correct facts for: fold-out,
  multiway showdown, split pot, all-in, and that a **replayed hand does not
  double-record** (idempotency).
- Unit tests for: royal-flush detection, `toPlayerStatsSummary` ratio derivation,
  leaderboard sort/limit, and the recompute-from-facts script.
- Verify with `npm test` and `npm run build` before claiming done.

---

## Implementation surface (files)

- `packages/server/src/db/schema.ts` — two new tables (`player_hand_stats`,
  `player_stats`). No change to `game_players`.
- `packages/server/src/db/stats.ts` (new) — DB-backed `StatsService` + read
  functions; or extend `db/index.ts`.
- `packages/server/src/rooms/game.ts` — `HandStatsTracker`, fact assembly,
  `StatsService` injection, session timing.
- `packages/server/src/rooms/index.ts` & `src/index.ts` — wire the stats service
  (DB-backed vs no-op) next to the chip service.
- `packages/server/src/routes/stats.ts` (new) — `statsRouter`.
- `packages/server/src/stats/recompute.ts` (new) — backfill script.
- `packages/shared/src/types.ts` — `PlayerStatsSummary`, `LeaderboardEntry`,
  `LeaderboardMetric`, `PlayerHandStat`.
- Tests next to source as `*.test.ts`.
