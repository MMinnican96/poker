import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChipAmount } from './ChipAmount';

const visible = (container: HTMLElement) => container.querySelector('span[aria-hidden="true"]')?.textContent;

describe('ChipAmount', () => {
  it('formats with thousands separators, tabular figures, and announces the amount', () => {
    const { container } = render(<ChipAmount value={12345} />);
    expect(visible(container)).toBe('12,345');
    expect(screen.getByText('12,345 chips')).toHaveClass('sr-only');
    expect(container.firstElementChild).toHaveClass('tabular');
  });

  it('abbreviates in short mode but keeps the exact amount for screen readers', () => {
    const { container } = render(<ChipAmount value={12345} short />);
    expect(visible(container)).toBe('12.3k');
    expect(screen.getByText('12,345 chips')).toBeInTheDocument();
  });

  it('keeps amounts under 10,000 exact in short mode', () => {
    const { container } = render(<ChipAmount value={9500} short />);
    expect(visible(container)).toBe('9,500');
  });

  it('signs and colours net results', () => {
    const { container, rerender } = render(<ChipAmount value={1200} signed />);
    expect(visible(container)).toBe('+1,200');
    expect(container.firstElementChild).toHaveClass('text-positive');
    rerender(<ChipAmount value={-300} signed />);
    expect(visible(container)).toBe('-300');
    expect(container.firstElementChild).toHaveClass('text-negative');
  });

  it('can hide the chip glyph', () => {
    const { container } = render(<ChipAmount value={5} bare />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
