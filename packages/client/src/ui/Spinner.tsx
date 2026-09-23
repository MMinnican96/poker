import { cx } from './cx';

/** A spinning clay-chip edge. `label` is announced to screen readers. */
export function Spinner({ size = 20, label = 'Loading', className }: { size?: number; label?: string; className?: string }) {
  return (
    <span role="status" aria-label={label} className={cx('inline-block', className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" className="motion-safe:animate-spin-slow" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="4.7 4.7" strokeDashoffset="0" pathLength="56" />
      </svg>
    </span>
  );
}
