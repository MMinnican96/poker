import { createContext, forwardRef, useContext, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

interface FieldIds { inputId: string; labelId: string; hintId?: string; errorId?: string; invalid: boolean }
const FieldContext = createContext<FieldIds | null>(null);

/** Ids of the enclosing <Field>, for wiring custom controls. */
export const useField = () => useContext(FieldContext);

export interface FieldProps {
  label: ReactNode;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Error text; marks the control invalid. */
  error?: ReactNode;
  /** Value shown at the right of the label row (e.g. the current slider value). */
  aside?: ReactNode;
  /** Render the label as a fieldset legend (for radio groups / segmented controls). */
  group?: boolean;
  children: ReactNode;
  className?: string;
}

/** Label + control + hint/error. Controls inside pick up ids via `useField()`. */
export function Field({ label, hint, error, aside, group, children, className }: FieldProps) {
  const base = useId();
  const ids: FieldIds = {
    inputId: `${base}-input`,
    labelId: `${base}-label`,
    hintId: hint ? `${base}-hint` : undefined,
    errorId: error ? `${base}-error` : undefined,
    invalid: !!error,
  };
  const labelRow = group ? (
    <>
      <legend className="float-left mb-1.5 text-sm font-semibold text-stock-dim">{label}</legend>
      {aside && <span className="float-right mb-1.5 text-sm text-stock">{aside}</span>}
      <div className="clear-both" />
    </>
  ) : (
    <span className="mb-1.5 flex items-baseline justify-between gap-2">
      <label id={ids.labelId} htmlFor={ids.inputId} className="text-sm font-semibold text-stock-dim">{label}</label>
      {aside && <span className="text-sm text-stock">{aside}</span>}
    </span>
  );
  const body = (
    <FieldContext.Provider value={ids}>
      {labelRow}
      {children}
      {hint && !error && <p id={ids.hintId} className="mt-1 text-[13px] text-muted">{hint}</p>}
      {error && <p id={ids.errorId} role="alert" className="mt-1 text-[13px] font-medium text-negative">{error}</p>}
    </FieldContext.Provider>
  );
  return group ? <fieldset className={cx('min-w-0', className)}>{body}</fieldset> : <div className={cx('min-w-0', className)}>{body}</div>;
}

/** Props that connect a control to its <Field>. */
export function useFieldControlProps() {
  const f = useField();
  if (!f) return {};
  const describedBy = [f.errorId, f.hintId].filter(Boolean).join(' ') || undefined;
  return { id: f.inputId, 'aria-describedby': describedBy, 'aria-invalid': f.invalid || undefined };
}

/** A text input in a walnut well. Use inside <Field>. */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  const wired = useFieldControlProps();
  return <input ref={ref} className={cx('input', className)} {...wired} {...rest} />;
});
