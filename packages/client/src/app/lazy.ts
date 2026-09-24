import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** A `React.lazy` component whose chunk can also be fetched ahead of time. */
export type Preloadable<C extends ComponentType<any>> = LazyExoticComponent<C> & {
  /** Start loading the chunk (shared with the render-time load; retried after a failure). */
  preload(): Promise<unknown>;
};

/**
 * `React.lazy` for a named export: `lazyNamed(() => import('./Stats'), 'StatsScreen')`.
 * A failed load is forgotten, so the next render or preload tries again.
 */
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): Preloadable<M[K]> {
  let pending: Promise<M> | null = null;
  const get = (): Promise<M> =>
    (pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    }));
  return Object.assign(lazy(async () => ({ default: (await get())[name] })), { preload: get });
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
