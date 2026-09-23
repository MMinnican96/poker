import { cx } from './cx';

/** A small chip-red count (unread messages, unclaimed challenges). Renders nothing for 0. */
export function CountBadge({ count, label, className }: { count: number; label: string; className?: string }) {
  if (!count || count <= 0) return null;
  return (
    <span
      className={cx(
        'tabular inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-chip px-1 text-[11px] leading-none font-bold text-stock ring-2 ring-walnut-900',
        className,
      )}
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{`${count} ${label}`}</span>
    </span>
  );
}
