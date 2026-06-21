import { useEffect, useState } from 'react';
import type { GameState, PlayerAction } from '@poker/shared';

const BETTING_PHASES: GameState['phase'][] = ['pre-flop', 'flop', 'turn', 'river'];

interface Props {
  state: GameState;
  myId: string;
  onAction: (action: PlayerAction) => void;
}

export function TableActionBar({ state, myId, onAction }: Props) {
  const me = state.players.find((p) => p.discordUserId === myId);
  const isMyTurn =
    BETTING_PHASES.includes(state.phase) &&
    me?.status === 'active' &&
    state.players[state.currentPlayerIndex]?.discordUserId === myId;

  const toCall = me ? state.callAmount - me.betThisRound : 0;
  const maxTotal = me ? me.betThisRound + me.chipStack : 0;
  const minRaiseTotal = Math.min(state.callAmount + state.minRaise, maxTotal);
  const canRaise = !!me && maxTotal > state.callAmount && me.chipStack > toCall;
  const potTotal = state.pots.reduce((s, p) => s + p.amount, 0);
  const step = state.config.smallBlind;

  const clamp = (v: number) => Math.max(minRaiseTotal, Math.min(maxTotal, Math.round(v / step) * step));
  const [raiseTo, setRaiseTo] = useState(minRaiseTotal);

  useEffect(() => {
    setRaiseTo(minRaiseTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, state.callAmount, state.handNumber]);

  if (!me || !isMyTurn) return null;

  const allIn = raiseTo >= maxTotal;
  const preset = (factor: number) => setRaiseTo(clamp((potTotal + toCall) * factor));

  const quick = 'rounded-xl border-[2.5px] border-ink bg-felt-300 px-3 py-2.5 font-display text-[13px] font-semibold text-[#dfeee6] shadow-hard-ink-sm active:translate-y-0.5';
  const bigBtn = 'rounded-[15px] border-[2.5px] px-6 py-3 font-display text-base font-semibold active:translate-y-1';

  return (
    <div className="flex-none px-[18px] pb-3.5">
      <div className="rounded-[18px] border-[2.5px] border-black/35 bg-felt-900/70 px-[18px] py-3 shadow-panel">
        <div className="flex items-center gap-3.5">
          <div className="flex flex-none gap-1.5">
            <button className={quick} onClick={() => preset(0.5)}>½ Pot</button>
            <button className={quick} onClick={() => preset(1)}>Pot</button>
            <button className={quick} onClick={() => preset(2)}>2× Pot</button>
          </div>
          {canRaise && (
            <div className="flex min-w-[90px] flex-1 items-center gap-2.5">
              <input
                type="range"
                min={minRaiseTotal}
                max={maxTotal}
                step={step}
                value={raiseTo}
                onChange={(e) => setRaiseTo(clamp(Number(e.target.value)))}
                className="min-w-[60px] flex-1"
              />
              <span className="min-w-[78px] flex-none text-right font-display text-lg font-bold text-gold">
                {allIn ? 'ALL-IN' : raiseTo.toLocaleString()}
              </span>
            </div>
          )}
          <div className="flex flex-none gap-2.5">
            <button
              className={`${bigBtn} border-red-border bg-red text-white shadow-hard-red`}
              onClick={() => onAction({ type: 'fold' })}
            >
              Fold
            </button>
            <button
              className={`${bigBtn} border-mint-border bg-mint text-felt-900 shadow-pill`}
              onClick={() => onAction(toCall === 0 ? { type: 'check' } : { type: 'call' })}
            >
              {toCall === 0 ? 'Check' : `Call ${Math.min(toCall, me.chipStack).toLocaleString()}`}
            </button>
            {canRaise && (
              <button
                className={`${bigBtn} border-gold-border bg-gold text-[#2a1c00] shadow-hard-gold`}
                onClick={() => onAction({ type: 'raise', amount: raiseTo })}
              >
                {allIn ? 'All-In' : `Raise ${raiseTo.toLocaleString()}`}
              </button>
            )}
            <button
              className={`${bigBtn} border-[#6d3fd6] bg-purple text-white`}
              onClick={() => onAction({ type: 'all-in' })}
            >
              All-In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
