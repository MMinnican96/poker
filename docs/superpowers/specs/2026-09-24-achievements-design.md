# Career challenges, feats, titles and the trophy cabinet

Date: 2026-09-24. Status: approved for build.

## Goal

Challenges today are 14 hand-written daily/weekly tasks, 3 of each active per
period. This change:

1. **Grows the daily/weekly pool** (20 daily, 12 weekly) with more variety, and
   shows 4 daily + 3 weekly at a time.
2. Adds a permanent **career system** in the style of Call of Duty challenges:
   - **Career challenges**: 26 tiered challenges with 5 tiers each (I Bronze,
     II Silver, III Gold, IV Platinum, V Diamond) for doing an activity more.
   - **Feats**: 19 one-off, hard-to-get challenges with bigger rewards (win
     with a royal flush, win 10 hands in a row, ...). Some are secret.
3. Every career challenge and feat has an **emblem** (45 in all). Earning it
   unlocks **titles** a player can equip, and emblems a player can
   **showcase** in a **trophy cabinet** on their profile card.
4. Other players' unlocked emblems are visible on their profile card.

Profile "badges" (`badgesFor`, `ProfileCard.badges`) are removed: every badge
has an equivalent emblem (Royalty, Quads, Grinder, Big fish, Whale, Made rat,
Collector ...), and the backfill credits past play.

Code name for the system: **achievements** (`achievements.ts`,
`AchievementService`, `player_achievements`). Player-facing copy says
"career challenges", "feats", "emblems", "titles", "trophy cabinet".

## Vocabulary

| Term | Meaning |
|---|---|
| Achievement | A career challenge (tiered) or a feat (one tier). Has an id, emblem, metric and goals. |
| Tier | 1..5 for career challenges, 1 for feats. Tier *k* is reached when progress ≥ `goals[k-1]`. Tier 0 = locked. |
| Metric | What is counted. Defined once in a registry and shared by achievements and daily/weekly challenges. |
| Unlock | Reaching a tier. Permanent. Pays chips + XP immediately (no claim step) and may unlock a title. |
| Emblem | The visual for an achievement. Career emblems change metal with tier; feat emblems are coloured by rarity. |
| Showcase | Up to 5 emblems a player pins to their trophy cabinet, in order. |

## Metrics

A metric has an **id**, a **mode** and an evaluator.

- `sum`: each hand (or event) adds a value to progress.
- `max`: progress = max(progress, value). Used for values read from state (level, daily streak, items owned).
- `streak`: a per-hand predicate. `current` counts consecutive hands where it held (reset to 0 on a miss); progress = best `current` ever. For daily/weekly challenges the streak lives in the period row, so it restarts each period.

Hand metrics take a **`HandFact`**: the existing `PlayerHandStat` plus the new
fields below (all optional so old fact rows still type-check; missing means
false/0 and the hole-card/board metrics count nothing).

| New field | Meaning |
|---|---|
| `holeCards: [Card, Card] \| null` | The player's cards. Not stored in `player_hand_stats` (it's in `hand_history`). |
| `board: Card[]` | Final board. Same. |
| `playersDealt` | Number of players dealt in. |
| `startingStack` | Stack at the deal, before blinds. |
| `knockouts` | Opponents who finished the hand with 0 chips and were eligible for a pot this player won a share of. |
| `checkRaise` | On some street the player checked, then later raised (a raise, or an all-in that raised) on the same street. |
| `threeBet` | Pre-flop, the player made an aggressive action after another player had already raised (blinds are not raises). |
| `allInPreflop` | The player was in a pre-flop all-in: they went all-in pre-flop (an all-in action, or a blind that put them all in), or they called or covered an opponent's pre-flop all-in and stayed in the hand. |
| `behindOnTurn` | Only for hands that reached showdown with a 5-card board: with 4 board cards, the player's best hand scored strictly below at least one opponent who also reached showdown. Else false. |
| `splitPot` | The player won a share of a pot that had more than one winner. |
| `showdownOpponents` | Other players who reached showdown (0 if none). |

