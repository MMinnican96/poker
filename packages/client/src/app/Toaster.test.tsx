import { describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithClient } from '../test/harness';
import { Toaster } from './Toaster';

describe('Toaster', () => {
  it('shows an unlock notice with its emblem next to the text', async () => {
    const { store, container } = renderWithClient(<Toaster />);
    act(() => {
      store.dispatch({ type: 'notice', notice: { id: 'n1', tone: 'good', title: 'Grinder III', body: '+2,500 chips and 200 XP. New title: Regular.', emblem: { achievementId: 'grinder', tier: 3 } } });
      store.dispatch({ type: 'notice', notice: { id: 'n2', tone: 'info', title: 'Plain news' } });
    });
    expect(screen.getByText('Grinder III')).toBeInTheDocument();
    const emblem = await vi.waitFor(() => {
      const el = container.ownerDocument.querySelector('svg[data-emblem="grinder"]');
      if (!el) throw new Error('emblem not loaded yet');
      return el;
    });
    expect(emblem).toHaveAttribute('data-tier', '3');
    expect(emblem.closest('li')).toHaveTextContent('+2,500 chips and 200 XP. New title: Regular.');
    expect(screen.getByText('Plain news').closest('li')!.querySelector('svg[data-emblem]')).toBeNull();
  });
});

describe('Toaster when the emblem chunk fails to load', () => {
  it('still shows the toast text, without art, and keeps the app up', async () => {
    vi.resetModules();
    vi.doMock('../cosmetics/Emblem', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { Toaster: FreshToaster } = await import('./Toaster');
      const { renderWithClient: render } = await import('../test/harness');
      const { store, container } = render(<><p>Table still here</p><FreshToaster /></>);
      act(() => {
        store.dispatch({ type: 'notice', notice: { id: 'n1', tone: 'good', title: 'Grinder III', body: 'New title: Regular.', emblem: { achievementId: 'grinder', tier: 3 } } });
      });
      // The fallback placeholder goes once the load has failed.
      await vi.waitFor(() => {
        if (container.querySelector('li .size-12')) throw new Error('still loading');
      });
      expect(screen.getByText('Grinder III')).toBeInTheDocument();
      expect(screen.getByText('New title: Regular.')).toBeInTheDocument();
      expect(screen.getByText('Table still here')).toBeInTheDocument();
      expect(container.querySelector('svg[data-emblem]')).toBeNull();
    } finally {
      errors.mockRestore();
      vi.doUnmock('../cosmetics/Emblem');
      vi.resetModules();
    }
  });
});
