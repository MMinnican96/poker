import type { ActiveGameSummary } from '@poker/shared';

export interface ActiveGameCardProps {
  activeGame: ActiveGameSummary;
  onJoinTable: () => void;
}

export function ActiveGameCard({ activeGame, onJoinTable }: ActiveGameCardProps) {
  const { playingCount, spectatingCount, members, buyIn, waitingForPlayers } = activeGame;
  return (
    <div className="mx-auto max-w-[740px] p-4">
      {/* Status pills */}
      <div className="mb-3 flex items-center justify-center gap-2 font-display text-[13px] font-semibold">
        <span className="rounded-pill border-2 border-mint-border bg-mint/20 px-3 py-1 text-mint-bright">
          {playingCount} PLAYING
        </span>
        <span className="rounded-pill border-2 border-white/15 bg-white/10 px-3 py-1 text-cream/80">
          {spectatingCount} WATCHING
        </span>
      </div>

      {/* Card */}
      <div className="rounded-3xl border-[2.5px] border-black/30 bg-felt-800 p-7 shadow-panel">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-extrabold tracking-[0.22em] text-sage">THE TABLE</span>
            <span className="font-display text-2xl font-semibold text-white">Game in Progress</span>
          </div>
          <span className="rounded-pill border-2 border-red-border bg-red/15 px-3 py-1 font-display text-[13px] font-bold text-red">
            LIVE
          </span>
        </div>

        {waitingForPlayers && (
          <p className="mb-3 text-sm font-bold text-sage-muted">
            Waiting for players to start the next hand…
          </p>
        )}

        {/* Member list */}
        <ul className="mb-5 flex flex-col gap-1.5">
          {members.map((m) => (
            <li
              key={m.discordUserId}
              className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2"
            >
              <span className="font-body text-cream">{m.displayName}</span>
              {m.role === 'seated' ? (
                <span className="font-display text-gold">
                  {m.chipStack.toLocaleString()}
                </span>
              ) : (
                <span className="text-sage">Spectating</span>
              )}
            </li>
          ))}
        </ul>

        {/* Join button */}
        <button
          onClick={onJoinTable}
          className="w-full rounded-2xl border-[2.5px] border-gold-border bg-gold px-5 py-4 font-display text-base font-semibold text-[#2a1c00] shadow-hard-gold"
        >
          ♠ Join Table — Buy In {buyIn.toLocaleString()}
        </button>
      </div>
    </div>
  );
}
