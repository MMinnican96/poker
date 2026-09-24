import type { ReactNode } from 'react';
import { cx } from './cx';

export interface PlacardProps {
  /** Engraved heading, e.g. the table name. */
  title?: ReactNode;
  /** Small line under the title. */
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const Screw = ({ className }: { className: string }) => (
  <span aria-hidden="true" className={cx('absolute size-2 rounded-full bg-brass-dark shadow-[inset_0_1px_0_var(--color-brass-light)]', className)}>
    <span className="absolute top-1/2 left-[1px] h-px w-1.5 -translate-y-1/2 rotate-45 bg-ink/60" />
  </span>
);

/** A screwed-on brass sign — the table limits plate. Fill it with <PlacardRow>s. */
export function Placard({ title, subtitle, children, className }: PlacardProps) {
  return (
    <div
      className={cx(
        'relative rounded-md bg-brass px-5 py-4 text-ink short:px-4 short:py-2.5',
        'shadow-placard',
        className,
      )}
    >
      <div className="tex-grain pointer-events-none absolute inset-0 rounded-md opacity-60" aria-hidden="true" />
      <Screw className="top-1.5 left-1.5" />
      <Screw className="top-1.5 right-1.5" />
      <Screw className="bottom-1.5 left-1.5" />
      <Screw className="right-1.5 bottom-1.5" />
      <div className="relative">
        {title && <h3 className="text-center text-lg leading-tight text-ink short:text-base">{title}</h3>}
        {subtitle && <p className="mt-0.5 text-center text-[13px] font-semibold text-ink-brass">{subtitle}</p>}
        {(title || subtitle) && children && <div className="mx-auto my-2.5 h-px short:my-1.5 w-full bg-ink/25" aria-hidden="true" />}
        {children && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 short:gap-y-0">{children}</dl>}
      </div>
    </div>
  );
}

/** One engraved line on a Placard: label on the left, value on the right. */
export function PlacardRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <>
      <dt className="font-condensed text-[15px] font-semibold text-ink-brass short:text-[14px]">{label}</dt>
      <dd className="tabular text-right font-condensed text-[15px] font-bold text-ink short:text-[14px]">{children}</dd>
    </>
  );
}
