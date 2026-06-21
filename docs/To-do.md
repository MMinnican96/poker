# Poker

## To do and Ideas

- Logo for Discord Application
- Stat Tracking ✅
- Lobby Design ✅
- Spectate System
- Auto Choice Selection
- Leaderboard
- XP/Challenges - Levels. Could relate to unlocks etc.
- Shop - Titles
- Admin
- Host/Player ✅
- Player Status - 'In-Game, Ready, In Lobby. - Could expand to discord status as well. ✅
- Recent Acitivity
- User Settings
- Full Profile Pages
- No table by default and whichever player selects Create Table is Host.
- Reveal phase

## Game Engine

- When a game is active it should be viewebale from the lobby. Only 1 game will ever be ongoing at a time so we don't need to implement a lobby list/multiple game support. Instead it should show the active game from the lobby so players can join in-progress games so they can either spectate the game or take part. When a player joins an active game they are automatically placed in spectate but should have the option once spectating the game to be able to queue to join next hand. We need to make sure we follow the rules of max players at table etc.
- When a player goes all in, if they lose the all in they should be removed from the table. If there is only 1 player remaining at the table the game should end and everyone should be returned to the lobby. If there are still more than 1 player at the table with chips the game should carry on without the player who has gone bust. The bust player should be removed from the game and sent back to the lobby - this action is just temporary as we will eventually implement a spectater player state which instead it will move the player to so they can watch the game with the remaining players but not take part.
- Players should be able to Leave the table or enter spectate. If only one player remains at the table the next hand should not start until another player joins the table

## Spectate/Leave Table/Join Table

- If a game is already being played, players who join the activity after/did not ready up to play should be able to select 'Join Table' from the lobby and be added to the game in spectate state
- Players in spectate state should be able to see the game (but not see players hole cards when they are face down.)
- Spectate players should not be dealt cards as they are only viewing the game
- There should be a visual indicator in the game for who is spectating (like an eye icon players can hover over to see who is spectating). This should also exist in the lobby as active games should display who is at the table and who is spectating.
- If a player goes bust and runs out of chips during the game they should be automatically moved to spectate.
- Players at the table (in either spectate or playing) should be able to leave the table. Leaving the table should put the player back into the lobby
- If a player attempts to leave the table during a hand they are only moved from the table once the current hand finishes and not mid hand to avoid removing an active player during play (even if that player has folded)
- Players in spectate should be able to join the table if there is enough space to join. They must also have enough chips for the buy-in setting for the active table - if they do not have enough chips for the buy-in/too many players at at the table then Join Table should be greyed out and a hover over message explaining why. Players in spectate should be able to leave the table at any point in the hand.
- If a player moves from playing to spectate the chip actions should account for this (cashout/bust depending on why they left the table).
- If all players leave the table to spectate, whoever remains in the game should be sent back to the lobby.

## Known Bugs

- When a player runs out of money and busts they are left at the table (if there are only two players the table gets stuck and can't start the next hand).
- There is no way to exit the table back to the lobby
- When a player goes all in, if a player follows who has more credits and ticks all in it puts them all in as well, whereas instead it should just call with the correct amount of chips.
- ✅ When the game first launches and it is not the players turn the screen is blank until it becomes your turn. Once it is your turn the table shows properly and remains as showing properly. Thjis seems like it can also happen for the initial player.
- ✅ When a player at the table goes into spectate/leaves the table (only tested with 2 players at table and one goes to spectate) the player who went to spectate/left still shows on the table whereas they should be moved off the table.
- ✅ There is no way to cancel spectate/rejoin the table in the UI once a player is in spectate.
- ✅ The status that shows on the player list in the lobby doesn't update when a player returns back to lobby - for example if a player leaves the table the lobby list should show then as In Lobby once they are exited back to the lobby after the hand - it currently shows as In-Game. We should also look at adding additional states like 'In-Game - Spectating' and 'In-Game - At Table'. This seems to be a refresh issue where the lobby isn't actually refreshed with up to date info as chip values didn't change either until I reloaded the game for both players.
- ✅ It also looks like the ability to start a new table after everyone has left an active table doesn't work correctly and doesn't ttrack who should be host/player. I tested with 2 players at the table, the host of the initial game left after the player of the initial game and when back at lobby, the player on the initial game can ready up but the host of the initial game can't start the game. We need to track a new host after they have left. Worth refactoring Host/Player so it is not first person to join the lobby, instead when there is no active game the Table Settings should allow anyone to click 'Create a Game' using the settings they have selected. Once a game is hosted the player view changes to be able to ready up like it is now. That way if a table ends someone can host a game rather than it having to be the first person back to the lobby.
