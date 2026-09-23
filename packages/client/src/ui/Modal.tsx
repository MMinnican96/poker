import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { IconButton } from './Button';
import { CloseIcon } from './icons';
import { useDialogFocus } from './useDialogFocus';

export interface ModalProps {
  open: boolean;
  /** Called on Esc, backdrop click and the close button. */
  onClose(): void;
  /** Dialog heading (also its accessible name). */
  title: ReactNode;
  /** Optional line under the title (becomes aria-describedby). */
  description?: ReactNode;
  children?: ReactNode;
  /** Sticky action row at the bottom (right-aligned). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** walnut (default) or paper (card stock, ink text). */
  tone?: 'walnut' | 'paper';
  /** Element to focus first; defaults to `[data-autofocus]`, then the first focusable. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Hide the heading row (the title stays as an sr-only accessible name). */
  hideHeader?: boolean;
}

const WIDTH = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' } as const;

/**
 * Accessible dialog: rendered in a portal, traps Tab focus, closes on Esc and
 * backdrop click, and returns focus to whatever opened it. Bottom sheet on
 * narrow screens; the body scrolls when the viewport is short.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', tone = 'walnut', initialFocusRef, hideHeader }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useDialogFocus(open, panelRef, onClose, initialFocusRef);

  if (!open) return null;
  const paper = tone === 'paper';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 xs:items-center sm:p-4">
      <div className="absolute inset-0 bg-walnut-950/75 motion-safe:animate-fade" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-2xl shadow-lift outline-none motion-safe:animate-rise',
          WIDTH[size],
          paper ? 'bg-stock tex-grain text-ink ring-1 ring-stock-edge' : 'bg-walnut-800 tex-wood text-stock ring-1 ring-walnut-600',
        )}
      >
        {hideHeader ? (
          <h2 id={titleId} className="sr-only">{title}</h2>
        ) : (
          <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2 short:pt-3">
            <div className="min-w-0">
              <h2 id={titleId} className={cx('text-xl', paper ? 'text-ink' : 'text-stock')}>{title}</h2>
              {description && (
                <p id={descId} className={cx('mt-1 text-sm', paper ? 'text-ink-soft' : 'text-muted')}>{description}</p>
              )}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose} className={paper ? 'text-ink-soft hover:bg-ink/10 hover:text-ink' : undefined}>
              <CloseIcon size={18} />
            </IconButton>
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <footer className={cx('flex flex-wrap items-center justify-end gap-2 px-5 py-3 short:py-2', paper ? 'border-t border-ink/10' : 'border-t border-walnut-600/60 bg-walnut-900/50')}>
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
