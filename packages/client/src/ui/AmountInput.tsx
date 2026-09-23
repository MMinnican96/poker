import { useEffect, useState, type CSSProperties } from 'react';
import { formatChips } from '@poker/shared';
import { cx } from './cx';
import { useFieldControlProps } from './Field';
import { ChipGlyph } from './ChipAmount';

/** Clamp to [min, max] and snap to `step` measured from `min` (max always allowed). */
export function clampAmount(n: number, min: number, max: number, step = 1): number {
  if (!Number.isFinite(n)) return min;
  if (n >= max) return max;
  if (n <= min) return min;
  const snapped = min + Math.round((n - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

export interface SliderProps {
  value: number;
  onChange(value: number): void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  /** Accessible name when not inside a <Field>. */
  label?: string;
  /** Spoken value, e.g. "30 seconds". */
  valueText?: (value: number) => string;
  className?: string;
}

/** A range slider with a brass fill and a clay-chip thumb. */
export function Slider({ value, onChange, min, max, step = 1, disabled, label, valueText, className }: SliderProps) {
  const wired = useFieldControlProps();
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 100;
  return (
    <input
      type="range"
      className={cx('range', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={valueText?.(value)}
      style={{ '--fill': `${fill}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      {...(label ? {} : wired)}
    />
  );
}

export interface AmountInputProps {
  value: number;
  onChange(value: number): void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  /** Accessible name for both controls when not inside a <Field>. */
  label?: string;
  /** Quick-pick buttons, e.g. [{ label: 'Min', value: min }, { label: 'Max', value: max }]. */
  presets?: { label: string; value: number }[];
  className?: string;
}

/**
 * A chip amount picker: slider + typed number (clamped and snapped on blur or
 * Enter) + optional quick picks. Keeps `value` within [min, max].
 */
export function AmountInput({ value, onChange, min, max, step = 1, disabled, label, presets, className }: AmountInputProps) {
  const wired = useFieldControlProps();
  const [text, setText] = useState(formatChips(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(formatChips(value));
  }, [value, editing]);

  const commit = () => {
    const digits = text.replace(/[^0-9.]/g, '');
    const n = clampAmount(digits === '' ? value : Number(digits), min, max, step);
    setText(formatChips(n));
    if (n !== value) onChange(n);
  };

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-3">
        <Slider value={value} onChange={onChange} min={min} max={max} step={step} disabled={disabled} label={label ? `${label} slider` : 'Amount slider'} className="flex-1" />
        <label className="relative w-32 shrink-0">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"><ChipGlyph size={14} /></span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="input tabular pl-8 text-right"
            value={text}
            disabled={disabled}
            aria-label={label}
            onFocus={() => setEditing(true)}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              setEditing(false);
              commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const n = clampAmount(value + (e.key === 'ArrowUp' ? step : -step), min, max, step);
                setText(formatChips(n));
                onChange(n);
              }
            }}
            {...(label ? {} : wired)}
          />
        </label>
      </div>
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={disabled || p.value < min || p.value > max}
              onClick={() => onChange(clampAmount(p.value, min, max, step))}
              className="h-7 rounded-md px-2.5 text-[13px] font-semibold text-stock-dim ring-1 ring-inset ring-walnut-600 hover:text-stock hover:ring-walnut-500 disabled:opacity-35"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
