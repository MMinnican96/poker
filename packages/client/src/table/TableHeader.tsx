import type { DiscordIdentity, TableConfig } from '@poker/shared';

interface Spectator { discordUserId: string; displayName: string; avatarUrl: string }

interface Props {
  identity: DiscordIdentity;
  handNumber: number;
  config: TableConfig;
  spectators: Spectator[];
  heroStack: number | null;
  onOpenUser: () => void;
}

export function TableHeader({ identity, handNumber, config, spectators, heroStack, onOpenUser }: Props) {
  return (
    <header className="z-20 flex flex-none items-center gap-4 px-[22px] py-2.5">
      <div className="flex flex-none items-center gap-2.5">
        <div className="flex h-[42px] w-[42px] -rotate-[4deg] items-center justify-center rounded-[13px] border-[2.5px] border-gold-border bg-gold text-[23px] text-[#2a1c00] shadow-hard-gold">♠</div>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base font-semibold text-white">Ratbag Table</span>
          <span className="text-[11px] font-extrabold tracking-[0.06em] text-sage">
            NL HOLD'EM · {config.smallBlind} / {config.bigBlind}
          </span>
        </div>
      </div>

      <div className="mx-auto inline-flex items-center gap-2 rounded-pill border-2 border-black/30 bg-black/25 px-3.5 py-1.5">
        <span className="h-[9px] w-[9px] rounded-pill bg-mint" />
        <span className="font-display text-sm font-semibold text-[#cfeadd]">Hand #{handNumber.toLocaleString()}</span>
      </div>

      <div className="group relative flex-none">
        <div className="flex items-center gap-1.5 rounded-pill border-2 border-black/30 bg-black/25 px-3 py-1.5">
          <span className="text-base text-sage-light">👁</span>
          <span className="font-display text-sm font-bold text-[#cfeadd]">{spectators.length}</span>
        </div>
        <div className="invisible absolute right-0 top-[calc(100%+8px)] z-[45] w-[212px] rounded-2xl border-[2.5px] border-black/40 bg-felt-500 p-3 opacity-0 shadow-panel transition group-hover:visible group-hover:opacity-100">
          <div className="mb-2.5 text-[11px] font-extrabold tracking-[0.1em] text-sage">SPECTATING · {spectators.length}</div>
          <div className="flex flex-col gap-2.5">
            {spectators.length === 0 && <span className="text-[13px] font-bold text-sage-muted">No spectators</span>}
            {spectators.map((s) => (
              <div key={s.discordUserId} className="flex items-center gap-2.5">
                <img src={s.avatarUrl} alt="" className="h-[30px] w-[30px] flex-none rounded-[9px] border-2 border-ink object-cover" />
                <span className="font-display text-sm font-semibold text-white">{s.displayName}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={onOpenUser}
        className="flex flex-none items-center gap-2.5 rounded-2xl border-[2.5px] border-black/30 bg-white/5 py-1.5 pl-1.5 pr-3.5 shadow-hard-ink hover:-translate-y-px"
      >
        <img src={identity.avatarUrl} alt="" className="h-[38px] w-[38px] rounded-[11px] border-[2.5px] border-gold-border object-cover" />
        <span className="flex flex-col items-start leading-tight">
          <span className="font-display text-sm font-semibold text-white">{identity.displayName}</span>
          {heroStack != null && <span className="text-xs font-extrabold text-gold-soft">● {heroStack.toLocaleString()}</span>}
        </span>
        <span className="ml-0.5 text-[11px] text-sage">▼</span>
      </button>
    </header>
  );
}
