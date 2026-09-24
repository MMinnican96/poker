import { useEffect, useState, type ReactNode } from 'react';
import { formatChips, type TableView } from '@poker/shared';
import { useCommands, useMe } from '../app/client';
import { useNav, type Section } from '../app/nav';
import {
  Button,
  ChartIcon,
  ChatIcon,
  ChipAmount,
  CloseIcon,
  CountBadge,
  DoorIcon,
  Drawer,
  EyeIcon,
  IconButton,
  SeatIcon,
  ShopIcon,
  TargetIcon,
  TrophyIcon,
  cx,
  type IconProps,
} from '../ui';
import { useRun } from './hooks';
import { PauseIcon } from './icons';
import { QuickSoundControls, SoundSettingsDialog } from './sound/SoundSettingsDialog';
import { topUpBounds } from './TopUpDialog';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-walnut-700/70 px-4 py-3 last:border-0">
      <h3 className="mb-2 font-ui text-[13px] font-semibold text-muted">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/**
 * What you've queued for the end of the hand, in words: "Leaving after this
 * hand", "+1,000 top-up queued". Empty when nothing is queued.
 */
export function queuedChanges(you: Pick<TableView['you'], 'pending' | 'pendingTopUp'>): string[] {
  const out: string[] = [];
  if (you.pending === 'leave') out.push('Leaving after this hand');
  else if (you.pending === 'stand') out.push('Standing up after this hand');
  if (you.pendingTopUp > 0) out.push(`+${formatChips(you.pendingTopUp)} top-up queued`);
  return out;
}

/**
 * Everything you've queued, with one undo. The server's cancel clears all of
 * it at once, so there is one button, and its name says so.
 */
export function PendingNote({ you, onCancel, busy }: { you: Pick<TableView['you'], 'pending' | 'pendingTopUp'>; onCancel(): void; busy?: boolean }) {
  const parts = queuedChanges(you);
  if (parts.length === 0) return null;
  const many = parts.length > 1;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-brass/10 px-3 py-1.5 text-[14px] text-brass-light ring-1 ring-brass/40" role="status">
      <span className="min-w-0 flex-1">{parts.join(' · ')}</span>
      <Button
        size="sm"
        variant="quiet"
        onClick={onCancel}
        loading={busy}
        aria-label={many ? `Cancel all queued changes: ${parts.join(', ').toLowerCase()}` : `Cancel: ${parts[0].toLowerCase()}`}
      >
        {many ? 'Cancel all' : 'Cancel'}
      </Button>
    </div>
  );
}

const GO: { id: Section; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { id: 'leaderboard', label: 'Leaderboard', Icon: TrophyIcon },
  { id: 'stats', label: 'Stats', Icon: ChartIcon },
  { id: 'challenges', label: 'Challenges', Icon: TargetIcon },
  { id: 'shop', label: 'Shop', Icon: ShopIcon },
  { id: 'messages', label: 'Messages', Icon: ChatIcon },
];

export interface TableMenuProps {
  open: boolean;
  onClose(): void;
  view: TableView;
  onTakeSeat(): void;
  onTopUp(): void;
  onEditRules(): void;
  /** Seated players who can be dealt in (for Start). */
  readyCount: number;
}

