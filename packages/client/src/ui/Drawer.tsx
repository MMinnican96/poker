import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { useDialogFocus } from './useDialogFocus';

export interface DrawerProps {
  open: boolean;
  onClose(): void;
  /** Accessible name of the drawer. */
  label: string;
  side?: 'right' | 'left';
  children: ReactNode;
  className?: string;
}

/** A side sheet (modal on small screens): focus-trapped, Esc and backdrop close it. */
export function Drawer({ open, onClose, label, side = 'right', children, className }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(open, ref, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-walnut-950/70 motion-safe:animate-fade" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cx(
          'absolute inset-y-0 flex w-[min(24rem,100%)] flex-col bg-walnut-900 shadow-lift outline-none motion-safe:animate-slide-in',
          side === 'right' ? 'right-0' : 'left-0',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
