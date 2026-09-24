import { useEffect, useRef } from 'react';
import type { Notice } from '@poker/shared';
import { cx } from './cx';
import { IconButton } from './Button';
import { CloseIcon } from './icons';

export const TOAST_MS: Record<Notice['tone'], number> = { good: 5000, info: 5000, bad: 8000 };
/** Hovering holds a toast open, but never longer than this past its normal time. */
export const TOAST_HOLD_MAX_MS = 10_000;
/** Time left to read a toast after the pointer moves off it. */
export const TOAST_AFTER_LEAVE_MS = 1500;

const TONE: Record<Notice['tone'], string> = {
  good: 'before:bg-positive',
  info: 'before:bg-brass',
  bad: 'before:bg-chip',
};

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss(id: string): void }) {
  const hovering = useRef(false);
  const born = useRef(Date.now());
  const leftAt = useRef(0);
  useEffect(() => {
    const base = TOAST_MS[notice.tone];
    const max = base + TOAST_HOLD_MAX_MS;
    let t: ReturnType<typeof setTimeout>;
    const check = () => {
      const age = Date.now() - born.current;
      if (age >= max) return onDismiss(notice.id);
      if (hovering.current) {
        t = setTimeout(check, Math.min(250, max - age));
        return;
      }
      // Its normal time, or a moment after the pointer left, whichever is later.
      const due = Math.min(max, Math.max(base, leftAt.current ? leftAt.current - born.current + TOAST_AFTER_LEAVE_MS : 0));
      if (age >= due) return onDismiss(notice.id);
      t = setTimeout(check, due - age);
    };
    t = setTimeout(check, Math.max(0, base - (Date.now() - born.current)));
    return () => clearTimeout(t);
  }, [notice.id, notice.tone, onDismiss]);

  return (
    <li
      role={notice.tone === 'bad' ? 'alert' : 'status'}
      onPointerEnter={() => { hovering.current = true; }}
      onPointerLeave={() => {
        hovering.current = false;
        leftAt.current = Date.now();
      }}
      className={cx(
        'pointer-events-auto relative flex w-full items-start gap-2 overflow-hidden rounded-lg bg-stock py-2.5 pr-2 pl-4 text-ink shadow-lift motion-safe:animate-rise',
        'before:absolute before:inset-y-0 before:left-0 before:w-1.5',
        TONE[notice.tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold leading-snug">{notice.title}</p>
        {notice.body && <p className="mt-0.5 text-sm leading-snug text-ink-soft">{notice.body}</p>}
      </div>
      <IconButton label="Dismiss" size="sm" onClick={() => onDismiss(notice.id)} className="-my-1 text-ink-soft hover:bg-ink/10 hover:text-ink">
        <CloseIcon size={16} />
      </IconButton>
    </li>
  );
}

export interface ToastStackProps {
  notices: Notice[];
  onDismiss(id: string): void;
}

/**
 * Card-stock toasts, top-right under the header (full width on phones), so
 * they never cover the controls at the bottom they often refer to. They
 * auto-dismiss; hovering holds one open for a while, not forever.
 */
export function ToastStack({ notices, onDismiss }: ToastStackProps) {
  return (
    <ol
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed top-16 right-2 left-2 z-[70] flex flex-col items-end gap-2 xs:left-auto xs:w-80 short:top-12"
    >
      {notices.map((n) => <Toast key={n.id} notice={n} onDismiss={onDismiss} />)}
    </ol>
  );
}