/** Everything that isn't a poker action: your seat, host controls, sound, and the rest of the app. */
export function TableMenu({ open, onClose, view, onTakeSeat, onTopUp, onEditRules, readyCount }: TableMenuProps) {
  const commands = useCommands();
  const nav = useNav();
  const [soundSettings, setSoundSettings] = useState(false);
  // The sound dialog belongs to this opening of the menu: closing the menu forgets it.
  useEffect(() => {
    if (!open) setSoundSettings(false);
  }, [open]);
  const [run, busy] = useRun();
  const [confirmClose, setConfirmClose] = useState(false);
  const self = useMe();
  const badges: Partial<Record<Section, { count: number; label: readonly [string, string] }>> = {
    messages: { count: self.unreadMessages, label: ['unread message', 'unread messages'] },
    challenges: { count: self.unclaimedChallenges, label: ['challenge to claim', 'challenges to claim'] },
  };
  const { you, rules } = view;
  const seated = you.role === 'seated';
  const me = seated ? view.seats.find((s) => s.player?.id === you.id)?.player ?? null : null;
  const isHost = view.hostId === you.id;
  const inHand = !!me?.inHand && !!view.hand && !view.hand.result;
  const top = me ? topUpBounds(rules, me.stack, you.pendingTopUp, you.bankroll) : null;

  return (
    <Drawer open={open} onClose={onClose} label="Table menu">
      <div className="flex items-center justify-between border-b border-walnut-700 px-4 py-2">
        <h2 className="text-lg">Table menu</h2>
        <IconButton label="Close" size="sm" onClick={onClose}>
          <CloseIcon size={18} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={seated ? `You're in seat ${(you.seat ?? 0) + 1}` : "You're watching"}>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-stock-dim">
            {me && (
              <span className="inline-flex items-center gap-1">Stack <ChipAmount value={me.stack} size="sm" /></span>
            )}
            <span className="inline-flex items-center gap-1">Bankroll <ChipAmount value={you.bankroll} size="sm" /></span>
          </p>
          <PendingNote you={you} onCancel={() => void run('cancel', commands.cancelPending)} busy={busy === 'cancel'} />
          {seated ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<PauseIcon size={16} />}
                loading={busy === 'sitout'}
                onClick={() => void run('sitout', () => commands.sitOut(!you.sittingOut))}
              >
                {you.sittingOut ? "I'm back" : 'Sit out'}
              </Button>
              <Button variant="ghost" size="sm" disabled={!top?.canTopUp} onClick={onTopUp} title={top && !top.canTopUp ? 'You have the most chips allowed, or none to add.' : undefined}>
                Top up
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<EyeIcon size={16} />}
                disabled={you.pending === 'stand'}
                loading={busy === 'stand'}
                onClick={() => void run('stand', commands.standUp)}
              >
                Stand up to watch
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<DoorIcon size={16} />}
                disabled={you.pending === 'leave'}
                loading={busy === 'leave'}
                onClick={() => void run('leave', commands.leaveTable)}
              >
                Leave table
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="brass" size="sm" icon={<SeatIcon size={16} />} onClick={onTakeSeat} disabled={view.closing}>Take a seat</Button>
              <Button variant="danger" size="sm" icon={<DoorIcon size={16} />} loading={busy === 'leave'} onClick={() => void run('leave', commands.leaveTable)}>
                Leave table
              </Button>
            </div>
          )}
          {top && !top.canTopUp && (
            <p className="text-[12px] text-muted">{top.room <= 0 ? "You can't top up: you're at the table maximum." : "You can't top up: your bankroll is empty."}</p>
          )}
          {inHand && (you.pending === null) && (
            <p className="text-[12px] text-muted">Standing up or leaving waits for this hand to finish.</p>
          )}
        </Section>

        {isHost && (
          <Section title="You're the host">
            {view.status === 'open' && (
              <>
                <Button size="sm" disabled={readyCount < 2} loading={busy === 'start'} onClick={() => void run('start', commands.startTable)}>
                  {readyCount < 2 ? 'Start the game (needs two players)' : 'Start the game'}
                </Button>
                <Button size="sm" variant="ghost" onClick={onEditRules}>Edit rules</Button>
              </>
            )}
            {view.closing ? (
              <p className="text-[14px] text-brass-light" role="status">The table closes after this hand.</p>
            ) : confirmClose ? (
              <div className="flex flex-col gap-2 rounded-lg bg-chip-dark/25 p-3 ring-1 ring-chip/50">
                <p className="text-[14px] text-stock">
                  Close the table? {view.hand ? 'The current hand finishes first, then' : 'Everyone'} gets their chips back and returns to the lobby.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClose(false)}>Keep playing</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === 'close'}
                    onClick={async () => {
                      const ack = await run('close', commands.closeTable);
                      if (ack.ok) setConfirmClose(false);
                    }}
                  >
                    Close the table
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmClose(true)}>Close the table</Button>
            )}
          </Section>
        )}

        <Section title="Sound">
          <QuickSoundControls />
          <Button variant="ghost" size="sm" onClick={() => setSoundSettings(true)}>All sound settings</Button>
        </Section>

        <Section title="Elsewhere">
          <p className="text-[12px] text-muted">You keep your seat, but your turn timer keeps running.</p>
          <ul className="grid grid-cols-2 gap-1">
            {GO.map(({ id, label, Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    nav.go(id);
                  }}
                  className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[14px] font-semibold text-stock-dim hover:bg-stock/8 hover:text-stock')}
                >
                  <Icon size={18} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {badges[id] && <CountBadge count={badges[id].count} label={badges[id].label} className="ring-walnut-800" />}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <SoundSettingsDialog open={open && soundSettings} onClose={() => setSoundSettings(false)} />
    </Drawer>
  );
}
