import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, cx } from '../ui';
import { retryFailedLoads } from './lazy';

/** Where a failure is shown: filling the screen, inside a section, or in a dialog body. */
export type LoadFailedLayout = 'screen' | 'section' | 'inline';

export interface LoadFailedProps {
  onRetry(): void;
  onReload?(): void;
  layout?: LoadFailedLayout;
}

const reloadPage = () => window.location.reload();

/** "Something didn't load" with a way forward: try the same thing again, or reload the activity. */
export function LoadFailed({ onRetry, onReload = reloadPage, layout = 'section' }: LoadFailedProps) {
  return (
    <div
      role="alert"
      className={cx(
        'grid place-items-center p-4 text-center',
        layout === 'screen' && 'h-dvh bg-walnut-900 tex-wood',
        layout === 'section' && 'h-full min-h-60',
        layout === 'inline' && 'min-h-60',
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-3">
        <h2 className={cx(layout === 'inline' ? 'text-ink text-xl' : 'text-stock text-2xl')}>This part of the app didn't load</h2>
        <p className={cx('text-sm', layout === 'inline' ? 'text-ink-soft' : 'text-muted')}>
          Check your connection and try again. If it keeps happening, reload the activity — your chips are safe.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button onClick={onRetry}>Retry</Button>
          <Button variant={layout === 'inline' ? 'brass' : 'ghost'} onClick={onReload}>Reload</Button>
        </div>
      </div>
    </div>
  );
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  layout?: LoadFailedLayout;
  /** Replaces the default failure view (e.g. to keep it inside a dialog). */
  fallback?(actions: { retry(): void; reload(): void }): ReactNode;
  /** Called on Retry, before the children render again (e.g. to start a preload). */
  onRetry?(): void;
  /** Tests: replaces reloading the page. */
  onReload?(): void;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Keeps a failure in one part of the app (typically a lazy chunk that didn't
 * load) from unmounting everything. Retry renders the children again,
 * re-attempting any failed `lazyNamed` import.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[app] a screen failed to render', error, info.componentStack);
  }

  private readonly retry = () => {
    // A chunk that failed to load is fetched again when the children re-render.
    retryFailedLoads();
    this.props.onRetry?.();
    this.setState({ failed: false });
  };

  private readonly reload = () => (this.props.onReload ?? reloadPage)();

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ retry: this.retry, reload: this.reload });
    return <LoadFailed layout={this.props.layout} onRetry={this.retry} onReload={this.reload} />;
  }
}