**Card privacy.** Unlocks, challenge completions, activity and profile
timestamps are public, so a metric may read hole cards (`holeCards`,
`behindOnTurn`, or anything derived from them) only for hands that reached
showdown, where the cards were tabled. A test checks every hand metric gives
the same value for a non-showdown fact whatever its hole cards.

Registry (ids are kebab-case strings; `won` = `result === 'won'`, `sd` =
`wentToShowdown`, `bb` = `bigBlind`, "category" = shown `handCategory`):

| Metric id | Mode | Value per hand / event |
|---|---|---|
| `hands-played` | sum | 1 |
| `hands-won` | sum | won |
| `showdowns-won` | sum | won ∧ sd |
| `flops-seen` | sum | finalStreet ≠ pre-flop |
| `steals` | sum | won ∧ ¬sd |
| `preflop-raises` | sum | pfr |
| `three-bets` | sum | threeBet |
| `check-raises` | sum | checkRaise |
| `all-in-wins` | sum | won ∧ wasAllIn |
| `knockouts` | sum | knockouts |
| `double-ups` | sum | startingStack > 0 ∧ startingStack + netResult ≥ 2·startingStack |
| `quadruple-ups` | sum | same with 4· |
| `pots-30bb` / `pots-50bb` / `pots-100bb` / `pots-250bb` | sum | won ∧ bb > 0 ∧ potTotal ≥ N·bb |
| `bb-won` | sum | bb > 0 ? max(0, netResult) / bb : 0 |
| `net-bb` | sum | bb > 0 ? netResult / bb : 0 (can go down; challenges only) |
| `minutes-played` | sum | durationMs / 60000 |
| `wins-two-pair-plus`, `wins-trips-plus`, `wins-straight-plus`, `wins-flush-plus`, `wins-full-house-plus` | sum | won ∧ sd ∧ category ≥ X |
| `wins-straight`, `wins-flush`, `wins-full-house`, `wins-quads`, `wins-straight-flush`, `wins-royal-flush` | sum | won ∧ sd ∧ category = X |
| `wins-four-aces` | sum | won ∧ sd ∧ quads of aces (evaluate hole + board) |
| `wins-wheel` | sum | won ∧ sd ∧ category = straight ∧ best five is A-2-3-4-5 |
| `pocket-pair-wins` | sum | won ∧ sd ∧ hole cards pair |
| `suited-wins` | sum | won ∧ sd ∧ hole cards same suit |
| `suckouts` | sum | won ∧ sd ∧ behindOnTurn |
| `all-in-suckouts` | sum | won ∧ sd ∧ behindOnTurn ∧ wasAllIn |
| `seven-deuce-wins` | sum | won ∧ sd ∧ hole is 7 + 2 of different suits |
| `aces-cracked` | sum | hole is A A ∧ result = lost ∧ sd |
| `bad-beats` | sum | result = lost ∧ sd ∧ category ≥ full house |
| `split-pots` | sum | splitPot ∧ sd |
| `rockets-all-in-wins` | sum | hole is A A ∧ allInPreflop ∧ won ∧ sd |
| `multiway-showdown-wins` | sum | won ∧ sd ∧ showdownOpponents ≥ 3 |
| `multi-knockouts` | sum | knockouts ≥ 2 |
| `win-streak` | streak | won |
| `fold-streak` | streak | result = folded |
| `level` | max | player level (event) |
| `daily-streak` | max | daily bonus streak after a claim (event) |
| `challenges-claimed` | sum | +1 per daily/weekly challenge claimed (event) |
| `items-owned` | max | distinct permanent, non-free shop items owned (event) |
| `tier-v-count` | max | number of career challenges at tier V (event, see Hall of fame) |

## Career challenges (26)

Rewards by tier, the same for every career challenge:

| Tier | Metal | Chips | XP |
|---|---|---|---|
| I | Bronze | 500 | 50 |
| II | Silver | 1,000 | 100 |
| III | Gold | 2,500 | 200 |
| IV | Platinum | 5,000 | 350 |
| V | Diamond | 10,000 | 600 |

