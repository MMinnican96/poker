import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
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

/**
 * Arrow-key focus for a `role="menu"`: Up/Down (and Left/Right) move between
 * its enabled `menuitem`s, wrapping; Home/End jump to the ends. With
 * `columns` > 1 the items are a grid: Left/Right step by one, Up/Down by a row.
 */
export function useMenuKeys(ref: RefObject<HTMLElement | null>, columns = 1): (e: ReactKeyboardEvent) => void {
  return useCallback(
    (e: ReactKeyboardEvent) => {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter(
        (el) => !(el as HTMLButtonElement).disabled,
      );
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const n = items.length;
      const step: Record<string, number> = columns > 1
        ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }
        : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 };
      let next: number | null = null;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = n - 1;
      else if (e.key in step) {
        const d = step[e.key];
        if (at < 0) next = d > 0 ? 0 : n - 1;
        else if (Math.abs(d) === 1) next = (at + d + n) % n;
        else next = Math.max(0, Math.min(n - 1, at + d));
      }
      if (next === null) return;
      e.preventDefault();
      items[next].focus();
    },
    [ref, columns],
  );
}
