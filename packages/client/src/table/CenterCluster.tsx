import type { Card, GamePhase, Pot } from '@poker/shared';
import { PlayingCard } from './Card';

const PHASE_LABEL: Partial<Record<GamePhase, string>> = {
  'pre-flop': '♦ PRE-FLOP', flop: '♦ FLOP', turn: '♦ TURN', river: '♦ RIVER',
  showdown: '♠ SHOWDOWN', 'hand-complete': '♠ SHOWDOWN', waiting: '♣ WAITING',
};

interface Props {
  phase: GamePhase;
  community: Card[];
  pots: Pot[];
}

export function CenterCluster({ phase, community, pots }: Props) {
  const main = pots[0]?.amount ?? 0;
  const sidePots = pots.slice(1);

  return (
    <div className="absolute left-1/2 top-[47%] flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2.5">
      <div className="inline-flex items-center gap-2 rounded-pill border-[2.5px] border-gold-border bg-gold px-4 py-1.5 font-display text-[13px] font-semibold tracking-[0.18em] text-felt-900 shadow-hard-gold">
        {PHASE_LABEL[phase] ?? ''}
      </div>

      <div className="flex h-[112px] items-center gap-2.5">
        {Array.from({ length: 5 }).map((_, i) =>
          community[i] ? (
            <div key={i} className="animate-deal" style={{ animationDelay: `${i * 90}ms` }}>
              <PlayingCard card={community[i]} size="md" reveal />
            </div>
          ) : (
            <div key={i} className="h-[106px] w-[76px] rounded-xl border-[2.5px] border-dashed border-white/15" />
          ),
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <div className="inline-flex items-center gap-2.5 rounded-pill border-[2.5px] border-ink bg-felt-900/70 py-1.5 pl-2.5 pr-2.5 shadow-pill">
          <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">POT</span>
          <span className="font-display text-[22px] font-bold leading-none text-gold-soft">{main.toLocaleString()}</span>
        </div>
        {sidePots.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-pill border-2 border-blue/40 bg-felt-900/70 px-2.5 py-1.5 text-[11px] font-extrabold text-blue">
            <span aria-hidden>SIDE ● </span>{p.amount.toLocaleString()}
          </span>
        ))}
      </div>
    </div>
  );
}
