import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Accessible name (not needed inside a `group` Field, whose legend names it). */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A radio group drawn as a row of chips (arrow keys move the selection). Wraps
 * onto more rows when narrow.
 */
export function Segmented<T extends string | number>({ options, value, onChange, label, size = 'md', className }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled);

  const noneChecked = !options.some((o) => o.value === value);

  const onKeyDown = (e: KeyboardEvent) => {
    const at = enabled.findIndex(({ o }) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + enabled.length) % enabled.length;
    if (next < 0) return;
    e.preventDefault();
    onChange(enabled[next].o.value);
    refs.current[enabled[next].i]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cx('flex flex-wrap gap-1.5', className)}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            tabIndex={checked || (noneChecked && i === enabled[0]?.i) ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'tabular inline-flex items-center justify-center rounded-md font-semibold transition-colors disabled:opacity-35',
              size === 'sm' ? 'h-8 min-w-8 px-2 text-[13px]' : 'h-9 min-w-10 px-3 text-sm',
              checked
                ? 'bg-brass text-ink shadow-edge-brass'
                : 'bg-walnut-950/70 text-stock-dim ring-1 ring-inset ring-walnut-600 hover:text-stock hover:ring-walnut-500',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
