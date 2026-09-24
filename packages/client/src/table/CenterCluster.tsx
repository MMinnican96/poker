import type { ReactNode } from 'react';
import { formatChips, type HandResultView, type HandView, type PotView } from '@poker/shared';
import { PlayingCard, feltVisual } from '../cosmetics';
import { ChipAmount, ChipGlyph, cx } from '../ui';
import type { StageLayout } from './layout';
import { cardKey } from './Seat';

/** Joins names: "Alice", "Alice and Bob", "Alice, Bob and Cara". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface ResultLine {
  key: string;
  /** "Main pot", "Side pot 1" — only when there are several pots. */
  pot: string | null;
  text: string;
  label: string | null;
}

/**
 * One line per pot: "Bob wins 1,200" / "You win 300" / "Alice and Bob split
 * 800", with the winning hand's label. Neighbouring pots with the same winners
 * and label merge into one line.
 */
export function resultLines(result: HandResultView, nameOf: (id: string) => string, youId: string): ResultLine[] {
  const merged: { winnerIds: string[]; amount: number; handLabel: string | null; first: number; last: number }[] = [];
  result.pots.forEach((p, i) => {
    const prev = merged[merged.length - 1];
    if (prev && prev.handLabel === p.handLabel && prev.winnerIds.join() === p.winnerIds.join()) {
      prev.amount += p.amount;
      prev.last = i;
    } else merged.push({ winnerIds: [...p.winnerIds], amount: p.amount, handLabel: p.handLabel, first: i, last: i });
  });
  const many = merged.length > 1;
  return merged.map((m) => {
    const names = m.winnerIds.map((id) => (id === youId ? 'You' : nameOf(id)));
    const verb = m.winnerIds.length > 1 ? 'split' : m.winnerIds[0] === youId ? 'win' : 'wins';
    const pot = !many ? null : m.first === 0 ? 'Main pot' : m.first === m.last ? `Side pot ${m.first}` : `Side pots ${m.first}–${m.last}`;
    return { key: `${m.first}`, pot, text: `${joinNames(names)} ${verb} ${formatChips(m.amount)}`, label: m.handLabel };
  });
}

/** Pot chips shown under the board while there are several pots. */
function PotBreakdown({ pots }: { pots: PotView[] }) {
  if (pots.length < 2) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-1" aria-label="Pots">
      {pots.map((p, i) => (
        <li key={i} className="tabular inline-flex items-center gap-1 rounded-full bg-walnut-950/60 px-2 font-condensed text-[12px] leading-5 font-bold text-stock-dim">
          <ChipGlyph size={11} />
          <span>{i === 0 ? 'Main' : `Side ${i}`}</span>
          <span className="text-stock">{formatChips(p.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface CenterClusterProps {
  layout: StageLayout;
  feltId: string;
  hand: HandView | null;
  /** Cards of the winning five, to highlight on the board. */
  highlight: ReadonlySet<string>;
  nameOf(id: string): string;
  youId: string;
  /** Shown instead of the board when no hand is running. */
  idle?: ReactNode;
}

/** The middle of the felt: pot, board, side pots, and the result. */
export function CenterCluster({ layout, feltId, hand, highlight, nameOf, youId, idle }: CenterClusterProps) {
  const w = layout.boardCard;
  const line = feltVisual(feltId).line;
  const result = hand?.result ?? null;
  const lines = result ? resultLines(result, nameOf, youId) : [];
  const gap = Math.max(3, Math.round(w * 0.08));
  const boardWidth = w * 5 + gap * 4;

  return (
    <div
      className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: layout.cx, top: layout.cy + w * 0.12, width: Math.max(boardWidth, hand ? 160 : 230), gap: Math.max(4, w * 0.12) }}
    >
      {!hand && <div style={{ fontSize: Math.max(12, Math.min(16, w * 0.28)) }}>{idle}</div>}
      {hand && (
        <>
          {/* Pot, or the result once the hand is over */}
          <div className="flex min-h-[1.6em] flex-col items-center" style={{ fontSize: Math.max(12, Math.min(18, w * 0.3)) }} aria-live="polite">
            {result ? (
              <div key={`result-${hand.handNumber}`} className="tbl-pop flex flex-col items-center gap-0.5" role="status">
                {lines.map((l) => (
                  <p key={l.key} className="text-center leading-tight">
                    {l.pot && <span className="mr-1.5 font-condensed text-[0.8em] font-bold text-stock-dim">{l.pot}</span>}
                    <span className="font-display text-brass-light drop-shadow-[0_2px_0_rgb(0_0_0/0.45)]">{l.text}</span>
                    {l.label && <span className="block font-condensed text-[0.85em] font-bold text-stock">{l.label}</span>}
                  </p>
                ))}
              </div>
            ) : hand.potTotal > 0 ? (
              <p className="flex items-center gap-1.5 rounded-full bg-walnut-950/55 px-3 py-0.5">
                <span className="font-condensed text-[0.8em] font-bold text-stock-dim">Pot</span>
                <ChipAmount value={hand.potTotal} size="lg" className="text-[1.15em]!" />
              </p>
            ) : null}
          </div>

          <ol className="flex" style={{ gap }} aria-label="Board">
            {Array.from({ length: 5 }, (_, i) => {
              const c = hand.board[i];
              if (!c) {
                return (
                  <li
                    key={`slot-${i}`}
                    aria-hidden="true"
                    className="rounded-[8%/5.7%]"
                    style={{ width: w, height: Math.round(w * 1.4), border: `1.5px dashed ${line}`, opacity: 0.16 }}
                  />
                );
              }
              const k = cardKey(c);
              const lit = highlight.size > 0 && highlight.has(k);
              return (
                <li
                  key={`${hand.handNumber}-${i}`}
                  className="tbl-board [perspective:600px]"
                  style={{ animationDelay: i < 3 ? `${i * 110}ms` : '0ms' }}
                >
                  <PlayingCard card={c} width={w} highlight={lit} dim={result !== null && result.wentToShowdown && highlight.size > 0 && !lit} />
                </li>
              );
            })}
          </ol>

          {!result && <PotBreakdown pots={hand.pots} />}
        </>
      )}
    </div>
  );
}

/** The quiet message in the middle of the felt between hands. */
export function IdleMessage({ title, body, action, className }: { title: string; body?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('pointer-events-auto flex flex-col items-center gap-[0.5em] rounded-2xl bg-baize-deep/40 px-[1em] py-[0.6em] text-center', className)} role="status">
      <p className="font-display text-[1.3em] leading-tight text-stock drop-shadow-[0_2px_0_rgb(0_0_0/0.4)]">{title}</p>
      {body && <p className="max-w-[28ch] text-[0.88em] leading-snug text-stock-dim">{body}</p>}
      {action}
    </div>
  );
}
