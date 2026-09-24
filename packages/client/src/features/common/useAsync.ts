import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  /** Message from the last failed load (cleared on the next success). */
  error: string | null;
  /** The raw error behind `error` (e.g. an ApiError with a status). */
  loadError: unknown;
  /** True while a request is in flight (the previous `data` is kept meanwhile). */
  loading: boolean;
  reload(): void;
  /** Replace the data locally (optimistic updates after a mutation). */
  setData(update: (prev: T | undefined) => T | undefined): void;
}

export function errorText(err: unknown, fallback = 'Something went wrong.'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Load data with `fn` whenever `deps` change. Stale responses are dropped, and
 * the previous data stays visible while a refetch is running.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    fnRef.current().then(
      (value) => {
        if (id !== seq.current) return;
        setDataState(value);
        setError(null);
        setLoadError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (id !== seq.current) return;
        setError(errorText(err));
        setLoadError(err);
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => () => { seq.current++; }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((update: (prev: T | undefined) => T | undefined) => setDataState(update), []);
  return { data, error, loadError, loading, reload, setData };
}
