import type { CSSProperties } from 'react';
import { formatChips, formatChipsShort, type Card, type SeatPlayer, type ShownHand } from '@poker/shared';
import { PlayingCard, TitleTag, cardName, titleText } from '../cosmetics';
import { Avatar, cx } from '../ui';
import { actionText } from './actions';
import type { Slot, StageLayout } from './layout';
import { TurnTimer } from './TurnTimer';

export const cardKey = (c: Card) => `${c.rank}${c.suit}`;

/** What happened to this seat in the hand result, if anything. */
export interface SeatOutcome {
  /** Chips collected (0 when they didn't win). */
  won: number;
  /** Their tabled hand at showdown. */
  shown: ShownHand | null;
}

export interface SeatProps {
  seat: number;
  player: SeatPlayer;
  slot: Slot;
  layout: StageLayout;
  /** This is you. */
  hero: boolean;
  toAct: boolean;
  actionEndsAt: number | null;
  turnMs: number;
  /** Current hand number (keys the deal animation). */
  handNumber: number | null;
  outcome: SeatOutcome | null;
  /** A result is showing (so non-winners fade back). */
  resultShowing: boolean;
  /** Cards to highlight (the winning five). */
  highlight: ReadonlySet<string>;
  onSelect(): void;
  selected?: boolean;
}

type Tone = 'plain' | 'quiet' | 'brass' | 'chip';

/** The one status line under the avatar, most important first. */
export function seatStatus(p: SeatPlayer, resultShowing = false): { text: string; tone: Tone } | null {
  if (resultShowing) {
    // The hand is over: only folds stay marked; the result speaks for the rest.
    return p.inHand && p.folded ? { text: 'Folded', tone: 'quiet' } : null;
  }
  if (p.lastAction) {
    const t = p.lastAction.type;
    const tone: Tone = t === 'all-in' ? 'chip' : t === 'bet' || t === 'raise' ? 'brass' : t === 'fold' ? 'quiet' : 'plain';
    return { text: actionText(p.lastAction), tone };
  }
  if (p.allIn) return { text: 'All-in', tone: 'chip' };
  if (p.inHand && p.folded) return { text: 'Folded', tone: 'quiet' };
  if (p.sittingOut) return { text: 'Sitting out', tone: 'quiet' };
  if (!p.connected) return { text: 'Away', tone: 'quiet' };
  if (p.pending === 'leave') return { text: 'Leaving', tone: 'quiet' };
  if (p.pending === 'stand') return { text: 'Standing up', tone: 'quiet' };
  if (p.state === 'waiting') return { text: 'Next hand', tone: 'quiet' };
  return null;
}

const PILL: Record<Tone, string> = {
  plain: 'bg-walnut-800 text-stock ring-walnut-600',
  quiet: 'bg-walnut-950 text-muted ring-walnut-700',
  brass: 'bg-brass text-ink ring-brass-dark',
  chip: 'bg-chip text-stock ring-chip-dark',
};

/** Spoken summary of a seat for its button. */
export function seatLabel(seat: number, p: SeatPlayer, opts: { hero: boolean; toAct: boolean; outcome: SeatOutcome | null }): string {
  const parts = [`Seat ${seat + 1}`, opts.hero ? `${p.name} (you)` : p.name, `${formatChips(p.stack)} chips`];
  const status = seatStatus(p);
  if (opts.toAct) parts.push('to act');
  if (status) parts.push(status.text.toLowerCase());
  if (opts.outcome?.won) parts.push(`won ${formatChips(opts.outcome.won)}`);
  if (opts.outcome?.shown) parts.push(`showed ${opts.outcome.shown.label.toLowerCase()}`);
  return parts.join(', ');
}

