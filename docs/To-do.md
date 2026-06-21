# Poker

## To do and Ideas

- Logo for Discord Application
- Stat Tracking ✅
- Lobby Design
- Spectate System ✅
- Auto Choice Selection
- Leaderboard
- XP/Challenges - Levels. Could relate to unlocks etc.
- Shop - Titles
- Admin
- Host/Player
- Player Status - 'In-Game, Ready, In Lobby. - Could expand to discord status as well.
- Recent Acitivity
- User Settings
- Full Profile Pages

## Game Engine

- When a game is active it should be viewebale from the lobby. Only 1 game will ever be ongoing at a time so we don't need to implement a lobby list/multiple game support. Instead it should show the active game from the lobby so players can join in-progress games so they can either spectate the game or take part. When a player joins an active game they are automatically placed in spectate but should have the option once spectating the game to be able to queue to join next hand. We need to make sure we follow the rules of max players at table etc.
- When a player goes all in, if they lose the all in they should be removed from the table. If there is only 1 player remaining at the table the game should end and everyone should be returned to the lobby. If there are still more than 1 player at the table with chips the game should carry on without the player who has gone bust. The bust player should be removed from the game and sent back to the lobby - this action is just temporary as we will eventually implement a spectater player state which instead it will move the player to so they can watch the game with the remaining players but not take part.

## Completed

- **Spectate System** — spectator/seated `Member` model, hand-boundary
  `applyPending` resolver, idle-at-1/end-at-0 teardown, `seatSession`-scoped
  ledger keys, `ActiveGameSummary` lobby injection, `joined_table`/`left_table`
  client routing. Busted players auto-spectate; immediate leave for spectators.
  (Resolved the two Known Bugs below: bust-stuck table and no exit to lobby.)

## Known Bugs

- When a player goes all in, if a player follows who has more credits and ticks all in it puts them all in as well, whereas instead it should just call with the correct amount of chips.
