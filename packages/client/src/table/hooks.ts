import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Ack } from '@poker/shared';
import { useStore } from '../app/client';

/** Fallback size before layout (and in jsdom, which has no layout). */
export const DEFAULT_STAGE = { width: 1000, height: 560 };

/** Width and height of an element, kept current with a ResizeObserver. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(DEFAULT_STAGE);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (w: number, h: number) => {
      if (w > 0 && h > 0) setSize((s) => (Math.abs(s.width - w) < 0.5 && Math.abs(s.height - h) < 0.5 ? s : { width: w, height: h }));
    };
    const r = el.getBoundingClientRect();
    read(r.width, r.height);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const c = entries[0].contentRect;
      read(c.width, c.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/**
 * Milliseconds left until `deadline` (server epoch ms), corrected to the
 * server's clock and updated ~10 times a second. Null without a deadline.
 */
export function useCountdown(deadline: number | null): number | null {
  const store = useStore();
  const read = useCallback(() => (deadline === null ? null : Math.max(0, deadline - store.serverNow())), [deadline, store]);
  const [left, setLeft] = useState(read);
  useEffect(() => {
    setLeft(read());
    if (deadline === null) return;
    const t = setInterval(() => setLeft(read()), 100);
    return () => clearInterval(t);
  }, [deadline, read]);
  return left;
}

/**
 * Run a table command and show its error as a toast. Returns [run, busyKey]:
 * `run(key, fn)` marks `key` busy while the command is in flight.
 */
export function useRun(): [(key: string, fn: () => Promise<Ack>) => Promise<Ack>, string | null] {
  const store = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(
    async (key: string, fn: () => Promise<Ack>) => {
      setBusy(key);
      const ack = await fn();
      if (mounted.current) setBusy((b) => (b === key ? null : b));
      if (!ack.ok) store.notify({ tone: 'bad', title: ack.error });
      return ack;
    },
    [store],
  );
  return [run, busy];
}

/** Close a popover on outside pointer-down or Escape. */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void, ignore?: RefObject<HTMLElement | null>): void {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || ignore?.current?.contains(t)) return;
      cb.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cb.current();
      }
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, ref, ignore]);
}
