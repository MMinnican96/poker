import { useEffect, useRef, useState } from 'react';
import type { Ack, PlayerAction, TableView } from '@poker/shared';
import { cx } from '../ui';
import { preActionExpired, resolvePreAction, type PreAction, type PreActionContext } from './actions';

function contextOf(view: TableView): PreActionContext | null {
  const h = view.hand;
  if (!h || h.result) return null;
  return { handNumber: h.handNumber, street: h.street, currentBet: h.currentBet };
}

/**
 * A queued choice for your next turn. It expires on a new street or hand ("Check"
 * also when the bet changes) and fires by itself when your turn comes, if it
 * still makes sense.
 */
export function usePreAction(view: TableView, act: (a: PlayerAction) => Promise<Ack>) {
  const [armed, setArmed] = useState<{ pre: PreAction; ctx: PreActionContext } | null>(null);
  const fired = useRef<string | null>(null);
  const ctx = contextOf(view);

  // Expire.
  useEffect(() => {
    if (armed && preActionExpired(armed.pre, armed.ctx, ctx)) setArmed(null);
  }, [armed, ctx?.handNumber, ctx?.street, ctx?.currentBet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire when your turn arrives.
  const legal = view.you.legal;
  useEffect(() => {
    if (!armed || !legal || !ctx) return;
    if (preActionExpired(armed.pre, armed.ctx, ctx)) return;
    const turnKey = `${ctx.handNumber}:${ctx.street}:${ctx.currentBet}:${view.hand?.actionEndsAt ?? ''}`;
    if (fired.current === turnKey) return;
    fired.current = turnKey;
    const action = resolvePreAction(armed.pre, legal);
    setArmed(null);
    if (action) void act(action);
  }, [armed, legal]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (pre: PreAction) => {
    if (!ctx) return;
    setArmed((a) => (a?.pre === pre ? null : { pre, ctx }));
  };
  return { armed: armed?.pre ?? null, toggle };
}

export interface PreActionsProps {
  armed: PreAction | null;
  toggle(pre: PreAction): void;
  /** Someone has bet more than you've put in. */
  facingBet: boolean;
  wide?: boolean;
}

/** Toggles for your next turn, shown while someone else acts. */
export function PreActions({ armed, toggle, facingBet, wide }: PreActionsProps) {
  const options: { pre: PreAction; label: string }[] = facingBet
    ? [
        { pre: 'check-fold', label: 'Fold' },
        { pre: 'call-any', label: 'Call any' },
      ]
    : [
        { pre: 'check-fold', label: 'Check/fold' },
        { pre: 'check', label: 'Check' },
        { pre: 'call-any', label: 'Call any' },
      ];
  return (
    <div role="group" aria-label="Act in advance" className={cx('flex items-center gap-1.5', wide && 'w-full')}>
      {options.map(({ pre, label }) => {
        const on = armed === pre;
        return (
          <button
            key={pre}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(pre)}
            className={cx(
              'flex h-10 items-center gap-2 rounded-lg px-3 text-[14px] font-semibold ring-1 ring-inset transition-colors',
              wide && 'flex-1 justify-center px-1.5',
              on ? 'bg-brass/15 text-brass-light ring-brass' : 'bg-walnut-950/50 text-stock-dim ring-walnut-600 hover:text-stock hover:ring-walnut-500',
            )}
          >
            <span
              aria-hidden="true"
              className={cx('grid size-4 shrink-0 place-items-center rounded-[4px] ring-1', on ? 'bg-brass ring-brass' : 'ring-stock/40')}
            >
              {on && (
                <svg viewBox="0 0 16 16" className="size-3 fill-none stroke-ink" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
              )}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
