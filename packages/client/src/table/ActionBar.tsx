import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Ack, LegalActions, PlayerAction } from '@poker/shared';
import { AmountInput, Button, cx } from '../ui';
import { callLabel, raiseLabel, raisePresets, raiseVerb } from './actions';

export interface ActionBarProps {
  legal: LegalActions;
  potTotal: number;
  currentBet: number;
  /** Your chips already in this street. */
  committed: number;
  /** Raise amounts snap to this (the small blind). */
  step: number;
  onAct(action: PlayerAction): Promise<Ack>;
  /** Stack the buttons full width (portrait phones). */
  wide?: boolean;
}

/** Is this key press meant for a text field or a dialog rather than the table? */
function typingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !(t instanceof HTMLElement)) return false;
  if (t.closest('[role="dialog"]')) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      aria-hidden="true"
      className="ml-0.5 hidden rounded-[4px] bg-black/20 px-1 font-condensed text-[11px] leading-4 font-bold opacity-70 sm:inline-block pointer-coarse:hidden"
    >
      {children}
    </kbd>
  );
}

/**
 * Your options when it's your turn: fold, check/call, and bet/raise with an
 * amount picker. Shortcuts: F fold, C check/call, R raise (Enter confirms, Esc
 * cancels).
 */
export function ActionBar({ legal, potTotal, currentBet, committed, step, onAct, wide }: ActionBarProps) {
  const [raising, setRaising] = useState(false);
  const [amount, setAmount] = useState(legal.minRaiseTo);
  const [sent, setSent] = useState<string | null>(null);
  const trayRef = useRef<HTMLFormElement>(null);

  // A new decision: start again from the minimum raise.
  useEffect(() => {
    setAmount(legal.minRaiseTo);
    setSent(null);
    setRaising(false);
  }, [legal.minRaiseTo, legal.maxRaiseTo, legal.callAmount, legal.canCheck]);

  const act = async (key: string, action: PlayerAction) => {
    if (sent) return;
    setSent(key);
    const ack = await onAct(action);
    if (!ack.ok) setSent(null);
    else setRaising(false);
  };

  const fold = () => legal.canFold && act('fold', { type: 'fold' });
  const checkOrCall = () => {
    if (legal.canCheck) return act('check', { type: 'check' });
    if (legal.callAmount > 0) return act('call', { type: 'call' });
  };
  const confirmRaise = () => {
    if (!legal.canRaise) return;
    const to = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, amount));
    return act('raise', { type: 'raise', amount: to });
  };

  const keys = useRef({ fold, checkOrCall, confirmRaise, raising, legal });
  keys.current = { fold, checkOrCall, confirmRaise, raising, legal };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const k = keys.current;
      if (e.key === 'Escape' && k.raising) {
        setRaising(false);
        return;
      }
      if (e.key === 'Enter' && k.raising) {
        // The amount field commits on Enter first; let it, then confirm.
        const inTray = trayRef.current?.contains(e.target as Node);
        if (typingTarget(e) && !inTray) return;
        // Let the tray's own Cancel/confirm buttons act natively; a preset
        // button that has focus shouldn't swallow the confirm.
        const btn = e.target as HTMLButtonElement;
        if (btn?.tagName === 'BUTTON' && (btn.type === 'submit' || btn.dataset.trayCancel !== undefined || !inTray)) return;
        e.preventDefault();
        setTimeout(() => void keys.current.confirmRaise(), 0);
        return;
      }
      if (typingTarget(e)) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        void k.fold();
      } else if (key === 'c') {
        e.preventDefault();
        void k.checkOrCall();
      } else if (key === 'r' && k.legal.canRaise) {
        e.preventDefault();
        setRaising((r) => !r);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (raising) trayRef.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
  }, [raising]);

  const presets = raisePresets(legal, potTotal, currentBet);
  const verb = raiseVerb(currentBet);
  const callText = callLabel(legal, committed);

  return (
    <div className={cx('relative flex items-stretch gap-2', wide && 'w-full')} role="group" aria-label="Your action">
      {raising && legal.canRaise && (
        <form
          ref={trayRef}
          aria-label={`${verb} amount`}
          className={cx(
            'absolute bottom-full z-30 mb-2 flex flex-col gap-2 rounded-xl bg-walnut-800 p-3 shadow-lift ring-1 ring-walnut-600 tex-wood motion-safe:animate-rise',
            wide ? 'inset-x-0' : 'right-0 w-[22rem] max-w-[calc(100vw-1rem)]',
          )}
          onSubmit={(e) => {
            e.preventDefault();
            void confirmRaise();
          }}
        >
          <AmountInput
            value={amount}
            onChange={setAmount}
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={step}
            label={verb === 'Bet' ? 'Bet amount' : 'Raise to'}
            presets={presets}
          />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" data-tray-cancel onClick={() => setRaising(false)}>Cancel</Button>
            <Button type="submit" size="sm" className="flex-1" loading={sent === 'raise'}>
              {raiseLabel(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, amount)), legal, currentBet)}
            </Button>
          </div>
        </form>
      )}

      {legal.canFold && (
        <Button variant="danger" size="lg" onClick={() => void fold()} loading={sent === 'fold'} disabled={!!sent} className={cx(wide && 'flex-1 px-2')}>
          Fold<Kbd>F</Kbd>
        </Button>
      )}
      {(legal.canCheck || legal.callAmount > 0) && (
        <Button variant="brass" size="lg" onClick={() => void checkOrCall()} loading={sent === 'check' || sent === 'call'} disabled={!!sent} className={cx(wide && 'flex-1 px-2')}>
          {callText}<Kbd>C</Kbd>
        </Button>
      )}
      {legal.canRaise && (
        <Button
          variant="primary"
          size="lg"
          onClick={() => setRaising((r) => !r)}
          aria-expanded={raising}
          disabled={!!sent}
          className={cx(wide && 'flex-1 px-2')}
        >
          {verb}<Kbd>R</Kbd>
        </Button>
      )}
    </div>
  );
}