/** An occupied seat: avatar with frame and timer, cards, status and name plate. */
export function Seat({ seat, player: p, slot, layout, hero, toAct, actionEndsAt, turnMs, handNumber, outcome, resultShowing, highlight, onSelect, selected }: SeatProps) {
  const s = layout.avatar;
  const status = seatStatus(p, resultShowing);
  const faded = (p.inHand && p.folded) || p.sittingOut || !p.connected;
  const winner = !!outcome && outcome.won > 0;
  const dim = faded || (resultShowing && !winner && p.inHand);
  const title = titleText(p.cosmetics.title);
  // Deal animation starts from the middle of the table.
  const deal = { '--dx': `${layout.cx - slot.x}px`, '--dy': `${layout.cy - slot.y}px` } as CSSProperties;
  const cards = p.holeCards;
  const showPlateTitle = !!title && s >= 40;

  return (
    <li
      className="absolute"
      style={{ left: slot.x, top: slot.y, width: 0, height: 0, zIndex: hero ? 6 : toAct ? 5 : 4 }}
      data-seat={seat}
      data-player={p.id}
    >
      <div className="absolute" style={{ width: s, height: s, left: -s / 2, top: -s / 2 }}>
        {/* Cards behind the plate but in front of the avatar */}
        {cards && hero && (
          <div
            key={`hero-${handNumber}`}
            className="absolute flex"
            style={{ left: s * 0.62, bottom: -s * 0.18 }}
            aria-label="Your cards"
            role="group"
          >
            {cards.map((c, i) => (
              <span
                key={cardKey(c)}
                className="tbl-deal inline-block"
                style={{ ...deal, animationDelay: `${i * 90}ms`, rotate: i === 0 ? '-4deg' : '5deg', marginLeft: i === 1 ? -layout.heroCard * 0.28 : 0 }}
              >
                <PlayingCard card={c} width={layout.heroCard} highlight={highlight.has(cardKey(c))} dim={p.folded} />
              </span>
            ))}
          </div>
        )}
        {cards && !hero && (
          <div key={`shown-${handNumber}`} className="tbl-reveal absolute left-1/2 z-10 flex -translate-x-1/2" style={{ top: -s * 0.32 }} role="group" aria-label={`${p.name}'s cards`}>
            {cards.map((c, i) => (
              <span key={cardKey(c)} className="inline-block" style={{ marginLeft: i === 1 ? -layout.shownCard * 0.18 : 0 }}>
                <PlayingCard card={c} width={layout.shownCard} highlight={highlight.has(cardKey(c))} />
              </span>
            ))}
          </div>
        )}
        {!cards && p.hasHiddenCards && (
          <div key={`backs-${handNumber}`} className="absolute flex" style={{ left: s * 0.5, top: -s * 0.22 }} role="group" aria-label={`${p.name}'s cards, face down`}>
            {[0, 1].map((i) => (
              <span
                key={i}
                className="tbl-deal inline-block origin-bottom"
                style={{ ...deal, animationDelay: `${i * 90}ms`, rotate: i === 0 ? '-8deg' : '9deg', marginLeft: i === 1 ? -layout.seatCard * 0.55 : 0 }}
              >
                <PlayingCard card={null} backId={p.cosmetics.cardBack} width={layout.seatCard} />
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onSelect}
          aria-label={seatLabel(seat, p, { hero, toAct, outcome })}
          aria-haspopup={hero ? undefined : 'menu'}
          aria-expanded={hero ? undefined : !!selected}
          className={cx(
            'relative block rounded-full transition-[opacity,filter] duration-300',
            dim && 'opacity-55 grayscale-[60%]',
            winner && 'shadow-[0_0_0_3px_var(--color-brass),0_0_28px_6px_color-mix(in_srgb,var(--color-brass)_55%,transparent)]',
          )}
          style={{ width: s, height: s }}
        >
          <Avatar src={p.avatarUrl} name={p.name} frameId={p.cosmetics.frame} size={s} />
          {!p.connected && (
            <span className="absolute -top-0.5 -left-0.5 size-3 rounded-full bg-walnut-400 ring-2 ring-walnut-950" aria-hidden="true" />
          )}
        </button>
        {toAct && actionEndsAt !== null && <TurnTimer endsAt={actionEndsAt} totalMs={turnMs} size={s + Math.max(8, s * 0.18)} name={p.name} />}

        {winner && (
          <span
            key={`won-${handNumber}`}
            className="tbl-pop tabular absolute left-1/2 z-20 -translate-x-1/2 rounded-full bg-brass px-2 font-display text-ink shadow-edge-brass"
            style={{ top: cards && !hero ? -s * 0.32 - Math.max(12, s * 0.3) * 1.35 - 4 : -s * 0.55, fontSize: Math.max(12, s * 0.3), lineHeight: 1.35, animationDelay: '0.45s' }}
            aria-hidden="true"
          >
            +{formatChipsShort(outcome!.won)}
          </span>
        )}

        {status && (
          <span
            key={status.text}
            className={cx(
              'tbl-pop absolute left-1/2 z-20 -translate-x-1/2 rounded-full px-1.5 font-condensed font-bold whitespace-nowrap ring-1',
              PILL[status.tone],
            )}
            style={{ top: s - Math.max(8, s * 0.2), fontSize: Math.max(10, Math.min(13, s * 0.27)), lineHeight: 1.45 }}
            aria-hidden="true"
          >
            {status.text}
          </span>
        )}

        {/* Name plate */}
        <div
          className={cx(
            'absolute left-1/2 z-10 flex -translate-x-1/2 flex-col items-center rounded-md bg-walnut-950/90 px-1.5 pb-0.5 ring-1 transition-shadow',
            winner ? 'ring-brass' : toAct ? 'ring-brass/70' : 'ring-walnut-600/80',
            faded && 'opacity-70',
          )}
          style={{ top: s + (status ? Math.max(6, s * 0.16) : 2), width: Math.max(64, s * 2.25), paddingTop: status ? Math.max(4, s * 0.1) : 2 }}
          aria-hidden="true"
        >
          <span className="w-full truncate text-center font-semibold text-stock" style={{ fontSize: Math.max(11, Math.min(14, s * 0.29)), lineHeight: 1.25 }}>
            {p.name}
          </span>
          <span className="tabular font-display text-brass-light" style={{ fontSize: Math.max(11, Math.min(16, s * 0.32)), lineHeight: 1.2 }}>
            {formatChipsShort(p.stack)}
          </span>
          {showPlateTitle && !outcome?.shown && <TitleTag title={title} className="mt-0.5 mb-0.5 max-w-full truncate" />}
          {outcome?.shown && !hero && (
            <span
              className={cx(
                'tbl-pop mt-0.5 mb-0.5 max-w-full truncate rounded px-1 text-center font-condensed font-bold',
                winner ? 'bg-brass text-ink' : 'bg-walnut-800 text-stock-dim',
              )}
              style={{ fontSize: Math.max(10, Math.min(13, s * 0.26)), lineHeight: 1.35 }}
            >
              {outcome.shown.label}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export interface EmptySeatProps {
  seat: number;
  slot: Slot;
  layout: StageLayout;
  /** Show the "Sit here" button (you're not seated and may sit). */
  canSit: boolean;
  /** Why sitting is blocked, if it is. */
  blockedReason: string | null;
  onSit(): void;
}

/** An empty chair: "Sit here" for watchers, a faint outline otherwise. */
export function EmptySeat({ seat, slot, layout, canSit, blockedReason, onSit }: EmptySeatProps) {
  const s = layout.avatar;
  if (!canSit) {
    return (
      <li className="absolute" style={{ left: slot.x, top: slot.y }} aria-label={`Seat ${seat + 1}, empty`}>
        <span
          className="absolute rounded-full border-2 border-dashed border-stock/15 bg-walnut-950/25"
          style={{ width: s * 0.8, height: s * 0.8, left: -s * 0.4, top: -s * 0.4 }}
        />
      </li>
    );
  }
  return (
    <li className="absolute" style={{ left: slot.x, top: slot.y, zIndex: 3 }}>
      <button
        type="button"
        onClick={onSit}
        disabled={!!blockedReason}
        title={blockedReason ?? undefined}
        aria-label={blockedReason ? `Seat ${seat + 1}: ${blockedReason}` : `Sit here, seat ${seat + 1}`}
        className={cx(
          'absolute flex flex-col items-center justify-center gap-0.5 rounded-full border-2 border-dashed font-condensed font-bold transition-colors',
          blockedReason
            ? 'border-stock/15 bg-walnut-950/30 text-muted'
            : 'border-brass/70 bg-walnut-950/60 text-brass-light hover:border-brass hover:bg-walnut-900 hover:text-brass',
        )}
        style={{ width: s * 1.05, height: s * 1.05, left: -s * 0.525, top: -s * 0.525, fontSize: Math.max(10, Math.min(13, s * 0.25)), lineHeight: 1.05 }}
      >
        Sit here
      </button>
    </li>
  );
}

/** Spoken list of cards, e.g. "Ace of spades, King of hearts". */
export const cardsLabel = (cards: Card[]) => cards.map(cardName).join(', ');
