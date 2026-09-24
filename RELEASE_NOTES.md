# Release Notes

## Unreleased

### New

- **Show or hide your cards.** Anyone dealt into a hand can show their cards
  when it ends, even after a fold-out or after folding themselves. Pick "Show
  cards at the end" during the hand, or "Show cards" / "Hide cards" while the
  result is up. Cards tabled at showdown stay face up. A choice made mid-hand
  stays private until the hand is over, and showing keeps the result up a
  little longer so everyone sees it.
- **All-new sound.** A full set of table sounds: card deals, flop, turn and
  river, flips, folds, a knock for a check, and different chip sounds for a
  call, bet, raise and all-in. Also a chime for your turn, the pot pushed to
  the winner, your win, a sting when raises pile up, and soft cues for new
  messages and achievements. Every clip is levelled to the same loudness, and
  they play through a limiter so a busy table never clips. Your turn chime and
  timer still play while you're browsing another screen.
- **Sound settings.** Overall volume, a slider for each kind of sound (chips
  and actions, cards, your turn and timer, wins and stings, messages) with a
  "Play a sample" button, and one-tap mute. Open them from the table menu or
  the lobby header. Your settings are kept on this device.
- **Timer ticks.** A clock ticks through the last 5 seconds of your turn,
  whatever the table's turn length. You can turn it off in sound settings.

### Changed

- Under a player's name at showdown you now see just the hand type ("Two
  pair"); the full hand ("Two pair, jacks and eights") is still on the felt
  with the result.
- A hand won by everyone folding now stays on screen for 3.5 seconds, up from
  2.5.

## v0.2.0 — The back room (2026-09-24)

A ground-up rebuild of Ratbag Poker Night: new poker engine, a chip bank that
survives restarts, one persistent table per voice channel, and a lot more to do
between hands.

### New

- **A table that stays open.** Whoever opens the table is the host and picks the
  rules: blinds, optional ante, buy-in range, 2 to 9 seats, turn timer and the
  felt. Anyone in the Activity can watch or take a seat with their own buy-in.
  Once the host deals the first hand, hands keep coming while two or more
  players are in.
- **Sit out, top up, stand up, leave.** Changes you make mid-hand wait for the
  hand to end, and one "Cancel all" undoes them. Miss two turns and you're sat
  out until you tap "I'm back". If the host leaves, someone else takes over.
- **Better table.** Seats rotate so you're always at the bottom; the layout
  keeps name plates, bets, cards and the dealer button clear of each other from
  a small Discord window to a phone to a big monitor. Side pots, a showdown
  banner with the winning five highlighted, all-in run-outs dealt face up,
  chips sliding to the winner, and your win celebration.
- **Faster play.** Pre-actions (check/fold, check, call any), raise presets with
  an honest "Max" vs "All-in", keyboard shortcuts (F, C, R), and a turn timer
  that follows the server's clock.
- **Leaderboard.** Net profit, bankroll, chips won, hands won, biggest pot,
  hands played and level, weekly or all-time, with your own rank pinned.
- **Stats.** Your profit over time, win rate, VPIP, PFR, aggression, showdown
  record, best hands, and your recent hands with opponents' unshown cards kept
  hidden.
- **XP, levels and challenges.** XP for every hand, chip rewards at each level,
  three daily and three weekly challenges, and a daily bonus that grows with
  your streak.
- **Shop.** Felts, card backs, avatar frames, titles, win celebrations, emote
  packs and throwables (tomatoes, cheese, snowballs...). Everyone sees what you
  equip.
- **Profile cards.** A collectible card for every player: framed portrait,
  level, bankroll, stat sheet, recent form and badges.
- **Messages.** Room chat shared by the lobby and the table, plus direct
  messages with unread counts.
- **Emotes and throwables** at the table, and a room activity feed for big wins,
  rare hands, level-ups and completed challenges.
- **A new look.** Walnut, baize, card stock and brass, with the Ratbag crest
  printed on the felt. Better contrast, full keyboard support, and reduced
  motion respected throughout.

### Fixed

- Chips can no longer be lost, duplicated or double-spent. Chips at the table
  are held in escrow in the database, not in memory, and every movement is
  recorded in the ledger.
- A server restart no longer wipes the chips on the table: players are cashed
  out before it stops, and anything left behind by a crash is refunded
  automatically.
- A player with more chips pressing all-in against a smaller all-in now just
  calls.
