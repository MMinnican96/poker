import type { LobbyPlayer, LobbyStatus } from '@poker/shared';
import { StatTile } from './StatTile';
import { useStats } from './useStats';
import { playerStatus, STATUS_STYLE } from './PlayerRow';

export interface PlayerProfileModalProps {
  player: LobbyPlayer;
  lobbyStatus: LobbyStatus;
  onClose: () => void;
}

function pct(n: number | undefined): string | null {
  return n == null ? null : `${Math.round(n * 100)}%`;
}
function num(n: number | undefined): string | null {
  return n == null ? null : n.toLocaleString();
}

export function PlayerProfileModal({ player, lobbyStatus, onClose }: PlayerProfileModalProps) {
  const { stats } = useStats(player.discordUserId);
  const status = playerStatus(player, lobbyStatus);
  const s = STATUS_STYLE[status];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-[rgba(4,18,12,0.6)] p-6 backdrop-blur-[3px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-w-full animate-pop overflow-hidden rounded-[26px] border-[3px] border-black/40 bg-felt-500 shadow-modal"
      >
        <div className="relative bg-gradient-to-b from-mint/15 to-transparent px-6 pb-5 pt-6">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border-2 border-black/30 bg-black/20 text-[#cfeadd] hover:bg-black/40"
          >
            ✕
          </button>
          <div className="flex items-center gap-4">
            <img
              src={player.avatarUrl}
              alt=""
              className="h-[72px] w-[72px] flex-none rounded-[20px] border-[3px] border-ink object-cover shadow-hard-ink"
            />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="font-display text-[25px] font-semibold text-white">{player.displayName}</span>
              <span
                className={`mt-2 inline-flex items-center gap-1.5 self-start rounded-pill px-3 py-1 text-xs font-extrabold ${s.bg} ${s.text}`}
              >
                <span className={`h-2 w-2 rounded-pill ${s.dot}`} />
                {status}
              </span>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 pt-2">
          <div className="grid grid-cols-2 gap-2.5">
            <StatTile label="CHIPS" value={player.chipBalance.toLocaleString()} accent="#ffd882" />
            <StatTile label="WIN RATE" value={pct(stats?.winRate)} />
            <StatTile label="HANDS WON" value={num(stats?.handsWon)} />
            <StatTile label="BIGGEST POT" value={num(stats?.biggestPotWon)} />
          </div>
          <button
            disabled
            className="mt-4 w-full cursor-not-allowed rounded-2xl border-[2.5px] border-ink bg-felt-300 py-3 font-display text-[15px] font-semibold text-white opacity-60"
          >
            View Profile (coming soon)
          </button>
        </div>
      </div>
    </div>
  );
}
