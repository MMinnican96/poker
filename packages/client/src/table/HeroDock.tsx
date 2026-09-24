import type { ReactNode } from 'react';
import { describeBestHand, type SeatPlayer, type TableView } from '@poker/shared';
import { useCommands } from '../app/client';
import { Button, ChipAmount, EyeIcon, IconButton, SeatIcon, cx } from '../ui';
import { ActionBar } from './ActionBar';
import { EmotePicker } from './EmotePicker';
import { useRun } from './hooks';
import { EyeOffIcon } from './icons';
import { PreActions, usePreAction } from './PreActions';
import { PendingNote } from './TableMenu';

/** Answers to a show/hide that arrived after the hand ended: nothing to tell the player. */
const SHOW_TOO_LATE = new Set(['That hand has already moved on.', 'No hand is in play.']);

export interface HeroDockProps {
  view: TableView;
  /** Stack controls full width (portrait phones). */
  narrow: boolean;
  onTakeSeat(): void;
  /** Why you can't sit, if you can't. */
  sitBlockedReason: string | null;
}

/** Your hand's name so far, e.g. "Pair of kings". */
export function heroHandLabel(me: SeatPlayer | null, board: TableView['hand']): string | null {
  if (!me?.holeCards || !board) return null;
  return describeBestHand([...me.holeCards, ...board.board])?.label ?? null;
}