Each unlocks a title at tier III and a better one at tier V. Descriptions are
generated from a template with the goal, e.g. "Play {n} hands." →
"Play 1,000 hands." Glyph is a concept; the client maps it to a game-icons.net
icon.

| Id | Group | Name | Description template | Metric | Goals I–V | Title III | Title V | Glyph |
|---|---|---|---|---|---|---|---|---|
| `grinder` | Grind | Grinder | Play {n} hands. | hands-played | 50, 250, 1000, 5000, 20000 | Regular | Furniture | armchair |
| `flop-chaser` | Grind | Flop chaser | See {n} flops. | flops-seen | 25, 150, 600, 2500, 10000 | Flop chaser | Board certified | card fan |
| `night-owl` | Grind | Night owl | Spend {n} hours in hands. Goals are stored in minutes and shown as 1, 5, 25, 100, 500 hours. | minutes-played | 60, 300, 1500, 6000, 30000 | Night owl | Lives here | owl |
| `pot-taker` | Winning | Pot taker | Win {n} hands. | hands-won | 25, 150, 600, 2500, 10000 | Pot taker | The bank | money bag |
| `showstopper` | Winning | Showstopper | Win {n} hands at showdown. | showdowns-won | 10, 60, 250, 1000, 4000 | Show pony | Showstopper | spotlight |
| `pickpocket` | Winning | Pickpocket | Win {n} hands without a showdown. | steals | 15, 100, 400, 1500, 6000 | Pickpocket | Cat burglar | robber mask |
| `money-maker` | Winning | Money maker | Win {n} big blinds in winning hands. | bb-won | 100, 500, 2500, 10000, 50000 | Money maker | Tycoon | coin stack |
| `big-fish` | Big game | Big fish | Win {n} pots of 50 big blinds or more. | pots-50bb | 1, 10, 50, 200, 750 | Big fish | Whale | fish |
| `shover` | Big game | Shover | Win {n} hands where you went all-in. | all-in-wins | 1, 10, 40, 150, 500 | Shover | Nerves of steel | fist |
| `rat-catcher` | Big game | Rat catcher | Bust {n} players. | knockouts | 1, 10, 50, 200, 750 | Rat catcher | Pied piper | mousetrap |
| `double-up` | Big game | Double up | Double your stack in a hand {n} times. | double-ups | 1, 5, 25, 100, 300 | Double trouble | Compound interest | upward arrows |
| `table-captain` | Aggression | Table captain | Raise before the flop in {n} hands. | preflop-raises | 25, 150, 600, 2500, 10000 | Table captain | The aggressor | captain hat |
| `re-raiser` | Aggression | Re-raiser | Three-bet {n} times. | three-bets | 5, 30, 120, 500, 2000 | Re-raiser | Three-bet menace | claws |
| `trapper` | Aggression | Trapper | Check-raise {n} times. | check-raises | 1, 10, 40, 150, 600 | Trapper | Snake in the grass | bear trap |
| `set-miner` | Made hands | Set miner | Win {n} showdowns with three of a kind or better. | wins-trips-plus | 5, 25, 100, 400, 1500 | Set miner | Triple threat | pickaxe |
| `straight-shooter` | Made hands | Straight shooter | Win {n} showdowns with a straight. | wins-straight | 3, 15, 60, 250, 1000 | Straight shooter | Straight and narrow | arrow |
| `flusher` | Made hands | Flusher | Win {n} showdowns with a flush. | wins-flush | 3, 15, 60, 250, 1000 | Flush with cash | Suited and booted | water splash |
| `boat-captain` | Made hands | Boat captain | Win {n} showdowns with a full house. | wins-full-house | 1, 5, 25, 100, 400 | Boat captain | Admiral | anchor |
| `quadfather` | Made hands | Quadfather | Win {n} showdowns with four of a kind. | wins-quads | 1, 3, 10, 25, 60 | Quadfather | Quad god | four-leaf clover |
| `deep-pockets` | Hole cards | Deep pockets | Win {n} showdowns with a pocket pair. | pocket-pair-wins | 10, 50, 200, 800, 3000 | Deep pockets | Pocket monster | knapsack |
| `well-suited` | Hole cards | Well suited | Win {n} showdowns with suited hole cards. | suited-wins | 10, 50, 200, 800, 3000 | Suit and tie | Well suited | bow tie |
| `river-rat` | Hole cards | River rat | Win {n} showdowns you were behind in after the turn. | suckouts | 1, 10, 40, 150, 500 | Lucky rat | River rat | horseshoe |
| `made-rat` | Club | Made rat | Reach level {n}. | level | 5, 10, 25, 50, 100 | Made rat | Rat king | throne |
| `clockwork` | Club | Clockwork | Claim the daily bonus {n} days in a row. | daily-streak | 3, 7, 14, 30, 100 | Clockwork | Never misses | alarm clock |
| `contractor` | Club | Contractor | Claim {n} daily or weekly challenges. | challenges-claimed | 5, 25, 100, 300, 1000 | Contractor | Overachiever | scroll |
| `collector` | Club | Collector | Own {n} shop items. | items-owned | 2, 5, 10, 18, 26 | Collector | Completionist | treasure chest |

