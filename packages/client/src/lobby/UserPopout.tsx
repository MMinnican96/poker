import { useState } from 'react';
import type { DiscordIdentity, PlayerStatsSummary } from '@poker/shared';
import { StatTile } from './StatTile';

type UserTab = 'profile' | 'settings' | 'howto';

function pct(n: number | undefined): string | null {
  return n == null ? null : `${Math.round(n * 100)}%`;
}
function num(n: number | undefined): string | null {
  return n == null ? null : n.toLocaleString();
}

export interface UserPopoutProps {
  identity: DiscordIdentity;
  stats: PlayerStatsSummary | null;
  onClose: () => void;
}

export function UserPopout({ identity, stats, onClose }: UserPopoutProps) {
  const [tab, setTab] = useState<UserTab>('profile');

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
            style={{ width: 52, height: 52 }}
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
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="rounded-pill border-2 border-gold-border bg-gold px-3 py-1 text-xs font-extrabold text-[#2a1c00]">
                COMING SOON
              </span>
              <p className="text-sm font-bold text-sage-muted">Settings are on the way.</p>
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
