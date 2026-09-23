import { useState } from 'react';
import { formatChips } from '@poker/shared';
import { useApi, useMe, useStore } from '../app/client';
import { useProfileCard } from '../app/nav';
import { Avatar, Button, ChipAmount, CountBadge, GiftIcon, IconButton, LevelBadge, UsersIcon } from '../ui';

/** The round logo: the PNG's white corners are cropped away by the circle. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="relative inline-block shrink-0 overflow-hidden rounded-full bg-walnut-950 ring-1 ring-walnut-600" style={{ width: size, height: size }}>
      <img src="/brand/logo.png" alt="" className="absolute inset-0 h-full w-full scale-[1.2] object-cover" draggable={false} />
    </span>
  );
}

export interface HeaderProps {
  /** Show the room button (when the sidebar is collapsed). */
  showRoomButton: boolean;
  onOpenRoom(): void;
  /** Room chat messages you haven't seen. */
  unseenChat: number;
}

/** Brand, daily bonus, bankroll and you. */
export function Header({ showRoomButton, onOpenRoom, unseenChat }: HeaderProps) {
  const me = useMe();
  const api = useApi();
  const store = useStore();
  const profile = useProfileCard();
  const [claiming, setClaiming] = useState(false);

  const claimDaily = async () => {
    setClaiming(true);
    try {
      const r = await api.claimDaily();
      if (r.ok) store.notify({ tone: 'good', title: 'Daily bonus claimed', body: `+${formatChips(r.amount)} chips. Day ${r.streak} of your streak.` });
      else store.notify({ tone: 'bad', title: "Couldn't claim the daily bonus", body: r.error });
    } catch (err) {
      store.notify({ tone: 'bad', title: "Couldn't claim the daily bonus", body: err instanceof Error ? err.message : undefined });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center gap-2 border-b border-walnut-950 bg-walnut-800 tex-wood px-2 shadow-[0_1px_0_var(--color-walnut-700)] sm:gap-3 sm:px-3 short:h-12">
      <BrandMark size={36} />
      <span className="hidden font-display text-lg leading-none text-stock md:block">
        Ratbag Poker Night
      </span>
      <div className="flex-1" />

      {me.daily.available && (
        <Button variant="brass" size="sm" icon={<GiftIcon size={16} />} onClick={claimDaily} loading={claiming} aria-label="Claim daily bonus" title={`Claim ${formatChips(me.daily.nextAmount)} free chips`}>
          <span className="hidden xs:inline">Daily bonus</span>
        </Button>
      )}

      <div className="flex items-center rounded-lg bg-walnut-950/70 px-2.5 py-1 ring-1 ring-inset ring-black/40" title="Your bankroll">
        <span className="sr-only">Bankroll: </span>
        <ChipAmount value={me.balance} size="lg" className="text-[17px] sm:text-xl" short={false} />
      </div>

      <button
        type="button"
        onClick={() => profile.open(me.id)}
        className="flex items-center gap-2 rounded-full py-0.5 pr-1 pl-0.5 hover:bg-walnut-700/60 sm:pr-2"
        aria-label={`Your profile: ${me.name}, level ${me.level.level}`}
      >
        <Avatar src={me.avatarUrl} name={me.name} frameId={me.loadout.frame} size={36} />
        <span className="hidden max-w-32 truncate font-semibold text-stock lg:block">{me.name}</span>
        <LevelBadge level={me.level.level} progress={me.level} size={28} className="hidden xs:inline-grid" />
      </button>

      {showRoomButton && (
        <span className="relative">
          <IconButton label="Room: people, chat and activity" onClick={onOpenRoom} variant="ghost">
            <UsersIcon size={20} />
          </IconButton>
          <CountBadge count={unseenChat} label="new chat messages" className="absolute -top-1 -right-1" />
        </span>
      )}
    </header>
  );
}
