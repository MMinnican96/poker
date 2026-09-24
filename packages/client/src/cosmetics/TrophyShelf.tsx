import { SHOWCASE_MAX, achievementLabel, getAchievement } from '@poker/shared';
import { cx } from '../ui/cx';
import { Emblem, emblemName } from './Emblem';

export interface ShelfItem {
  id: string;
  tier: number;
}

export interface TrophyShelfProps {
  /** Showcased emblems in order; empty places are drawn as bare plaques. */
  items: readonly ShelfItem[];
  /** Places on the shelf (default 5). */
  slots?: number;
  /** Largest emblem size in px; emblems shrink to fit their place on narrow screens. */
  size?: number;
  /** Accessible name for the list. */
  label: string;
  className?: string;
}

/**
 * A walnut display shelf: emblems stand on a plank, each over a small brass
 * plaque with its name. Used by the trophy cabinet and on profile cards.
 */
export function TrophyShelf({ items, slots = SHOWCASE_MAX, size = 56, label, className }: TrophyShelfProps) {
  const places = Array.from({ length: Math.max(slots, items.length) }, (_, i) => items[i] ?? null);
  return (
    // The cabinet: a walnut frame with a brass hairline, around a dark back panel.
    <div className={cx('rounded-xl bg-walnut-700 tex-wood p-1.5 shadow-panel ring-1 ring-inset ring-walnut-500', className)}>
    <div className="relative overflow-hidden rounded-lg bg-walnut-950 p-2 pb-0 shadow-inset-well ring-1 ring-brass-dark/60">
      {/* Warm light falling on the shelf from above. */}
      <div className="lamp-glow pointer-events-none absolute inset-0" aria-hidden="true" />
      <ol aria-label={label} className="relative grid items-end gap-1.5 xs:gap-2" style={{ gridTemplateColumns: `repeat(${places.length}, minmax(0, 1fr))` }}>
        {places.map((item, i) => {
          const def = item ? getAchievement(item.id) : undefined;
          return (
            <li key={item ? item.id : `empty-${i}`} className="flex min-w-0 flex-col items-center gap-1">
              {def && item ? (
                <>
                  <span className="block w-full" style={{ maxWidth: size }}>
                    <Emblem achievementId={def.id} tier={item.tier} size={size} className="h-auto w-full drop-shadow-[0_4px_3px_rgb(0_0_0/0.5)]" decorative />
                  </span>
                  <span
                    className="w-full truncate rounded-[3px] bg-brass px-1 text-center font-condensed text-[11px] leading-4 font-bold text-ink-brass shadow-placard"
                    title={achievementLabel(def, item.tier)}
                  >
                    <span className="sr-only">{emblemName(def, item.tier)}</span>
                    <span aria-hidden="true">{achievementLabel(def, item.tier)}</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="block aspect-square w-full p-[10%]" style={{ maxWidth: size }} aria-hidden="true">
                    <span className="block size-full rounded-full border-2 border-dashed border-walnut-600" />
                  </span>
                  <span className="w-full rounded-[3px] bg-walnut-700 text-center font-condensed text-[11px] leading-4 font-bold text-muted">
                    <span className="sr-only">Empty place</span>
                    <span aria-hidden="true">&nbsp;</span>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {/* The plank. */}
      <div className="relative -mx-2 mt-1.5 h-2.5 bg-walnut-600 shadow-edge-walnut" aria-hidden="true" />
      <div className="-mx-2 h-1" aria-hidden="true" />
    </div>
    </div>
  );
}
