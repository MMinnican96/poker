import type { LobbyPlayer, LobbyStatus } from '@poker/shared';
import { PlayerRow, playerStatus } from './PlayerRow';

export interface PlayersPanelProps {
  players: LobbyPlayer[];
  lobbyStatus: LobbyStatus;
  maxPlayers: number;
  onSelectPlayer: (id: string) => void;
}

export function PlayersPanel({ players, lobbyStatus, maxPlayers, onSelectPlayer }: PlayersPanelProps) {
  return (
    <aside className="flex min-w-[212px] flex-[0_1_270px] flex-col overflow-hidden rounded-3xl border-[2.5px] border-black/30 bg-felt-900/55 shadow-panel">
      <div className="flex items-center justify-between px-5 pb-3.5 pt-[18px]">
        <span className="font-display text-lg font-semibold text-white">Players</span>
        <span className="rounded-pill border-2 border-gold-border bg-gold px-2.5 py-[3px] font-display text-[13px] font-semibold text-[#2a1c00]">
          {players.length} / {maxPlayers}
        </span>
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden px-3 pb-3.5">
        {players.map((p) => (
          <PlayerRow
            key={p.discordUserId}
            player={p}
            status={playerStatus(p, lobbyStatus)}
            onSelect={() => onSelectPlayer(p.discordUserId)}
          />
        ))}
      </div>
    </aside>
  );
}