`collector` tier V must never exceed the number of permanent non-free catalog
items; a test checks it.

Group order on screen: Grind, Winning, Big game, Aggression, Made hands, Hole
cards, Club.

## Feats (19)

One tier each. Title text = the feat's title column.

| Id | Name | Description | Metric (goal) | Chips / XP | Rarity | Secret | Title | Glyph |
|---|---|---|---|---|---|---|---|---|
| `fresh-cheese` | Fresh cheese | Win your first hand. | hands-won (1) | 250 / 25 | common | | Fresh cheese | cheese |
| `fair-share` | Fair share | Split a pot at showdown. | split-pots (1) | 1,000 / 100 | common | | Fair share | cleaver |
| `the-rock` | The rock | Fold 30 hands in a row. | fold-streak (30) | 1,500 / 100 | common | yes | The rock | stone block |
| `wheelie` | Wheelie | Win at showdown with a five-high straight. | wins-wheel (1) | 3,000 / 250 | rare | | Wheelie | wheel |
| `the-hammer` | The hammer | Win at showdown with seven-deuce offsuit. | seven-deuce-wins (1) | 5,000 / 400 | rare | yes | The hammer | hammer |
| `cracked` | Cracked | Lose at showdown holding pocket aces. | aces-cracked (1) | 2,500 / 200 | rare | yes | Aces cracked | cracked shield |
| `snakebit` | Snakebit | Lose at showdown with a full house or better. | bad-beats (1) | 5,000 / 400 | rare | | Snakebit | snake bite |
| `rockets` | Rockets | Win a pre-flop all-in holding pocket aces. | rockets-all-in-wins (1) | 3,000 / 250 | rare | | Rocket man | rocket |
| `on-a-heater` | On a heater | Win 5 hands in a row. | win-streak (5) | 5,000 / 400 | rare | | Heater | flame |
| `last-rat-standing` | Last rat standing | Win a showdown against three or more opponents. | multiway-showdown-wins (1) | 4,000 / 300 | rare | | Last rat standing | podium |
| `running-colours` | Running colours | Win at showdown with a straight flush. | wins-straight-flush (1) | 15,000 / 1,000 | epic | | Colour coordinated | rainbow |
| `four-horsemen` | Four horsemen | Win at showdown with four aces. | wins-four-aces (1) | 10,000 / 700 | epic | | Four horsemen | horse head |
| `moby` | Moby | Win a pot of 250 big blinds or more. | pots-250bb (1) | 10,000 / 700 | epic | | Moby | whale |
| `two-birds` | Two birds | Bust two players in one hand. | multi-knockouts (1) | 7,500 / 500 | epic | | Two birds | bird |
| `moon-shot` | Moon shot | Finish a hand with four times the chips you started it with. | quadruple-ups (1) | 10,000 / 700 | epic | | Moon shot | moon |
| `miracle-worker` | Miracle worker | Win an all-in you were behind in after the turn. | all-in-suckouts (1) | 5,000 / 400 | epic | | Miracle worker | angel wings |
| `royalty` | Royalty | Win at showdown with a royal flush. | wins-royal-flush (1) | 25,000 / 1,500 | legendary | | Royalty | crown |
| `unstoppable` | Unstoppable | Win 10 hands in a row. | win-streak (10) | 15,000 / 1,000 | legendary | | Unstoppable | meteor |
| `hall-of-fame` | Hall of fame | Reach tier V in five career challenges. | tier-v-count (5) | 25,000 / 1,500 | legendary | | Hall of famer | laurel trophy |

