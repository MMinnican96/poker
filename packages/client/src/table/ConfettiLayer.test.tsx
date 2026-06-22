import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConfettiLayer } from './ConfettiLayer';

const confettiMock = vi.fn();
vi.mock('canvas-confetti', () => ({ default: (...args: unknown[]) => confettiMock(...args) }));

describe('ConfettiLayer', () => {
  beforeEach(() => confettiMock.mockClear());

  it('fires a gold burst for each winner when winnerIds change', () => {
    // A winner seat element must exist in the DOM for origin lookup.
    const seat = document.createElement('div');
    seat.setAttribute('data-seat-id', 'a');
    document.body.appendChild(seat);

    const { rerender } = render(<ConfettiLayer winnerIds={[]} />);
    expect(confettiMock).not.toHaveBeenCalled();

    rerender(<ConfettiLayer winnerIds={['a']} />);
    expect(confettiMock).toHaveBeenCalledTimes(1);
    const opts = confettiMock.mock.calls[0][0];
    expect(opts).toHaveProperty('origin');
    expect(Array.isArray(opts.colors)).toBe(true);

    document.body.removeChild(seat);
  });

  it('does not re-fire for the same winnerIds', () => {
    const { rerender } = render(<ConfettiLayer winnerIds={['a']} />);
    const count = confettiMock.mock.calls.length;
    rerender(<ConfettiLayer winnerIds={['a']} />);
    expect(confettiMock.mock.calls.length).toBe(count);
  });
});
