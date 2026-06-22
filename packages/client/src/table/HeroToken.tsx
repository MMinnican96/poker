import type { GamePlayer } from '@poker/shared';
import { actionPill, ROLE_CLASS, TONE_CLASS } from './seatVisuals';

interface Props {
  player: GamePlayer | null;
  role: 'D' | 'SB' | 'BB' | null;
  isActive: boolean;
  timerPct: number | null;
  isSpectating: boolean;
  isWinner?: boolean;
}

/**
 * The viewer's own marker at the bottom-centre of the felt. Mirrors an opponent
 * Seat (avatar + countdown ring + role badge + action pill) but without the
 * name/stack panel or hole-card fan, which live in the HUD below. When the
 * viewer is spectating it shows the watch indicator instead.
 */
export function HeroToken({ player, role, isActive, timerPct, isSpectating, isWinner }: Props) {
  if (isSpectating || !player) {
    return (
      <div className="absolute left-1/2 top-[90%] z-[6] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
        <div className="flex h-[54px] w-[54px] items-center justify-center rounded-[15px] border-[3px] border-ink bg-felt-300 text-[25px] text-sage-light shadow-hard-ink">👁</div>
        <span className="rounded-pill border-2 border-blue/40 bg-blue/15 px-2.5 py-0.5 text-[10px] font-extrabold tracking-[0.08em] text-blue">SPECTATING</span>
      </div>
    );
  }

  const pill = actionPill(player);
  const ringColor = (timerPct ?? 100) > 33 ? '#44e0a3' : '#ff6b6b';
  const ringStyle =
    isActive && timerPct != null
      ? { background: `conic-gradient(${ringColor} ${timerPct}%, rgba(0,0,0,.4) 0)`, padding: 3 }
      : undefined;

  return (
    <div
      data-seat-id={player?.discordUserId}
      data-winner={isWinner ? 'true' : undefined}
      className={`absolute left-1/2 top-[90%] z-[6] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 ${isWinner ? 'rounded-2xl ring-4 ring-gold animate-pulse' : ''}`}
    >
      <div data-testid="hero-avatar" data-ring={ringStyle ? 'true' : 'false'} className="relative h-[54px] w-[54px] rounded-[15px] border-[3px] border-ink shadow-hard-ink" style={ringStyle}>
        <img src={player.avatarUrl} alt="" className="h-full w-full rounded-[12px] object-cover" />
        {role && (
          <span className={`absolute -bottom-1.5 -right-1.5 flex h-[23px] w-[23px] items-center justify-center rounded-full border-[2.5px] border-ink font-display text-[10px] font-bold text-[#0b2c1f] ${ROLE_CLASS[role]}`}>
            {role}
          </span>
        )}
      </div>
      <span className="rounded-pill border-2 border-gold/40 bg-gold/15 px-2.5 py-0.5 text-[10px] font-extrabold tracking-[0.08em] text-gold-soft">YOU</span>
      {pill && (
        <span className={`rounded-pill border-2 px-2.5 py-0.5 text-[11px] font-extrabold ${TONE_CLASS[pill.tone]}`}>{pill.text}</span>
      )}
    </div>
  );
}
