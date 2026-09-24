import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Small count shown after the label (hidden when 0/undefined). */
  badge?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange(id: T): void;
  /** Accessible name for the tab list. */
  label: string;
  /** Stretch tabs to fill the row. */
  fill?: boolean;
  className?: string;
  /** Stable id prefix; pass the same one to `tabPanelProps` to link the panel. */
  idBase?: string;
}

/** Props for the panel showing tab `id` (pair with the same `idBase` as <Tabs>). */
export function tabPanelProps(idBase: string, id: string) {
  return { role: 'tabpanel' as const, id: `${idBase}-panel-${id}`, 'aria-labelledby': `${idBase}-tab-${id}`, tabIndex: 0 };
}

/**
 * Segmented tab list (WAI-ARIA tabs: arrow keys, Home/End). Render the panel
 * yourself with `tabPanelProps(idBase, value)` for the aria wiring.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label, fill, className, idBase }: TabsProps<T>) {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = tabs.filter((t) => !t.disabled);
  // Keep the selected tab in view when the row scrolls sideways (narrow screens).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    refs.current[tabs.findIndex((t) => t.id === value)]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = enabled[next].id;
    onChange(id);
    refs.current[tabs.findIndex((t) => t.id === id)]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx('inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-walnut-950/60 p-1 ring-1 ring-inset ring-black/40', fill && 'flex w-full', className)}
    >
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            type="button"
            id={`${base}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={cx(
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-40',
              fill && 'flex-1',
              selected ? 'bg-walnut-600 text-stock shadow-edge-walnut' : 'text-stock-dim hover:text-stock',
            )}
          >
            {t.label}
            {!!t.badge && <span className="tabular rounded-full bg-chip px-1.5 text-[11px] leading-4 text-stock">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
