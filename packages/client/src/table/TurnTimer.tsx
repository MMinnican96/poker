import { useCountdown } from './hooks';

export interface TurnTimerProps {
  /** Server epoch ms when the turn runs out. */
  endsAt: number;
  /** Full turn length in ms (the table's timer). */
  totalMs: number;
  /** Outer diameter in px. */
  size: number;
  /** Whose turn it is, for the accessible label. */
  name: string;
}

/**
 * A brass ring around the acting player's avatar that drains as their time
 * runs out, turning chip red for the last quarter. Driven by the server's
 * deadline, corrected to the server clock.
 */
export function TurnTimer({ endsAt, totalMs, size, name }: TurnTimerProps) {
  const left = useCountdown(endsAt) ?? 0;
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, left / totalMs)) : 0;
  const stroke = Math.max(3, Math.round(size * 0.07));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const late = frac < 0.25;
  const seconds = Math.ceil(left / 1000);
  return (
    <span
      role="timer"
      aria-label={`${name} has ${seconds} ${seconds === 1 ? 'second' : 'seconds'} left`}
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-walnut-950/70" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className={late ? 'tbl-ring stroke-chip-light' : 'tbl-ring stroke-brass'}
        />
      </svg>
      {seconds <= 10 && (
        <span
          aria-hidden="true"
          className="tabular absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-chip px-1 font-condensed text-[12px] font-bold text-stock ring-2 ring-walnut-950"
        >
          {seconds}
        </span>
      )}
    </span>
  );
}
