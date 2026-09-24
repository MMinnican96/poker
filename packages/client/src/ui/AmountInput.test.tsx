import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AmountInput, clampAmount } from './AmountInput';

describe('clampAmount', () => {
  it('clamps to the range and snaps to the step from min', () => {
    expect(clampAmount(50, 100, 1000, 25)).toBe(100);
    expect(clampAmount(5000, 100, 1000, 25)).toBe(1000);
    expect(clampAmount(212, 100, 1000, 25)).toBe(200);
    expect(clampAmount(213, 100, 1000, 25)).toBe(225);
    expect(clampAmount(Number.NaN, 100, 1000)).toBe(100);
  });

  it('always allows the exact max even when off-step', () => {
    expect(clampAmount(990, 100, 990, 25)).toBe(990);
  });
});

function Controlled({ onChange }: { onChange: (n: number) => void }) {
  const [v, setV] = useState(1000);
  return (
    <AmountInput
      label="Buy-in"
      value={v}
      min={1000}
      max={4000}
      step={50}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
      presets={[{ label: 'Maximum', value: 4000 }]}
    />
  );
}

describe('AmountInput', () => {
  it('clamps typed amounts on blur and shows them formatted', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Buy-in' });
    expect(input).toHaveValue('1,000');
    await userEvent.clear(input);
    await userEvent.type(input, '99999');
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(4000);
    expect(input).toHaveValue('4,000');
  });

  it('commits on Enter and ignores stray characters', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Buy-in' });
    await userEvent.clear(input);
    await userEvent.type(input, '2,5x00{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(2500);
  });

  it('quick picks set the amount and move the slider', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Maximum' }));
    expect(onChange).toHaveBeenLastCalledWith(4000);
    expect(screen.getByRole('slider', { name: 'Buy-in slider' })).toHaveValue('4000');
  });
});

describe('AmountInput in a Field', () => {
  it('names its slider after the field label', async () => {
    const { Field } = await import('./Field');
    render(
      <Field label="Minimum buy-in">
        <AmountInput value={500} onChange={() => {}} min={100} max={1000} step={50} />
      </Field>,
    );
    expect(screen.getByRole('slider', { name: 'Minimum buy-in' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Minimum buy-in' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Amount slider' })).toBeNull();
  });
});
