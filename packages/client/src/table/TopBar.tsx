import { useEffect, useRef, useState } from 'react';
import { formatChips, type TableView } from '@poker/shared';
import { useProfileCard } from '../app/nav';
import { useCommands, useMe } from '../app/client';
import { Avatar, Button, ChatIcon, CountBadge, DoorIcon, EyeIcon, IconButton, countLabel, cx } from '../ui';
import { useDismiss, useRun } from './hooks';
import { MenuIcon, SoundOffIcon, SoundOnIcon } from './icons';
import { useSoundSettings } from './sound/soundStore';

function Spectators({ view }: { view: TableView }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const profile = useProfileCard();
  useDismiss(open, panel, () => setOpen(false), button);
  const n = view.spectators.length;
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${n} watching`}
        className={cx(
          'tabular flex h-8 items-center gap-1.5 rounded-lg px-2 text-[14px] font-semibold transition-colors',
          open ? 'bg-stock/12 text-stock' : 'text-stock-dim hover:bg-stock/8 hover:text-stock',
        )}
      >
        <EyeIcon size={18} />
        <span aria-hidden="true">{n}</span>
      </button>
      {open && (
        <div
          ref={panel}
          className="absolute top-full right-0 z-40 mt-1.5 w-60 rounded-xl bg-walnut-800 p-2 shadow-lift ring-1 ring-walnut-600 tex-wood motion-safe:animate-rise"
        >
          <p className="px-1.5 pb-1 text-[13px] font-semibold text-muted">{n === 0 ? 'Nobody is watching' : n === 1 ? '1 watching' : `${n} watching`}</p>
          {n > 0 && (
            <ul className={cx(n > 6 && "max-h-64 overflow-y-auto")}>
              {view.spectators.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      profile.open(p.id);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-stock/8"
                  >
                    <Avatar src={p.avatarUrl} name={p.name} frameId={p.cosmetics.frame} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-stock">{p.name}</span>
                    {p.id === view.you.id && <span className="text-[12px] text-muted">You</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Leave the table. Watchers leave straight away; a seated player confirms
 * first, since it cashes out their stack.
 */
function LeaveButton({ view, leaving, busy, onLeave }: { view: TableView; leaving: boolean; busy: boolean; onLeave(): void }) {
  const [asking, setAsking] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useDismiss(asking, panel, () => setAsking(false), button);
  const me = view.seats.find((s) => s.player?.id === view.you.id)?.player ?? null;
  const seated = view.you.role === 'seated' && !!me;
  const inHand = !!me?.inHand && !!view.hand && !view.hand.result;
  useEffect(() => {
    if (asking) panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [asking]);
  return (
    <div className="relative">
      <IconButton
        ref={button}
        label="Leave table"
        title={leaving ? "You'll leave after this hand" : 'Leave table'}
        size="sm"
        disabled={leaving || busy}
        aria-expanded={seated ? asking : undefined}
        onClick={() => (seated ? setAsking((a) => !a) : onLeave())}
      >
        <DoorIcon size={19} />
      </IconButton>
      {asking && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Leave the table?"
          className="absolute top-full right-0 z-40 mt-1.5 w-64 rounded-xl bg-walnut-800 p-3 shadow-lift ring-1 ring-walnut-600 tex-wood motion-safe:animate-rise"
        >
          <p className="text-[14px] font-semibold text-stock">Leave the table?</p>
          <p className="mt-1 text-[13px] text-stock-dim">
            {inHand ? 'You play out this hand, then your' : 'Your'} {formatChips(me?.stack ?? 0)} chips go back to your bankroll.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Stay</Button>
            <Button
              size="sm"
              variant="danger"
              className="flex-1"
              onClick={() => {
                setAsking(false);
                onLeave();
              }}
            >
              {inHand ? 'Leave after this hand' : 'Leave table'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface TopBarProps {
  view: TableView;
  unseenChat: number;
  onOpenChat(): void;
  onOpenMenu(): void;
}

/** Table name and stakes on the left; watchers, chat, sound and the menu on the right. */
export function TopBar({ view, unseenChat, onOpenChat, onOpenMenu }: TopBarProps) {
  const { rules, hand } = view;
  const sound = useSoundSettings();
  const commands = useCommands();
  const [run, busy] = useRun();
  const leaving = view.you.pending === 'leave';
  const handNo = hand?.handNumber ?? (view.handsDealt > 0 ? view.handsDealt : null);
  // Unread DMs and challenges to claim live behind the menu while you're at the table.
  const me = useMe();
  const waiting = me.unreadMessages + me.unclaimedChallenges;
  const waitingText = [
    me.unreadMessages > 0 && countLabel(me.unreadMessages, ['unread message', 'unread messages']),
    me.unclaimedChallenges > 0 && countLabel(me.unclaimedChallenges, ['challenge to claim', 'challenges to claim']),
  ].filter(Boolean).join(', ');
  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-walnut-950 bg-walnut-900 px-2 sm:px-3 short:h-10">
      <div className="flex min-w-0 flex-1 items-baseline gap-x-3 overflow-hidden">
        <h1 className="truncate text-[17px] text-stock short:text-[15px]">{rules.name}</h1>
        <p className="tabular flex shrink-0 items-baseline gap-2.5 font-condensed text-[14px] font-semibold text-stock-dim">
          <span title="Small blind / big blind">
            <span className="sr-only">Blinds </span>
            <span className="text-brass-light">{formatChips(rules.smallBlind)}/{formatChips(rules.bigBlind)}</span>
          </span>
          {rules.ante > 0 && <span className="hidden xs:inline">Ante {formatChips(rules.ante)}</span>}
          {handNo !== null && <span className="hidden sm:inline">Hand {handNo}</span>}
        </p>
      </div>
      <Spectators view={view} />
      <span className="relative">
        <IconButton label="Room chat" size="sm" onClick={onOpenChat}>
          <ChatIcon size={19} />
        </IconButton>
        <CountBadge count={unseenChat} label={['new chat message', 'new chat messages']} className="pointer-events-none absolute -top-1 -right-1" />
      </span>
      <IconButton
        label="Mute sounds"
        size="sm"
        pressed={sound.muted}
        onClick={() => sound.setMuted(!sound.muted)}
        className={sound.muted ? 'ring-1 ring-inset ring-chip-light/70' : undefined}
      >
        {sound.muted ? <SoundOffIcon size={19} /> : <SoundOnIcon size={19} />}
      </IconButton>
      <LeaveButton view={view} leaving={leaving} busy={busy === 'leave'} onLeave={() => void run('leave', commands.leaveTable)} />
      <span className="relative">
        <IconButton label="Table menu" size="sm" variant="ghost" onClick={onOpenMenu}>
          <MenuIcon size={19} />
        </IconButton>
        <CountBadge count={waiting} label={() => waitingText} className="pointer-events-none absolute -top-1 -right-1" />
      </span>
    </header>
  );
}