- Uncalled bets are returned instead of padding the pot (and your stats).
- An all-in that's less than a full raise no longer lets players who already
  acted raise again.
- Odd chips in a split pot go to the first winner left of the button.
- Heads-up blinds and first-to-act are right, including when a blind is all-in.
- The dealer button no longer skips or repeats seats when people leave.
- Sign-in is verified by the server; nobody can claim to be someone else or
  choose their own balance.

### Upgrade notes (for the owner)

- The database upgrades itself on the first boot: balances, the chip ledger and
  lifetime stats are kept. XP, levels, shop items and challenges start at zero
  for everyone. There's no more `db:push` step when deploying.
- Deploy while nobody is at a table. From then on, restarts cash players out
  cleanly; set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=20` on Railway so the server
  has time to do it.
- `JWT_SECRET` must be set in production. `VITE_SERVER_URL` is no longer used.
- Local development needs no database: leave `DATABASE_URL` blank and the server
  runs an embedded Postgres.

---

## v0.1.0 — First release (2026-06-21)

The first public cut of **Discord Poker** — a multiplayer Texas Hold'em game that
runs as a **Discord Activity** (an embedded app launched from a voice channel).
Players sit down at a cartoon felt table, play with persistent chip balances, and
spectate or join games in progress. Below are the main features in this release.

### Play poker in Discord
- Launches as a Discord Activity inside a voice channel; identity is resolved
  from Discord via OAuth (never trusted from the client).
- A zero-setup **mock mode** for local development lets you open two browser tabs
  and play against yourself without Discord or a database.

### Authoritative Texas Hold'em engine
- Full No-Limit Hold'em rules: shuffling and dealing, blinds, betting rounds
  (check / call / raise / all-in / fold), side pots, and showdown hand
  evaluation through to a winner.
- The **server is the single source of truth** for all game state — clients only
  render what they receive and send action intents.
- Built for fair play: the deck never leaves the server, and opponents' hole
  cards stay hidden until showdown.

### The table (cartoon 2D felt)
- Seats are spread evenly around the felt with players' real Discord avatars; you
  always sit at the bottom-centre.
- Dealer, Small Blind, and Big Blind are marked on each seat; the active player
  shows a green countdown ring as their turn timer runs down.
- Cards deal out to the board and reveal at showdown; the pot and any side pots
  are shown under the community cards, with each player's chips and latest action
  beside their seat.
- Your hand area shows your hole cards, your current hand value (on every street,
  including pre-flop), your chips at the table, your bank balance, and your turn
  timer.
- An action bar with quick-raise presets (½ Pot / Pot / 2×), a raise slider, and
  Fold / Call / Raise / All-In — it stays in place and enables only on your turn.

### Spectate, join, and leave
- Anyone can watch a game in progress as a **spectator** (dealt no cards, hole
  cards stay hidden).
- Spectators can **buy in and join** the next hand when there's an open seat and
  enough chips; seated players can **sit out** to spectate or **leave** the table.
- Mid-hand transitions resolve cleanly at the hand boundary, a busted player is
  moved to spectating automatically, and the table waits when only one player
  remains.

### Lobby (Ratbag Poker Night)
- A cartoon-styled lobby showing who's around, their status (In Lobby / Ready /
  In-Game · At Table / Spectating), and any active game you can jump into.
- An explicit **host model**: a player creates the game and configures the table,
  including a host-set turn timer.
- A profile pop-out (your stats, how-to-play) and quick player profile cards,
  reused consistently between the lobby and the table.

### Persistent chips
- Chip balances persist between sessions; buy-ins and cash-outs move chips through
  a safe, idempotent ledger that can never push a balance negative.
- Balances update live across the lobby and table as players buy in, sit in, and
  cash out.

### Player statistics
- Every hand is recorded as a fact, and per-player lifetime aggregates are kept
  for fast reads (hands won, win rate, biggest pot, net profit, and more).
- Stats are served over a read-only API and surfaced in profile views.

---

### Notes
- This is an early release focused on core gameplay. Production deployment and a
  live Discord application are still being wired up.
- Some lobby features are visible but marked **Coming Soon** (Shop, Leaderboard,
  friends, full profile pages, settings toggles).

**Built with:** TypeScript across an npm-workspaces monorepo — a Node + Socket.io
server, a React + Tailwind client, and a shared types/engine package.