A secret feat, while locked, shows as "Secret feat" with a hint instead of its
name and description: the-rock "Patience is a virtue.", the-hammer "The worst
hand in poker has its day.", cracked "Even the best hand loses sometimes."

Feat order on screen: by rarity (common → legendary), then catalog order.

## Daily and weekly challenges

Same period mechanics as today (UTC day, ISO week, deterministic seeded pick,
same for everyone, claim to collect). Changes:

- `CHALLENGES_PER_PERIOD` becomes per period: **daily 4, weekly 3**.
- Each challenge has a `family` string. The pick walks the seeded shuffle and
  skips a challenge whose family is already picked, so one day never has, say,
  both "Win 8 hands" and "Win 3 at showdown" (family `wins`).
- Progress uses the metric registry. Streak challenges keep `current` in the
  `player_challenges` row (new column).
- The pick for the period in progress at deploy time changes. Accepted.

Existing ids keep their definitions. Pool (existing rows marked *):

| Id | Title | Description | Metric | Goal | Chips / XP | Family |
|---|---|---|---|---|---|---|
| `d-play-25`* | Pull up a chair | Play 25 hands. | hands-played | 25 | 500 / 40 | volume |
| `d-play-50` | Settle in | Play 50 hands. | hands-played | 50 | 800 / 60 | volume |
| `d-win-8`* | Rake it in | Win 8 hands. | hands-won | 8 | 750 / 50 | wins |
| `d-showdown-3`* | Show me | Win 3 hands at showdown. | showdowns-won | 3 | 750 / 50 | wins |
| `d-steal-5` | Pickpocket | Win 5 hands without a showdown. | steals | 5 | 600 / 40 | wins |
| `d-flops-12`* | See the flop | See 12 flops. | flops-seen | 12 | 500 / 40 | volume |
| `d-pfr-5`* | Take the lead | Raise before the flop in 5 hands. | preflop-raises | 5 | 600 / 40 | aggression |
| `d-3bet-3` | Push back | Three-bet 3 times. | three-bets | 3 | 700 / 50 | aggression |
| `d-check-raise` | Gotcha | Check-raise once. | check-raises | 1 | 800 / 60 | aggression |
| `d-trips`* | Three's company | Win a hand with three of a kind or better. | wins-trips-plus | 1 | 800 / 60 | made-hand |
| `d-two-pair-3` | Double vision | Win 3 showdowns with two pair or better. | wins-two-pair-plus | 3 | 700 / 50 | made-hand |
| `d-straight` | Straight up | Win a showdown with a straight or better. | wins-straight-plus | 1 | 800 / 60 | made-hand |
| `d-flush` | Flush it | Win a showdown with a flush or better. | wins-flush-plus | 1 | 900 / 60 | made-hand |
| `d-pocket-pair-2` | Pocket change | Win 2 showdowns with a pocket pair. | pocket-pair-wins | 2 | 700 / 50 | hole-cards |
| `d-suited-3` | Suits you | Win 3 showdowns with suited hole cards. | suited-wins | 3 | 600 / 40 | hole-cards |
| `d-big-pot`* | Big fish | Win a pot of 30 big blinds or more. | pots-30bb | 1 | 800 / 60 | big-game |
| `d-all-in`* | Shove it | Win a hand where you went all-in. | all-in-wins | 1 | 1,000 / 60 | big-game |
| `d-knockout` | Bouncer | Bust a player. | knockouts | 1 | 1,000 / 70 | big-game |
| `d-streak-3` | Hot hand | Win 3 hands in a row. | win-streak | 3 | 900 / 60 | streak |
| `d-profit-20` | Up on the day | Finish the day 20 big blinds up. | net-bb | 20 | 900 / 60 | profit |
| `w-play-200`* | Regular | Play 200 hands this week. | hands-played | 200 | 4,000 / 300 | volume |
| `w-flops-80` | Flop tourist | See 80 flops this week. | flops-seen | 80 | 4,000 / 300 | volume |
| `w-win-50`* | Pot collector | Win 50 hands this week. | hands-won | 50 | 5,000 / 350 | wins |
| `w-showdown-15`* | Showdown specialist | Win 15 hands at showdown. | showdowns-won | 15 | 5,000 / 350 | wins |
| `w-steal-40` | Heist week | Win 40 hands without a showdown. | steals | 40 | 5,000 / 350 | wins |
| `w-3bet-25` | Pressure cooker | Three-bet 25 times. | three-bets | 25 | 5,000 / 350 | aggression |
| `w-boat`* | Full house party | Win 2 hands with a full house or better. | wins-full-house-plus | 2 | 6,000 / 400 | made-hand |
| `w-suckout-3` | Never say die | Win 3 showdowns you were behind in after the turn. | suckouts | 3 | 6,000 / 400 | made-hand |
| `w-whale`* | Whale watching | Win a pot of 100 big blinds or more. | pots-100bb | 1 | 6,000 / 400 | big-game |
| `w-knockouts-10` | Closing time | Bust 10 players this week. | knockouts | 10 | 6,000 / 400 | big-game |
| `w-streak-5` | Red hot | Win 5 hands in a row. | win-streak | 5 | 7,000 / 450 | streak |
| `w-profit`* | In the black | Finish the week 150 big blinds up. | net-bb | 150 | 7,500 / 450 | profit |

