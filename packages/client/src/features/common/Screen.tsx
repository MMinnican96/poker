import type { ReactNode } from 'react';
import { Button, EmptyState, RefreshIcon, Spinner, cx } from '../../ui';

export interface ScreenProps {
  /** Page heading (h1). Its id labels the section. */
  title: ReactNode;
  id: string;
  /** One line under the heading. */
  intro?: ReactNode;
  /** Controls on the right of the heading. */
  actions?: ReactNode;
  children: ReactNode;
  /** Max content width (default 5xl). */
  width?: '4xl' | '5xl' | '6xl';
  className?: string;
}

const WIDTH = { '4xl': 'max-w-4xl', '5xl': 'max-w-5xl', '6xl': 'max-w-6xl' } as const;

/** The frame every feature screen sits in: heading row, then content. */
export function Screen({ title, id, intro, actions, children, width = '5xl', className }: ScreenProps) {
  return (
    <section aria-labelledby={id} className={cx('mx-auto flex w-full flex-col gap-5 p-4 sm:p-6 short:gap-3 short:p-3', WIDTH[width], className)}>
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 id={id} className="text-3xl text-stock short:text-2xl">{title}</h1>
          {intro && <p className="mt-1 max-w-prose text-[15px] text-muted short:text-sm">{intro}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** A centred spinner for a first load. */
export function Loading({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center">
      <Spinner size={28} label={label} className="text-brass" />
    </div>
  );
}

/** A failed load: say what failed and offer a retry. */
export function LoadError({ what, error, onRetry, compact }: { what: string; error: string; onRetry(): void; compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      title={`Couldn't load ${what}`}
      body={error}
      action={<Button variant="ghost" size="sm" icon={<RefreshIcon size={16} />} onClick={onRetry}>Try again</Button>}
    />
  );
}
