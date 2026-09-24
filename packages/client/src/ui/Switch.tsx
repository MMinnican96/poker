import { cx } from './cx';

export interface SwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  /** Accessible name (or use `labelledBy`). */
  label?: string;
  /** Id of the element that names the switch. */
  labelledBy?: string;
  /** Id of the element that describes it. */
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}

/** An on/off setting that applies straight away: a brass track with a card-stock knob. */
export function Switch({ checked, onChange, label, labelledBy, describedBy, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={label ? undefined : labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full ring-1 ring-inset transition-colors disabled:opacity-45',
        checked ? 'bg-brass ring-brass-light' : 'bg-walnut-950 ring-walnut-600',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-5 rounded-full shadow-card transition-transform',
          checked ? 'translate-x-[22px] bg-stock' : 'translate-x-0.5 bg-stock-dim',
        )}
      />
    </button>
  );
}
