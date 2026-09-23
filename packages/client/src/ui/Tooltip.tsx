import { cloneElement, useId, useState, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element (button, link). It gets `aria-describedby`. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

const SIDE = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
} as const;

/** A small card-stock label shown on hover and keyboard focus; Esc hides it. */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cx('relative inline-flex', className)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className={cx(
          'pointer-events-none absolute z-40 w-max max-w-56 rounded-md bg-stock px-2 py-1 text-[13px] leading-snug font-medium text-ink shadow-lift',
          SIDE[side],
          open ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}
