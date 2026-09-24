import { useMemo } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bucketSize, useElementSize } from './hooks';

describe('bucketSize', () => {
  it('rounds down to whole steps so the layout never overflows the element', () => {
    expect(bucketSize(390.4, 711.9)).toEqual({ width: 384, height: 704 });
    expect(bucketSize(400, 800)).toEqual({ width: 400, height: 800 });
    expect(bucketSize(7.9, 20, 8)).toEqual({ width: 0, height: 16 });
    expect(bucketSize(101, 99, 10)).toEqual({ width: 100, height: 90 });
  });
});

describe('useElementSize', () => {
  const original = globalThis.ResizeObserver;
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  it('only yields a new size (and a new layout) when the size crosses a bucket', () => {
    let fire: (w: number, h: number) => void = () => undefined;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        fire = (width, height) => cb([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const renders = vi.fn();
    function Probe() {
      const [ref, size] = useElementSize<HTMLDivElement>();
      // Stands in for the table layout, which is memoised on the size.
      useMemo(() => renders({ width: size.width, height: size.height }), [size.width, size.height]);
      return <div ref={ref} />;
    }
    render(<Probe />);
    act(() => fire(390.2, 700.6));
    expect(renders).toHaveBeenLastCalledWith({ width: 384, height: 696 });
    const count = renders.mock.calls.length;
    // Sub-pixel and few-pixel changes inside the same bucket: no new render.
    act(() => fire(391.7, 701.1));
    act(() => fire(390.9, 703.9));
    expect(renders.mock.calls.length).toBe(count);
    act(() => fire(392.1, 704));
    expect(renders).toHaveBeenLastCalledWith({ width: 392, height: 704 });
  });
});
