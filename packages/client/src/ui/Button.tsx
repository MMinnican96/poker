import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'brass' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = chip red; brass = secondary emphasis; ghost = outlined; danger = destructive; quiet = text only. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the width, and disables the button. */
  loading?: boolean;
  /** Icon before the label. */
  icon?: ReactNode;
  fullWidth?: boolean;
}

/*
 * The raised variants sit on a hard bottom edge (like a clay chip's thickness)
 * that compresses when pressed.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-chip text-stock shadow-edge-chip hover:bg-chip-light active:translate-y-[2px] active:shadow-none',
  brass:
    'bg-brass text-ink shadow-edge-brass hover:bg-brass-light active:translate-y-[2px] active:shadow-none',
  danger:
    'bg-walnut-700 text-negative ring-1 ring-inset ring-negative/50 shadow-edge-walnut hover:bg-chip-dark hover:text-stock active:translate-y-[2px] active:shadow-none',
  ghost:
    'bg-transparent text-stock ring-1 ring-inset ring-stock/25 hover:bg-stock/8 hover:ring-stock/45',
  quiet: 'bg-transparent text-stock-dim hover:text-stock hover:bg-stock/8',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-10 px-4 text-[15px] gap-2 rounded-lg',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-lg',
};

/** The app's button. Sentence-case labels that say what happens ("Take a seat"). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        'relative inline-flex select-none items-center justify-center font-semibold whitespace-nowrap',
        'transition-[background-color,color,transform,box-shadow] duration-100',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        isDisabled && 'opacity-45 saturate-50 active:translate-y-0',
        className,
      )}
      {...rest}
    >
      <span className={cx('inline-flex items-center gap-[inherit]', loading && 'invisible')}>
        {icon}
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={size === 'sm' ? 14 : 18} label="Working" />
        </span>
      )}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name (also shown as the native tooltip). */
  label: string;
  children: ReactNode;
  variant?: 'ghost' | 'quiet' | 'brass';
  size?: 'sm' | 'md';
  /** Shows the button as toggled on (aria-pressed). */
  pressed?: boolean;
}

/** Square icon-only button with a required accessible label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, variant = 'quiet', size = 'md', pressed, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-40',
        size === 'sm' ? 'size-8' : 'size-10',
        variant === 'ghost' && 'text-stock ring-1 ring-inset ring-stock/25 hover:bg-stock/8',
        variant === 'quiet' && 'text-stock-dim hover:bg-stock/8 hover:text-stock',
        variant === 'brass' && 'bg-brass text-ink shadow-edge-brass hover:bg-brass-light',
        pressed && 'bg-stock/12 text-stock',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
