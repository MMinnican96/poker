import type { Card, GamePlayer } from '@poker/shared';
import { PlayingCard } from './Card';
import { useHandName } from './useHandName';

interface Props {
  me: GamePlayer | null;
  community: Card[];
  bank: number;
  isSpectating: boolean;
  isMyTurn: boolean;
  turnSecondsLeft: number | null;
}

export function HeroHud({ me, community, bank, isSpectating, isMyTurn, turnSecondsLeft }: Props) {
  const folded = me?.status === 'folded';
  const handName = useHandName(folded ? null : me?.holeCards ?? null, community);

  return (
    <div className="flex flex-none justify-center px-[18px] pb-2">
      <div className="inline-flex items-stretch gap-4 rounded-[18px] border-[2.5px] border-black/35 bg-felt-900/85 px-4 py-3 shadow-panel">
        {!isSpectating && me && (
          <>
            <div className="flex items-center gap-2.5">
              <PlayingCard card={me.holeCards?.[0] ?? null} size="lg" reveal={!!me.holeCards} />
              <PlayingCard card={me.holeCards?.[1] ?? null} size="lg" reveal={!!me.holeCards} />
            </div>
            <div className="flex min-w-[150px] flex-col justify-center gap-0.5 border-r-2 border-black/20 pr-4">
              <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">YOUR HAND</span>
              {folded ? (
                <>
                  <span className="font-display text-[26px] font-semibold leading-tight text-[#ff8a8a]">Folded</span>
                  <span className="text-sm font-bold text-[#9b6a6a]">Sitting this one out</span>
                </>
              ) : (
                <>
                  <span className="font-display text-[26px] font-semibold leading-tight text-white">{handName?.title ?? '—'}</span>
                  <span className="text-sm font-bold text-sage-light">{handName && handName.sub !== handName.title ? handName.sub : ''}</span>
                </>
              )}
            </div>
            <Stat label="CHIPS · TABLE" value={me.chipStack.toLocaleString()} accent />
          </>
        )}

        {isSpectating && (
          <div className="flex min-w-[220px] items-center gap-3 border-r-2 border-black/20 pr-[18px]">
            <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[13px] border-[2.5px] border-ink bg-felt-300 text-[23px] text-sage-light">👁</span>
            <div className="flex flex-col gap-0.5 leading-tight">
              <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">SPECTATING</span>
              <span className="font-display text-[22px] font-semibold leading-tight text-white">Watching the table</span>
              <span className="text-[13px] font-bold text-sage-light">You won't be dealt in — hole cards stay hidden.</span>
            </div>
          </div>
        )}

        <Stat label="BANK" value={bank.toLocaleString()} />

        {isMyTurn && turnSecondsLeft != null && (
          <div className="flex flex-col items-center justify-center gap-0.5 rounded-[13px] border-2 border-gold/40 bg-gold/15 px-4 py-1.5">
            <span className="text-[10px] font-extrabold tracking-[0.12em] text-gold-soft">YOUR TURN</span>
            <span className="font-display text-[22px] font-bold leading-none text-gold-soft">{Math.ceil(turnSecondsLeft)}s</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 rounded-[13px] border-2 px-[15px] py-2 ${accent ? 'border-gold/35 bg-gold/10' : 'border-black/25 bg-white/5'}`}>
      <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg border-2 text-sm ${accent ? 'border-gold-border bg-gold text-[#2a1c00]' : 'border-ink bg-felt-300 text-sage-light'}`}>●</span>
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] font-extrabold tracking-[0.1em] text-sage-muted">{label}</span>
        <span className={`font-display text-[20px] font-bold ${accent ? 'text-gold-soft' : 'text-white'}`}>{value}</span>
      </div>
    </div>
  );
}
