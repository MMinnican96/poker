import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_RULES } from '@poker/shared';
import { buyInBounds, defaultBuyIn, seatBlockedReason, TakeSeatDialog } from './TakeSeatDialog';

const rules = { ...DEFAULT_RULES, maxSeats: 4, minBuyIn: 1000, maxBuyIn: 5000, smallBlind: 25, bigBlind: 50 };

describe('buy-in bounds', () => {
  it('caps the maximum at your bankroll', () => {
    expect(buyInBounds(rules, 10_000)).toEqual({ min: 1000, max: 5000, canAfford: true });
    expect(buyInBounds(rules, 3200)).toEqual({ min: 1000, max: 3200, canAfford: true });
    expect(buyInBounds(rules, 900)).toMatchObject({ canAfford: false });
  });

  it('defaults to 100 big blinds within the bounds', () => {
    expect(defaultBuyIn(rules, 10_000)).toBe(5000);
    expect(defaultBuyIn(rules, 3200)).toBe(3200);
    expect(defaultBuyIn({ ...rules, maxBuyIn: 20_000 }, 50_000)).toBe(5000);
  });

  it('explains why you cannot sit', () => {
    expect(seatBlockedReason({ openSeats: 0, minBuyIn: 1000, balance: 5000 })).toBe('Every seat is taken.');
    expect(seatBlockedReason({ openSeats: 2, minBuyIn: 1000, balance: 400 })).toBe('You need 1,000 chips to buy in. You have 400.');
    expect(seatBlockedReason({ openSeats: 2, minBuyIn: 1000, balance: 4000 })).toBeNull();
  });
});

describe('<TakeSeatDialog>', () => {
  it('limits the buy-in to [min, min(max, balance)] and confirms seat + amount', async () => {
    const onConfirm = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    render(<TakeSeatDialog open onClose={onClose} rules={rules} openSeats={[1, 3]} balance={3000} initialSeat={3} onConfirm={onConfirm} />);
    const slider = screen.getByRole('slider', { name: 'Buy-in slider' });
    expect(slider).toHaveAttribute('min', '1000');
    expect(slider).toHaveAttribute('max', '3000');
    expect(screen.getByText(/that's your whole bankroll/)).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: 'Buy-in' });
    await userEvent.clear(input);
    await userEvent.type(input, '100{Enter}');
    expect(input).toHaveValue('1,000');

    expect(screen.getByRole('radio', { name: 'Seat 4' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Seat 1, taken' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Sit down with 1,000' }));
    expect(onConfirm).toHaveBeenCalledWith(3, 1000);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the server refusal inline', async () => {
    const onConfirm = vi.fn(async () => ({ ok: false as const, error: 'That seat is taken.' }));
    render(<TakeSeatDialog open onClose={() => {}} rules={rules} openSeats={[0]} balance={9000} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: /Sit down with/ }));
    expect(await screen.findByText('That seat is taken.')).toBeInTheDocument();
  });

  it("disables sitting down when you can't afford the minimum", () => {
    render(<TakeSeatDialog open onClose={() => {}} rules={rules} openSeats={[0]} balance={500} onConfirm={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('You need 1,000 chips to buy in. You have 500.');
    expect(screen.getByRole('button', { name: /Sit down with/ })).toBeDisabled();
  });
});
