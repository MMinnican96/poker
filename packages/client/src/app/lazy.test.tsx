import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { lazyNamed, preloadWhenIdle } from './lazy';

const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>;

describe('lazyNamed', () => {
  it('renders a named export once its module loads, sharing the load with preload()', async () => {
    const load = vi.fn(async () => ({ Hello }));
    const LazyHello = lazyNamed(load, 'Hello');
    const early = LazyHello.preload();
    render(
      <Suspense fallback={<p>Loading</p>}>
        <LazyHello name="Ann" />
      </Suspense>,
    );
    expect(await screen.findByText('Hello Ann')).toBeInTheDocument();
    await early;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed load so the next attempt retries', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ Hello });
    const LazyHello = lazyNamed(load as () => Promise<{ Hello: typeof Hello }>, 'Hello');
    await expect(LazyHello.preload()).rejects.toThrow('offline');
    await expect(LazyHello.preload()).resolves.toEqual({ Hello });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('preloadWhenIdle', () => {
  it('preloads after the delay, and not at all when cancelled first', () => {
    vi.useFakeTimers();
    try {
      const a = { preload: vi.fn(async () => undefined) };
      const b = { preload: vi.fn(async () => undefined) };
      preloadWhenIdle([a], 100);
      const cancel = preloadWhenIdle([b], 100);
      cancel();
      vi.advanceTimersByTime(100);
      expect(a.preload).toHaveBeenCalledTimes(1);
      expect(b.preload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
