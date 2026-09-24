import { cx } from './cx';

/** "1 new message" / "3 new messages". `label` is one word form for both, or [singular, plural]. */
export function countLabel(count: number, label: string | readonly [string, string]): string {
  const word = typeof label === 'string' ? label : count === 1 ? label[0] : label[1];
  return `${count} ${word}`;
}

/** A small chip-red count (unread messages, unclaimed challenges). Renders nothing for 0. */
export function CountBadge({ count, label, className }: {
  count: number;
  /** Spoken after the count; or the whole spoken text as a function of it. */
  label: string | readonly [string, string] | ((count: number) => string);
  className?: string;
}) {
  if (!count || count <= 0) return null;
  return (
    <span
      className={cx(
        'tabular inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-chip px-1 text-[11px] leading-none font-bold text-stock ring-2 ring-walnut-900',
        className,
      )}
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{typeof label === 'function' ? label(count) : countLabel(count, label)}</span>
    </span>
  );
}