## Titles

- Title ids: shop titles keep `title-*`. Achievement titles are
  `ach:<achievementId>:<tier>` (career, tier 3 or 5) and `ach:<achievementId>`
  (feats).
- `players.loadout_title` holds either kind. A shared resolver
  (`getTitle(id)` → `{ id, text, source: 'shop' | 'achievement', achievementId?, tier? } | undefined`)
  is used by `cosmeticsFor` (so `Cosmetics.title` stays the display text and
  seats, lobby and chat show earned titles with no other change) and by the
  client's `titleText`.
- Equipping: `POST /api/shop/equip { slot: 'title', itemId }` accepts an
  achievement title when the player has reached that tier. Other slots are
  unchanged.

## Showcase and the trophy cabinet

- `players.showcase text[] not null default '{}'`: up to 5 distinct
  achievement ids, each unlocked by the player, in display order.
- `PUT /api/achievements/showcase { ids: string[] }` validates length ≤ 5,
  uniqueness, known ids and unlocked; the error sentences are player-facing.
- When a player's showcase is empty, profile cards show an automatic pick: the
  top 5 unlocked emblems by (feat rarity, then career tier, then most recent).
  `auto: true` tells the client it wasn't chosen.

## Data model (migration `0002_achievements.sql`, idempotent)

- `player_achievements (id uuid pk, player_id text fk players, achievement_id text,
  progress double precision not null default 0, current double precision not null default 0,
  tier integer not null default 0, updated_at timestamptz not null default now())`,
  unique `(player_id, achievement_id)`, check `tier between 0 and 5`.
- `player_achievement_unlocks (id uuid pk, player_id text fk, achievement_id text,
  tier integer not null, unlocked_at timestamptz not null default now())`,
  unique `(player_id, achievement_id, tier)`, index `(player_id, unlocked_at)`.
- `player_challenges.current double precision not null default 0`.
- `players.showcase text[] not null default '{}'`.
- `player_hand_stats` gets nullable columns: `players_dealt integer`,
  `starting_stack integer`, `knockouts integer`, `check_raise boolean`,
  `three_bet boolean`, `all_in_preflop boolean`, `behind_on_turn boolean`,
  `split_pot boolean`, `showdown_opponents integer`. New facts fill them; old
  rows stay null.
- `app_meta (key text pk, value text not null, updated_at timestamptz default now())`
  for the one-time backfill marker.

