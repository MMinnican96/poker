import type { LevelProgress } from '@poker/shared';
import { cx } from './cx';

export interface LevelBadgeProps {
  level: number;
  /** When given, a brass ring fills with XP progress towards the next level. */
  progress?: LevelProgress;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/** Fraction of the way through the current level (1 at max level). */
export function levelFraction(p: LevelProgress): number {
  return p.needed > 0 ? Math.min(1, Math.max(0, p.into / p.needed)) : 1;
}

/**
 * The level as a little clay chip. With `progress`, the chip's spotted edge
 * becomes an XP ring.
 */
export function LevelBadge({ level, progress, size = 28, className }: LevelBadgeProps) {
  const frac = progress ? levelFraction(progress) : 0;
  const r = 15;
  const c = 2 * Math.PI * r;
  const label = progress
    ? progress.needed > 0
      ? `Level ${level}, ${progress.into} of ${progress.needed} XP to the next level`
      : `Level ${level}, max level`
    : `Level ${level}`;
  return (
    <span className={cx('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r="17" className="fill-walnut-950" />
        <circle cx="18" cy="18" r={r} fill="none" className="stroke-walnut-600" strokeWidth="3.2" strokeDasharray="3 2.6" />
        {progress && frac > 0 && (
          <circle cx="18" cy="18" r={r} fill="none" className="stroke-brass" strokeWidth="3.2" strokeDasharray={`${c * frac} ${c}`} />
        )}
        {!progress && <circle cx="18" cy="18" r={r} fill="none" className="stroke-brass" strokeWidth="3.2" strokeDasharray="3 2.6" />}
      </svg>
      <span className="tabular relative font-display leading-none text-stock" style={{ fontSize: size * (level >= 100 ? 0.3 : level >= 10 ? 0.38 : 0.44) }} aria-hidden="true">
        {level}
      </span>
    </span>
  );
}
