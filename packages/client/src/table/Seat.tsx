import type { GamePlayer } from '@poker/shared';
import { PlayingCard } from './Card';
import type { SeatPos } from './SeatLayout';
import { actionPill, ROLE_CLASS, TONE_CLASS } from './seatVisuals';

interface Props {
  player: GamePlayer;
  pos: SeatPos;
  role: 'D' | 'SB' | 'BB' | null;
  isActive: boolean;
  timerPct: number | null;
  reveal: boolean;
  onOpen: () => void;
}

export function Seat({ player, pos, role, isActive, timerPct, reveal, onOpen }: Props) {
  const folded = player.status === 'folded';
  const pill = actionPill(player);
  const showCards = !folded;
  const revealed = reveal && !folded && player.holeCards != null;
  const ringColor = (timerPct ?? 100) > 33 ? '#44e0a3' : '#ff6b6b';

  return (
    <>
      <div
        className="absolute z-[4] flex w-[106px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
        style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%`, opacity: folded ? 0.45 : 1 }}
      >
        {showCards && (
          <div className="z-[1] mb-[-6px] flex h-12 justify-center">
            {revealed ? (
              <>
                <div className="animate-reveal"><PlayingCard card={player.holeCards![0]} size="sm" rotate={-9} reveal /></div>
                <div className="-ml-2 animate-reveal"><PlayingCard card={player.holeCards![1]} size="sm" rotate={9} reveal /></div>
              </>
            ) : (
              <>
                <PlayingCard card={null} size="sm" rotate={-9} />
                <div className="-ml-2"><PlayingCard card={null} size="sm" rotate={9} /></div>
              </>
            )}
          </div>
        )}

        <button
          onClick={onOpen}
          aria-label={`Open ${player.displayName} profile`}
          className="relative h-[52px] w-[52px] rounded-[15px] border-[3px] border-ink shadow-hard-ink hover:brightness-110"
          style={isActive && timerPct != null
            ? { background: `conic-gradient(${ringColor} ${timerPct}%, rgba(0,0,0,.4) 0)`, padding: 3 }
            : undefined}
        >
          <img src={player.avatarUrl} alt="" className="h-full w-full rounded-[12px] object-cover" />
          {role && (
            <span className={`absolute -bottom-1.5 -right-1.5 flex h-[23px] w-[23px] items-center justify-center rounded-full border-[2.5px] border-ink font-display text-[10px] font-bold text-[#0b2c1f] ${ROLE_CLASS[role]}`}>
              {role}
            </span>
          )}
        </button>

        <div className="flex flex-col items-center rounded-xl border-2 border-black/35 bg-felt-900/70 px-2.5 py-1 leading-tight shadow-hard-ink-sm">
          <span className="max-w-[104px] truncate font-display text-[13px] font-semibold text-white">{player.displayName}</span>
          <span className="text-xs font-extrabold text-gold-soft"><span aria-hidden>● </span>{player.chipStack.toLocaleString()}</span>
        </div>

        {pill && (
          <span className={`rounded-pill border-2 px-2.5 py-0.5 text-[11px] font-extrabold ${TONE_CLASS[pill.tone]}`}>{pill.text}</span>
        )}
      </div>

      {player.betThisRound > 0 && (
        <div
          className="absolute z-[5] inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-pill border-2 border-ink bg-felt-900/80 py-0.5 pl-1 pr-2.5 font-display text-[13px] font-bold text-gold-soft shadow-hard-ink-sm"
          style={{ left: `${pos.betLeftPct}%`, top: `${pos.betTopPct}%` }}
        >
          <span className="h-[11px] w-[11px] rounded-full border-2 border-gold-border bg-gold" />
          {player.betThisRound.toLocaleString()}
        </div>
      )}
    </>
  );
}