Use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `DO ... EXCEPTION WHEN
duplicate_object`, like `0001_leases.sql`. Generate with `db:generate`, then
make it idempotent; keep the drizzle journal/snapshot consistent.

## Server behaviour

**Recording (in the hand's existing `recordHand` transaction).** After XP and
daily/weekly challenges, for each fresh fact, update every achievement whose
metric is a hand metric, in SQL, atomically:

- sum: `progress = progress + v` (skip when v = 0)
- streak: `current = CASE WHEN hit THEN current + 1 ELSE 0 END`,
  `progress = GREATEST(progress, new current)` (always written, since a miss resets)

Then for each row whose progress crossed new goals, for every newly reached
tier: insert the unlock row (`ON CONFLICT DO NOTHING`; only a newly inserted
row pays), set `tier`, credit chips via `creditIn` with type `'achievement'`
and key `achievement:<playerId>:<achievementId>:<tier>`, grant XP via
`grantXp` (which pays level-ups). Level-ups feed the `level` metric, and new
tier V unlocks feed `tier-v-count`; loop until nothing changes.
`RecordOutcome` gains `unlocks: AchievementUnlock[]`
(`{ playerId, achievementId, tier, chips, xp, titleId: string | null }`).

**Event metrics.** One entry point, e.g.
`achievements.recordEvent(tx, playerId, metricId, value)`, used inside the
existing transactions of:

- `grantXp` / level-ups → `level`
- `RewardsService.claimDaily` → `daily-streak` (the new streak)
- `RewardsService.claimChallenge` → `challenges-claimed` (+1)
- `ShopService.purchase` → `items-owned`

These return unlocks. The REST handler sends each unlock as a notice through
Realtime (add a `notify(playerId, notice)` to the `Realtime` interface) and
emits activity for feats and tier V. Chips move only through `Bank`.

**Notices.** `Notice` gains optional `emblem?: { achievementId: string; tier: number }`.
Unlock notice copy (sentence case):

- Career: title `"{Name} {roman tier}"` e.g. "Grinder III", body
  `"+2,500 chips and 200 XP. New title: Regular."` (title sentence only when one unlocked).
- Feat: title `"Feat unlocked: {Name}"`, same body.
- Activity (room feed, new kind `'achievement'`): feats and tier V only —
  `earned the “Royalty” feat` / `reached Grinder V`.

The table room sends these from `outcome.unlocks` next to level-ups and
challenge notices.

**Backfill.** `recomputeAchievements(db)` folds every player's facts in
`(created_at, hand_number)` order, joined with `hand_history` for hole cards
and board, plus event metrics read from current state (level from XP, current
`daily_streak`, count of claimed `player_challenges` rows, items owned). It
writes `progress = GREATEST(existing, computed)` (and `current` from the fold)
then grants any tiers now reached exactly as live unlocks do (idempotent, no
notices). Runs once at boot, after migrations and before `listen`, guarded by
the `app_meta` key `achievements-backfill-v1` (set only after success; a
failure is logged, not fatal). Also a CLI: `npm run achievements:recompute -w
@poker/server`, like `stats:recompute`. Metrics that need the new columns only
count hands recorded after this change.

## REST and wire types

- `GET /api/achievements` → `AchievementsResponse`:
  `{ achievements: AchievementProgress[]; showcase: string[] }` where
  `AchievementProgress = { id, progress, tier, unlocks: { tier, unlockedAt }[] }`
  for every achievement in the catalog (zeros for untouched ones). The client
  joins these with the shared catalog for names, goals, rewards and emblems.
- `PUT /api/achievements/showcase` → `{ ok: true, showcase } | { ok: false, error }` (409 on validation error, like other routes).
- `ProfileCard`: remove `badges`; add
  `trophies: { showcase: string[]; auto: boolean; unlocked: { id: string; tier: number; unlockedAt: string }[]; emblems: number; total: number }`
  where `unlocked` has each unlocked achievement once at its highest tier,
  `emblems` = number unlocked, `total` = catalog size.
- Shared exports the catalog (`ACHIEVEMENTS`, `getAchievement`, `TIER_INFO`
  with names, roman numerals, metal colours and rewards, `RARITY_COLOURS` for
  feats), `tierFor(def, progress)`, `describeGoal(def, tier)`, the metric
  registry, `getTitle`, `achievementTitles(def)`, and the `HandFact` type.

## Client

All copy sentence case; tokens only for UI colours; emblem metal/rarity colours
come from the shared catalog.

- **Emblem** (`cosmetics/Emblem.tsx`): an SVG. Career emblems: a round
  medallion with a metal gradient for the tier (bronze, silver, gold, platinum,
  diamond with a prismatic sheen), tier notches or pips on the rim, and the
  glyph in the centre. Feats: a shield/crest shape in the rarity colour with a
  ribbon; legendary gets a subtle animated shine that respects
  `prefers-reduced-motion`. Locked: a dark walnut silhouette of the shape with
  a faint glyph (secret feats show a "?" glyph). Sizes 24–112 px. Glyphs come
  from `react-icons/gi` (game-icons.net, CC BY 3.0) through one typed map from
  the shared glyph keys to components, so a missing key fails type-checking.
  Credit game-icons.net in the Trophy cabinet tab footer and in a credits file.
- **Challenges screen** gets tabs: "Daily & weekly" (today's content),
  "Career", "Feats", "Trophy cabinet".
  - Career: grouped by group heading. Each row: emblem at current tier (locked
    silhouette at tier 0), name, "Gold · tier III of V", five tier pips, the
    next goal sentence, progress bar with numbers, next tier's reward, and the
    title the next title tier gives. Maxed rows say "Complete".
  - Feats: a grid of cards: emblem, name, description (or secret hint),
    rarity label, reward, and unlock date once earned. Locked cards are dimmed.
  - Trophy cabinet: a walnut shelf with 5 plaques showing the showcase; "Edit
    showcase" opens a picker of unlocked emblems (choose up to 5, in order,
    save). A title picker lists every title the player can equip (shop-owned
    and earned), grouped, with the equipped one marked. Counts: "12 of 45
    emblems unlocked".
- **Profile card**: the Badges section becomes "Trophy cabinet": the shelf of
  showcased emblems, "{n} of {total} emblems", and a "See all" toggle that
  shows every unlocked emblem with name and tier (a tooltip shows the date).
  Empty state: "No emblems yet. They come from career challenges and feats."
- **Toasts**: a notice with `emblem` shows the emblem next to the text.
- API client methods: `achievements()`, `setShowcase(ids)`; titles equip via the
  existing equip call.

## Tests

- Shared: every metric evaluator; `tierFor`/`describeGoal`; catalog sanity
  (unique ids, 5 ascending goals for career, 1 goal for feats, every metric id
  known, every glyph key known, titles unique and non-empty, collector V ≤
  permanent non-free items); `activeChallenges` returns 4/3 with distinct
  families and is deterministic; `getTitle` for shop and achievement ids;
  `cosmeticsFor` with an achievement title.
- Server: `buildHandFacts` new fields (knockouts, check-raise, three-bet,
  all-in pre-flop, behind-on-turn, split pot, starting stack) from scripted
  hands; recorder unlocks pay once and only once (replayed hand, concurrent
  recordings), streaks reset on a miss, level/daily/claim/purchase events;
  backfill is idempotent and grants tiers; showcase and title-equip
  validation; migration applies twice cleanly; e2e: play hands over the socket
  and see an unlock notice + `GET /api/achievements` + profile `trophies`.
- Client: Emblem renders every glyph key for every tier/rarity/locked state;
  Challenges tabs; career row and feat card states; showcase editing; title
  picker; profile trophy section; toast with emblem.
- Chip-conservation property test stays green.

## Docs

Update `docs/ARCHITECTURE.md` (achievements pipeline, tables, REST, notices),
`docs/SETUP.md` (backfill at boot + CLI), `docs/DESIGN_STANDARDS.md` (emblem
component, metal/rarity colours, credit), `CLAUDE.md` (layout + commands), and
`RELEASE_NOTES.md`.
