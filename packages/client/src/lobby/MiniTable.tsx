import type { TableSummary } from '@poker/shared';
import { formatChipsShort } from '@poker/shared';
import { Felt } from '../cosmetics';
import { Avatar, cx, PlusIcon } from '../ui';
import { useElementWidth } from '../app/hooks';

/**
 * Where seat `index` of `maxSeats` sits around an oval table, as percentages of
 * the table box. Seat 0 is bottom-centre; seats go clockwise from there.
 */
export function seatPosition(index: number, maxSeats: number, radius = { x: 47, y: 45 }): { left: number; top: number } {
  const angle = Math.PI / 2 + (index * 2 * Math.PI) / maxSeats;
  return { left: 50 + radius.x * Math.cos(angle), top: 50 + radius.y * Math.sin(angle) };
}

export interface MiniTableProps {
  table: TableSummary;
  /** Click on an empty seat (omit to make empty seats inert). */
  onSeatClick?(seat: number): void;
  /** Click on a seated player. */
  onPlayerClick?(playerId: string): void;
  /** When set, empty seats are disabled and explain why. */
  seatBlockedReason?: string | null;
  className?: string;
}

/** A top-down preview of the table: the felt on its rail with seats around it. */
export function MiniTable({ table, onSeatClick, onPlayerClick, seatBlockedReason, className }: MiniTableProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const avatar = Math.round(Math.min(52, Math.max(26, width * 0.085)));
  const showNames = width >= 380;
  return (
    <div ref={ref} className={cx('relative aspect-[2/1] w-full', className)}>
      <div className="absolute inset-[9%_7%]">
        <Felt feltId={table.rules.feltId} rail className="h-full w-full" crestScale={0.26} />
      </div>
      <ol aria-label="Seats" className="absolute inset-0">
        {table.seats.map(({ seat, player }) => {
          const pos = seatPosition(seat, table.rules.maxSeats);
          const style = { left: `${pos.left}%`, top: `${pos.top}%` };
          if (player) {
            return (
              <li key={seat} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={style}>
                <button
                  type="button"
                  onClick={() => onPlayerClick?.(player.id)}
                  className="flex flex-col items-center rounded-full"
                  aria-label={`Seat ${seat + 1}: ${player.name}, ${formatChipsShort(player.stack)} chips. View profile`}
                >
                  <Avatar src={player.avatarUrl} name={player.name} frameId={player.cosmetics.frame} size={avatar} />
                  <span
                    className="tabular -mt-1.5 rounded-full bg-walnut-950/90 px-1.5 text-[11px] leading-[16px] font-semibold text-stock ring-1 ring-walnut-600"
                    aria-hidden="true"
                  >
                    {showNames ? `${player.name.slice(0, 10)} ` : ''}
                    <span className="text-brass-light">{formatChipsShort(player.stack)}</span>
                  </span>
                </button>
              </li>
            );
          }
          const disabled = !onSeatClick || !!seatBlockedReason;
          return (
            <li key={seat} className="absolute -translate-x-1/2 -translate-y-1/2" style={style}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSeatClick?.(seat)}
                title={seatBlockedReason ?? `Take seat ${seat + 1}`}
                aria-label={seatBlockedReason ? `Seat ${seat + 1}, empty. ${seatBlockedReason}` : `Seat ${seat + 1}, empty. Take this seat`}
                className={cx(
                  'grid place-items-center rounded-full border-2 border-dashed border-stock/35 bg-walnut-950/50 text-stock/60 transition-colors',
                  !disabled && 'hover:border-brass hover:bg-walnut-900 hover:text-brass',
                  disabled && 'cursor-default',
                )}
                style={{ width: avatar * 0.8, height: avatar * 0.8 }}
              >
                {!disabled ? <PlusIcon size={Math.max(12, avatar * 0.36)} /> : <span className="tabular text-[11px] font-semibold">{seat + 1}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
