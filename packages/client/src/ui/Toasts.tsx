import { useEffect, useRef } from 'react';
import type { Notice } from '@poker/shared';
import { cx } from './cx';
import { IconButton } from './Button';
import { CloseIcon } from './icons';

export const TOAST_MS: Record<Notice['tone'], number> = { good: 5000, info: 5000, bad: 8000 };

const TONE: Record<Notice['tone'], string> = {
  good: 'before:bg-positive',
  info: 'before:bg-brass',
  bad: 'before:bg-chip',
};

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss(id: string): void }) {
  const hovering = useRef(false);
  useEffect(() => {
    let left = TOAST_MS[notice.tone];
    let started = Date.now();
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      started = Date.now();
      t = setTimeout(function tick() {
        if (hovering.current) {
          t = setTimeout(tick, 500);
          return;
        }
        onDismiss(notice.id);
      }, left);
    };
    arm();
    return () => {
      clearTimeout(t);
      left -= Date.now() - started;
    };
  }, [notice.id, notice.tone, onDismiss]);

  return (
    <li
      role={notice.tone === 'bad' ? 'alert' : 'status'}
      onPointerEnter={() => { hovering.current = true; }}
      onPointerLeave={() => { hovering.current = false; }}
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

/** Card-stock toasts, bottom-right (bottom-centre on phones). Auto-dismiss; hover pauses. */
export function ToastStack({ notices, onDismiss }: ToastStackProps) {
  return (
    <ol
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed right-2 bottom-2 left-2 z-[70] flex flex-col items-end gap-2 xs:left-auto xs:w-80"
    >
      {notices.map((n) => <Toast key={n.id} notice={n} onDismiss={onDismiss} />)}
    </ol>
  );
}
