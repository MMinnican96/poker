# Release Notes

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
