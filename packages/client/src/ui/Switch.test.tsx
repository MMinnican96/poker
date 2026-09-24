import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

describe('Switch', () => {
  it('is a named switch that reports and toggles its state', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Timer ticks" />);
    const sw = screen.getByRole('switch', { name: 'Timer ticks' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing when disabled', async () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="Ticks" disabled />);
    await userEvent.click(screen.getByRole('switch', { name: 'Ticks' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
