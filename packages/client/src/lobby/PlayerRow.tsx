import type { LobbyPlayer, TableRole } from '@poker/shared';

export type PlayerStatusLabel =
  | 'Ready'
  | 'In Lobby'
  | 'In-Game · At Table'
  | 'In-Game · Spectating';

export function playerStatus(player: LobbyPlayer, tableRole: TableRole | null): PlayerStatusLabel {
  if (tableRole === 'seated') return 'In-Game · At Table';
  if (tableRole === 'spectator') return 'In-Game · Spectating';
  return player.isReady ? 'Ready' : 'In Lobby';
}

export const STATUS_STYLE: Record<PlayerStatusLabel, { dot: string; text: string; bg: string }> = {
  Ready: { dot: 'bg-mint', text: 'text-mint-bright', bg: 'bg-mint/15' },
  'In Lobby': { dot: 'bg-[#ffcb52]', text: 'text-gold-soft', bg: 'bg-gold/15' },
  'In-Game · At Table': { dot: 'bg-blue', text: 'text-[#9ad4ff]', bg: 'bg-blue/15' },
  'In-Game · Spectating': { dot: 'bg-[#b9a3ff]', text: 'text-[#c9b8ff]', bg: 'bg-[#b9a3ff]/15' },
};

export interface PlayerRowProps {
  player: LobbyPlayer;
  status: PlayerStatusLabel;
  onSelect: () => void;
}

export function PlayerRow({ player, status, onSelect }: PlayerRowProps) {
  const s = STATUS_STYLE[status];
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl border-2 border-black/20 bg-white/5 px-3 py-2.5 text-left transition-transform hover:translate-x-0.5 hover:bg-white/10"
    >
      <img
        src={player.avatarUrl}
        alt=""
        className="h-[42px] w-[42px] flex-none rounded-xl border-[2.5px] border-ink object-cover"
      />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-display text-[15px] font-semibold text-white">
          {player.displayName}
        </span>
        <span className="truncate text-xs font-bold text-[#79a892]">
          {player.chipBalance.toLocaleString()} chips
        </span>
      </span>
      <span
        className={`inline-flex flex-none items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-extrabold ${s.bg} ${s.text}`}
      >
        <span className={`h-2 w-2 rounded-pill ${s.dot}`} />
        {status}
      </span>
    </button>
  );
}
