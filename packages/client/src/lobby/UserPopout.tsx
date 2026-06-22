import { useState } from 'react';
import type { DiscordIdentity, PlayerStatsSummary } from '@poker/shared';
import { StatTile } from './StatTile';
import { useSoundSettings } from '../table/sound/soundStore';

type UserTab = 'profile' | 'settings' | 'howto';

function pct(n: number | undefined): string | null {
  return n == null ? null : `${Math.round(n * 100)}%`;
}
function num(n: number | undefined): string | null {
  return n == null ? null : n.toLocaleString();
}

export interface SeatActions {
  mode: 'playing' | 'spectating';
  buyIn: number;
  canJoin: boolean;
  joinReason: string;
  pending: 'leave' | 'spectate' | null;
  leaveHint: string;
  onSpectate: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onCancelPending: () => void;
}

export interface UserPopoutProps {
  identity: DiscordIdentity;
  stats: PlayerStatsSummary | null;
  onClose: () => void;
  seat?: SeatActions;
}

export function UserPopout({ identity, stats, onClose, seat }: UserPopoutProps) {
  const [tab, setTab] = useState<UserTab>('profile');
  const sound = useSoundSettings();

  const tabBtn = (id: UserTab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={[
        'flex-1 rounded-t-xl px-1 py-2.5 font-display text-[13px] font-semibold',
        tab === id ? 'bg-felt-600 text-white border-b-[3px] border-gold' : 'text-sage-muted',
      ].join(' ')}
    >
      {label}
    </button>
  );

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 animate-fade bg-[rgba(4,18,12,0.35)]" />
      <div className="fixed right-6 top-[78px] z-[41] w-[330px] origin-top-right animate-pop overflow-hidden rounded-3xl border-[2.5px] border-black/40 bg-felt-500 shadow-popout">
        <div className="flex items-center gap-3 bg-gradient-to-b from-gold/15 to-transparent px-[18px] pb-4 pt-[18px]">
          <img
            src={identity.avatarUrl}
            alt=""
            className="h-13 w-13 flex-none rounded-2xl border-[2.5px] border-gold-border object-cover"
          />
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="font-display text-lg font-semibold text-white">{identity.displayName}</span>
            <span className="text-[13px] font-bold text-sage-muted">Poker night regular</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-pill border-2 border-gold-border bg-gold px-2.5 py-1 font-display text-sm font-bold text-[#2a1c00]">
            <span className="h-[7px] w-[7px] rounded-pill bg-[#2a1c00]" />
            {identity.chipBalance.toLocaleString()}
          </span>
        </div>

        <div className="flex gap-1.5 px-3.5 pt-1">
          {tabBtn('profile', 'Profile')}
          {tabBtn('settings', 'Settings')}
          {tabBtn('howto', 'How to Play')}
        </div>
        <div className="mx-3.5 h-0.5 bg-black/20" />

        <div className="px-[18px] pb-[18px] pt-4">
          {tab === 'profile' && (
            <div className="grid grid-cols-2 gap-2.5">
              <StatTile label="HANDS WON" value={num(stats?.handsWon)} />
              <StatTile label="WIN RATE" value={pct(stats?.winRate)} />
              <StatTile label="BIGGEST POT" value={num(stats?.biggestPotWon)} />
              <StatTile label="NET PROFIT" value={num(stats?.netProfit)} />
            </div>
          )}

          {tab === 'settings' && (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">SOUND VOLUME</span>
                  <span className="font-display text-sm font-bold text-gold-soft">{Math.round(sound.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={sound.volume}
                  aria-label="Sound volume"
                  onChange={(e) => sound.setVolume(Number(e.target.value))}
                  className="w-full accent-gold"
                />
              </div>
              <button
                onClick={() => sound.setMuted(!sound.muted)}
                aria-label={sound.muted ? 'Unmute sound' : 'Mute sound'}
                className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3.5 py-3 text-left font-display text-base font-semibold ${sound.muted ? 'border-red/40 bg-red/15 text-white' : 'border-black/30 bg-felt-600 text-white hover:bg-felt-700'}`}
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border-2 border-black/30 bg-black/15 text-[17px]">
                  {sound.muted ? '🔇' : '🔊'}
                </span>
                <span className="flex flex-col leading-tight">
                  <span>{sound.muted ? 'Sound muted' : 'Sound on'}</span>
                  <span className="text-xs font-bold text-sage-muted">Tap to {sound.muted ? 'unmute' : 'mute'} table sounds</span>
                </span>
              </button>
            </div>
          )}

          {tab === 'howto' && (
            <div className="flex flex-col gap-2.5">
              {[
                ['1', '#44e0a3', 'Everyone buys in for the same chip stack and grabs a seat.'],
                ['2', '#ffc63d', 'Blinds force the action — bet, call, raise or fold each round.'],
                ['3', '#5bb8ff', 'Best five-card hand at showdown scoops the pot.'],
              ].map(([n, color, text]) => (
                <div key={n} className="flex items-start gap-3">
                  <span
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-lg border-2 border-ink font-display text-[13px] font-bold text-[#0b2c1f]"
                    style={{ background: color }}
                  >
                    {n}
                  </span>
                  <p className="text-sm font-bold leading-snug text-[#dfeee6]">{text}</p>
                </div>
              ))}
            </div>
          )}

          {seat && (
            <div className="mt-3.5 flex flex-col gap-2.5 border-t-2 border-black/20 pt-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">YOUR SEAT</span>
                <span className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 font-display text-xs font-bold ${seat.mode === 'playing' ? 'bg-mint/15 text-mint-bright' : 'bg-blue/15 text-blue'}`}>
                  <span className={`h-2 w-2 rounded-pill ${seat.mode === 'playing' ? 'bg-mint' : 'bg-blue'}`} />
                  {seat.mode === 'playing' ? 'Playing' : 'Spectating'}
                </span>
              </div>

              {seat.mode === 'playing' && (
                <button
                  onClick={seat.onSpectate}
                  className="flex w-full items-center gap-3 rounded-2xl border-2 border-black/30 bg-felt-600 px-3.5 py-3 text-left font-display text-base font-semibold text-white hover:bg-felt-700"
                >
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border-2 border-blue/40 bg-blue/15 text-[17px] text-blue">👁</span>
                  <span className="flex flex-col leading-tight"><span>Spectate</span><span className="text-xs font-bold text-sage-muted">Sit out — stop being dealt in</span></span>
                </button>
              )}

              {seat.mode === 'spectating' && (
                <div className="relative">
                  <button
                    onClick={seat.onJoin}
                    disabled={!seat.canJoin}
                    className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3.5 py-3 text-left font-display text-base font-semibold ${seat.canJoin ? 'cursor-pointer border-gold-border bg-gold text-[#2a1c00] shadow-hard-gold' : 'cursor-not-allowed border-black/30 bg-felt-300 text-sage-muted opacity-75'}`}
                  >
                    <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border-2 border-black/30 bg-black/15 text-[17px]">♠</span>
                    <span className="flex flex-col leading-tight"><span>Join Table</span><span className="text-xs font-bold text-sage-muted">Buy in for {seat.buyIn.toLocaleString()} · next hand</span></span>
                  </button>
                  {!seat.canJoin && seat.joinReason && (
                    <p className="mt-2 rounded-xl border-2 border-ink bg-felt-800 px-3 py-2 text-[13px] font-bold text-[#ffd0d0]">{seat.joinReason}</p>
                  )}
                </div>
              )}

              {seat.pending && (
                <div className="flex items-center justify-between gap-2.5 rounded-xl border-2 border-gold/35 bg-gold/10 py-2.5 pl-3.5 pr-2.5">
                  <span className="text-[13px] font-bold text-gold-soft">
                    {seat.pending === 'leave' ? 'Leaving when this hand finishes' : 'Moving to spectate when this hand finishes'}
                  </span>
                  <button onClick={seat.onCancelPending} className="flex-none rounded-[10px] border-2 border-ink bg-felt-300 px-3 py-1.5 font-display text-xs font-semibold text-[#dfeee6]">Cancel</button>
                </div>
              )}

              <button
                onClick={seat.onLeave}
                className="flex w-full items-center gap-3 rounded-2xl border-2 border-red/35 bg-red/15 px-3.5 py-3 text-left font-display text-base font-semibold text-white hover:bg-red/20"
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border-2 border-red/40 bg-red/20 text-[17px] text-[#ff9b9b]">↩</span>
                <span className="flex flex-col leading-tight"><span>Leave Table</span><span className="text-xs font-bold text-[#cc9999]">{seat.leaveHint}</span></span>
              </button>
            </div>
          )}

          <button
            onClick={onClose}
            className="mt-3.5 w-full rounded-xl border-2 border-red/30 bg-red/10 py-2.5 font-display text-sm font-semibold text-[#ff9b9b] hover:bg-red/20"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
