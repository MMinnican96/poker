import { createElement, lazy, type ComponentProps, type ComponentType, type FunctionComponent } from 'react';

/** A lazily loaded component whose chunk can also be fetched ahead of time. */
export type Preloadable<C extends ComponentType<any>> = FunctionComponent<ComponentProps<C>> & {
  /** Start loading the chunk (shared with the render-time load; retried after a failure). */
  preload(): Promise<unknown>;
};

/** Lazy components whose load failed, waiting for `retryFailedLoads()`. */
const failed = new Set<() => void>();

/**
 * Let every lazy component whose chunk failed to load try again on its next
 * render. `React.lazy` caches a failure for good, so each one gets a fresh
 * lazy component. Called by an error boundary's Retry — never automatically,
 * so an offline client doesn't retry in a tight loop.
 */
export function retryFailedLoads(): void {
  const resets = [...failed];
  failed.clear();
  for (const reset of resets) reset();
}

/**
 * `React.lazy` for a named export: `lazyNamed(() => import('./Stats'), 'StatsScreen')`.
 * A failed load is forgotten, so the next preload tries again; rendering tries
 * again after `retryFailedLoads()`.
 */
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): Preloadable<M[K]> {
  let pending: Promise<M> | null = null;
  const make = () => lazy(async () => ({ default: (await get())[name] }));
  let current = make();
  const reset = () => { current = make(); };
  const get = (): Promise<M> =>
    (pending ??= load().catch((err: unknown) => {
      pending = null;
      failed.add(reset);
      throw err;
    }));
  function Lazy(props: ComponentProps<M[K]>) {
    return createElement(current, props);
  }
  Lazy.displayName = `Lazy(${String(name)})`;
  return Object.assign(Lazy, { preload: get });
}

/**
 * Fetch chunks once the page has settled, so opening them later is instant.
 * Returns a cancel function (for effect cleanup).
 */
export function preloadWhenIdle(items: readonly { preload(): Promise<unknown> }[], delayMs = 1500): () => void {
  let idle: number | undefined;
  const timer = setTimeout(() => {
    const run = () => {
      for (const item of items) item.preload().catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run, { timeout: 5000 });
    else run();
  }, delayMs);
  return () => {
    clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
  };
}