/** The strip under the table: your hand's strength, your actions or what you're waiting for. */
export function HeroDock({ view, narrow, onTakeSeat, sitBlockedReason }: HeroDockProps) {
  const commands = useCommands();
  const [run, busy] = useRun();
  const { you, hand } = view;
  const me = you.role === 'seated' ? view.seats.find((s) => s.player?.id === you.id)?.player ?? null : null;
  const pre = usePreAction(view, (a) => run('act', () => commands.act(a)));
  const yourTurn = !!you.legal && !!hand && !hand.result;
  const label = heroHandLabel(me, hand);
  const shownLabel = me && hand?.result?.shown[me.id]?.label;
  const cancel = () => void run('cancel', commands.cancelPending);
  // Showing your cards: open to anyone dealt in, except cards already tabled at showdown.
  const canShow = !!me && !!hand && me.inHand && !!me.holeCards && !hand.result?.shown[me.id];
  const showing = you.showCards;
  const toggleShow = () => void run('show', async () => {
    const ack = await commands.showCards(!showing, hand?.handNumber);
    // A late tap as the result clears isn't worth an error toast.
    return !ack.ok && SHOW_TOO_LATE.has(ack.error) ? { ok: true } : ack;
  });
  // In an all-in run-out your live hand is tabled at showdown anyway.
  const runout = !!hand && !hand.result && !!me && !me.folded
    && view.seats.some((s) => s.player && s.player.id !== me.id && s.player.inHand && !s.player.folded && !!s.player.holeCards);
  // Mid-hand it's a pre-selection; on phones your turn's action bar comes first.
  const showPreselect = canShow && !hand!.result && !runout && !(narrow && yourTurn);
  const preselectIcon = showing ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />;

  let main: ReactNode;
  if (!me) {
    main = (
      <div className={cx('flex items-center gap-3', narrow && 'w-full justify-between')}>
        <p className="text-[14px] text-stock-dim">
          You're watching. <span className="whitespace-nowrap">Bankroll <ChipAmount value={you.bankroll} size="sm" /></span>
        </p>
        <Button variant="brass" icon={<SeatIcon size={18} />} onClick={onTakeSeat} disabled={!!sitBlockedReason} title={sitBlockedReason ?? undefined}>
          Take a seat
        </Button>
      </div>
    );
  } else if (yourTurn && you.legal) {
    main = (
      <ActionBar
        legal={you.legal}
        potTotal={hand!.potTotal}
        currentBet={hand!.currentBet}
        committed={me.committed}
        step={view.rules.smallBlind}
        onAct={(a) => run('act', () => commands.act(a))}
        wide={narrow}
      />
    );
  } else if (hand && !hand.result && me.inHand && !me.folded && !me.allIn) {
    main = <PreActions armed={pre.armed} toggle={pre.toggle} facingBet={hand.currentBet > me.committed} wide={narrow} />;
  } else {
    let text: string;
    let action: ReactNode = null;
    const showButton = canShow && hand?.result ? (
      <Button
        variant="ghost"
        size="sm"
        icon={showing ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        onClick={toggleShow}
        loading={busy === 'show'}
      >
        {showing ? 'Hide cards' : 'Show cards'}
      </Button>
    ) : null;
    if (me.sittingOut) {
      text = "You're sitting out.";
      action = (
        <Button variant="brass" onClick={() => void run('back', () => commands.sitOut(false))} loading={busy === 'back'}>
          I'm back
        </Button>
      );
    } else if (hand?.result && canShow && showing) text = 'Your cards are face up.';
    else if (hand?.result) text = hand.result.payouts[me.id] ? 'Nice hand.' : 'Next hand coming up.';
    else if (hand && me.inHand && me.folded) text = 'You folded. Next hand soon.';
    else if (hand && me.allIn) text = "You're all in.";
    else if (hand && !me.inHand) text = "You're dealt in next hand.";
    else if (view.status === 'open') text = view.hostId === you.id ? 'Start the game when everyone is seated.' : 'Waiting for the host to start.';
    else text = 'Waiting for the next hand.';
    main = (
      <div className={cx('flex items-center gap-3', narrow && 'w-full justify-between')}>
        <p className="text-[14px] text-stock-dim" role="status">{text}</p>
        {(action || showButton) && (
          <div className="flex shrink-0 items-center gap-2">
            {showButton}
            {action}
          </div>
        )}
      </div>
    );
  }

  const pending = you.pending !== null || you.pendingTopUp > 0;

  return (
    <footer
      aria-label="Your controls"
      className={cx(
        'relative z-20 flex shrink-0 gap-x-3 gap-y-2 border-t border-walnut-950 bg-walnut-800/95 px-3 py-2 tex-wood pb-[max(env(safe-area-inset-bottom),0.5rem)] short:py-1.5',
        narrow ? 'flex-col items-stretch' : 'items-center',
        yourTurn && 'tbl-yourturn shadow-[inset_0_2px_0_var(--color-brass)]',
      )}
    >
      <div className={cx('flex min-w-0 items-center gap-2', !narrow && 'mr-auto')}>
        <EmotePicker emotes={you.emotes} />
        {me && (label || shownLabel) && (
          <p className="min-w-0 leading-tight" aria-live="polite">
            <span className="block text-[11px] font-semibold text-muted">{yourTurn ? 'Your turn' : 'Your hand'}</span>
            <span className="block truncate font-display text-[15px] text-brass-light">{shownLabel ?? label}</span>
          </p>
        )}
        {me && !label && !shownLabel && yourTurn && <p className="font-display text-[15px] text-brass-light">Your turn</p>}
        {showPreselect && (narrow ? (
          <IconButton label="Show cards at the end" pressed={showing} size="sm" variant="ghost" onClick={toggleShow} disabled={busy === 'show'}>
            {preselectIcon}
          </IconButton>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon={preselectIcon}
            aria-pressed={showing}
            title="Show your cards to the table when the hand ends"
            onClick={toggleShow}
            loading={busy === 'show'}
            className={cx('shrink-0', showing && 'bg-brass/15! text-brass-light! ring-brass!')}
          >
            Show cards at the end
          </Button>
        ))}
        {pending && (
          <div className="ml-auto flex min-w-0 flex-wrap gap-1.5">
            <PendingNote you={you} onCancel={cancel} busy={busy === 'cancel'} />
          </div>
        )}
      </div>
      <div className={cx('flex items-center', narrow ? 'w-full' : 'justify-end')}>{main}</div>
    </footer>
  );
}
