import type { DiscordIdentity } from '@poker/shared';

export type LobbyTab = 'home' | 'leaderboard' | 'stats' | 'shop';

const TABS: { id: LobbyTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'stats', label: 'Stats' },
  { id: 'shop', label: 'Shop' },
];

export interface HeaderProps {
  activeTab: LobbyTab;
  onTabChange: (tab: LobbyTab) => void;
  identity: DiscordIdentity;
  onOpenUser: () => void;
}

export function Header({ activeTab, onTabChange, identity, onOpenUser }: HeaderProps) {
  return (
    <header className="flex flex-none items-center gap-5 px-6 py-4">
      <div className="flex flex-none items-center gap-3">
        <div className="flex h-12 w-12 -rotate-3 items-center justify-center rounded-2xl border-[2.5px] border-gold-border bg-gold text-2xl text-[#2a1c00] shadow-hard-gold">
          ♠
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-display text-lg font-bold text-white">RATBAG</span>
          <span className="mt-[3px] text-[11px] font-extrabold tracking-[0.22em] text-sage">
            POKER NIGHT
          </span>
        </div>
      </div>

      <nav className="mx-auto flex gap-2">
        {TABS.map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={[
                'font-display text-base font-semibold rounded-2xl px-5 py-2.5 transition-transform hover:-translate-y-px border-[2.5px]',
                active
                  ? 'border-gold-border bg-gold text-[#2a1c00] shadow-hard-gold'
                  : 'border-transparent bg-white/5 text-sage-light',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <button
        onClick={onOpenUser}
        className="flex flex-none items-center gap-2.5 rounded-2xl border-[2.5px] border-black/30 bg-white/5 py-1.5 pl-1.5 pr-3.5 shadow-hard-ink transition-transform hover:-translate-y-px"
      >
        <img
          src={identity.avatarUrl}
          alt=""
          className="h-10 w-10 rounded-xl border-[2.5px] border-gold-border object-cover"
        />
        <span className="flex flex-col items-start leading-tight">
          <span className="font-display text-sm font-semibold text-white">
            {identity.displayName}
          </span>
          <span className="text-xs font-extrabold text-gold-soft">
            ● {identity.chipBalance.toLocaleString()}
          </span>
        </span>
        <span className="ml-0.5 text-xs text-sage">▼</span>
      </button>
    </header>
  );
}
