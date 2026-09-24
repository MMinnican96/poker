import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyNamed } from './lazy';

const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>;

let consoleError: MockInstance;
beforeEach(() => {
  // React and the boundary both log caught errors; keep the output readable.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('ErrorBoundary', () => {
  it('shows a way forward instead of unmounting the app, and Retry renders the children again', async () => {
    let broken = true;
    function Flaky() {
      if (broken) throw new Error('boom');
      return <p>All good</p>;
    }
    const onReload = vi.fn();
    render(
      <div>
        <p>Header stays</p>
        <ErrorBoundary onReload={onReload}>
          <Flaky />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("This part of the app didn't load");
    expect(screen.getByText('Header stays')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);

    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('re-attempts a lazy chunk that failed to load when Retry is pressed', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ Hello });
    const LazyHello = lazyNamed(load as () => Promise<{ Hello: typeof Hello }>, 'Hello');
    render(
      <ErrorBoundary>
        <Suspense fallback={<p>Loading</p>}>
          <LazyHello name="Ann" />
        </Suspense>
      </ErrorBoundary>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent("This part of the app didn't load");
    // Never retried on its own (an offline client would otherwise spin).
    await new Promise((r) => setTimeout(r, 20));
    expect(load).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Hello Ann')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('can render its failure inside a custom container', async () => {
    function Broken(): never {
      throw new Error('boom');
    }
    render(
      <ErrorBoundary fallback={({ retry }) => <button onClick={retry}>Custom retry</button>}>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Custom retry' })).toBeInTheDocument();
  });
});
