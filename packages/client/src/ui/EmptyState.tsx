import type { ReactNode } from 'react';
import { RatbagCrest } from '../cosmetics/RatbagCrest';
import { cx } from './cx';

export interface EmptyStateProps {
  title: ReactNode;
  /** One or two sentences: what's missing and what to do about it. */
  body?: ReactNode;
  /** Usually a single Button. */
  action?: ReactNode;
  /** Replaces the default crest artwork. */
  art?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** The "nothing here yet" moment — always point at the next step. */
export function EmptyState({ title, body, action, art, compact, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'gap-2 py-6' : 'gap-3 py-10', className)}>
      <div className={cx('text-walnut-500', compact ? 'size-12' : 'size-20')} aria-hidden="true">
        {art ?? <RatbagCrest className="h-full w-full" lettering={false} />}
      </div>
      <h2 className={cx('text-stock', compact ? 'text-lg' : 'text-2xl')}>{title}</h2>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
