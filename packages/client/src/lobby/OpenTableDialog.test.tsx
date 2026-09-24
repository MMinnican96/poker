import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BLIND_LEVELS, DEFAULT_LOADOUT } from '@poker/shared';
import { defaultTableForm, OpenTableDialog, validateTableForm, withBlinds } from './OpenTableDialog';

const rich = { balance: 100_000, owned: {} as Record<string, number> };

describe('validateTableForm', () => {
  it('accepts the defaults (20–100 big blinds)', () => {
    const form = defaultTableForm();
    const { errors, rules } = validateTableForm(form, rich);
    expect(errors).toEqual({});
    expect(rules).toMatchObject({ name: 'The back room', smallBlind: 25, bigBlind: 50, minBuyIn: 1000, maxBuyIn: 5000 });
  });

  it('flags each field that breaks a rule', () => {
    const form = { ...defaultTableForm(), name: '   ', ante: 30, minBuyIn: 400, maxBuyIn: 30_000, maxSeats: 10, turnSeconds: 33, feltId: 'felt-oxblood' };
    const { errors, rules } = validateTableForm(form, rich);
    expect(rules).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['ante', 'feltId', 'maxBuyIn', 'maxSeats', 'minBuyIn', 'name', 'turnSeconds']);
    expect(errors.minBuyIn).toMatch(/at least 10 big blinds/);
    expect(errors.maxBuyIn).toMatch(/at most 500 big blinds/);
  });

  it('requires max buy-in ≥ min buy-in', () => {
    const { errors } = validateTableForm({ ...defaultTableForm(), minBuyIn: 3000, maxBuyIn: 2000 }, rich);
    expect(errors.maxBuyIn).toBe('The maximum buy-in must be at least the minimum.');
  });

  it("requires the host to afford the minimum buy-in (the server's check)", () => {
    const { errors } = validateTableForm(defaultTableForm(), { balance: 800, owned: {} });
    expect(errors.minBuyIn).toMatch(/You need 1,000 chips/);
  });

  it('accepts owned paid felts', () => {
    const { errors } = validateTableForm({ ...defaultTableForm(), feltId: 'felt-oxblood' }, { balance: 10_000, owned: { 'felt-oxblood': 1 } });
    expect(errors).toEqual({});
  });

  it('new blinds reset buy-ins to 20/100 big blinds and cap the ante', () => {
    const form = { ...defaultTableForm(), ante: 25 };
    const i = BLIND_LEVELS.findIndex(([s]) => s === 5);
    expect(withBlinds(form, i)).toMatchObject({ minBuyIn: 200, maxBuyIn: 1000, ante: 5 });
  });
});

describe('<OpenTableDialog>', () => {
  const me = { balance: 10_000, owned: {}, loadout: DEFAULT_LOADOUT };

  it('submits the validated rules', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    render(<OpenTableDialog open onClose={onClose} me={me} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('radio', { name: '6' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open the table' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ maxSeats: 6, smallBlind: 25, bigBlind: 50, feltId: 'felt-classic' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows field errors inline and does not submit', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    render(<OpenTableDialog open onClose={() => {}} me={me} onSubmit={onSubmit} />);
    await userEvent.clear(screen.getByRole('textbox', { name: 'Table name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open the table' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Give the table a name.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Table name' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the server error when the server refuses', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false as const, error: 'A table is already open. Join it from the lobby.' }));
    const onClose = vi.fn();
    render(<OpenTableDialog open onClose={onClose} me={me} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the table' }));
    expect(await screen.findByText('A table is already open. Join it from the lobby.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('only offers felts the player owns', () => {
    render(<OpenTableDialog open onClose={() => {}} me={{ ...me, owned: { 'felt-midnight': 1 } }} onSubmit={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Back room green' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Midnight' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Oxblood' })).not.toBeInTheDocument();
  });

  it('warns up front when the host cannot afford the minimum buy-in', () => {
    render(<OpenTableDialog open onClose={() => {}} me={{ ...me, balance: 500 }} onSubmit={vi.fn()} />);
    expect(screen.getByText(/You need 1,000 chips to sit at your own table/)).toBeInTheDocument();
  });
});
