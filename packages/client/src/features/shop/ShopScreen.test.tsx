import { describe, it, expect, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_LOADOUT, getItem } from '@poker/shared';
import { ApiError } from '../../app/api';
import { Toaster } from '../../app/Toaster';
import { makeMe, renderWithClient } from '../../test/harness';
import { buyBlockedReason, ShopScreen } from './ShopScreen';

const card = (name: string) => screen.getByRole('article', { name });

describe('ShopScreen', () => {
  it('buys after confirming, and a retry after a failure reuses the same nonce', async () => {
    const purchase = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, "Couldn't reach the server."))
      .mockResolvedValueOnce({ ok: true, balance: 5_000, quantity: 1 });
    renderWithClient(<><ShopScreen /><Toaster /></>, { api: { purchase } });

    await userEvent.click(within(card('Oxblood')).getByRole('button', { name: 'Buy' }));
    const dialog = screen.getByRole('dialog', { name: 'Buy Oxblood?' });
    expect(within(dialog).getByText('Your balance')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('5,000'); // price and balance after
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buy for 5,000' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't reach the server. Try again; you won't be charged twice.");

    await userEvent.click(within(dialog).getByRole('button', { name: 'Buy for 5,000' }));
    expect(await screen.findByRole('dialog', { name: 'Oxblood is yours' })).toBeInTheDocument();
    expect(purchase).toHaveBeenCalledTimes(2);
    const [first, second] = purchase.mock.calls;
    expect(first[0]).toBe('felt-oxblood');
    expect(typeof first[1]).toBe('string');
    expect(second[1]).toBe(first[1]);
  });

  it('moves focus to the new dialog main button after a purchase', async () => {
    const purchase = vi.fn(async () => ({ ok: true as const, balance: 5_000, quantity: 1 }));
    renderWithClient(<><ShopScreen /><Toaster /></>, { api: { purchase } });
    await userEvent.click(within(card('Oxblood')).getByRole('button', { name: 'Buy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Buy for 5,000' }));
    const done = await screen.findByRole('dialog', { name: 'Oxblood is yours' });
    expect(within(done).getByRole('button', { name: 'Equip now' })).toHaveFocus();
  });

  it('uses a fresh nonce for the next purchase after a success', async () => {
    const purchase = vi.fn(async () => ({ ok: true as const, balance: 9_500, quantity: 5 }));
    renderWithClient(<ShopScreen />, { api: { purchase } });
    await userEvent.click(screen.getByRole('tab', { name: 'Throwables' }));
    for (let i = 0; i < 2; i++) {
      await userEvent.click(within(card('Tomatoes')).getByRole('button', { name: 'Buy 5' }));
      await userEvent.click(screen.getByRole('button', { name: 'Buy for 500' }));
      await screen.findByRole('dialog', { name: 'Added 5 tomatoes' });
      await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    }
    expect(purchase.mock.calls[0][1]).not.toBe(purchase.mock.calls[1][1]);
  });

  it('equips an owned item; the pushed me marks it equipped', async () => {
    const equip = vi.fn(async () => ({ ok: true as const, loadout: { ...DEFAULT_LOADOUT, felt: 'felt-oxblood' } }));
    const { store } = renderWithClient(<><ShopScreen /><Toaster /></>, { me: makeMe({ owned: { 'felt-oxblood': 1 } }), api: { equip } });
    await userEvent.click(within(card('Oxblood')).getByRole('button', { name: 'Equip' }));
    expect(equip).toHaveBeenCalledWith('felt', 'felt-oxblood');
    expect(await screen.findByText('Equipped Oxblood')).toBeInTheDocument();
    expect(screen.getByText('Tables you open will use this felt unless you pick another.')).toBeInTheDocument();
    act(() => store.dispatch({ type: 'me', me: makeMe({ owned: { 'felt-oxblood': 1 }, loadout: { ...DEFAULT_LOADOUT, felt: 'felt-oxblood' } }) }));
    expect(within(card('Oxblood')).getByText('Equipped')).toBeInTheDocument();
    expect(within(card('Back room green')).getByRole('button', { name: 'Equip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Default felt: Oxblood/ })).toBeInTheDocument();
  });

  it('explains why an item cannot be bought', () => {
    renderWithClient(<ShopScreen />, { me: makeMe({ balance: 4_000 }) });
    const oxblood = card('Oxblood');
    expect(within(oxblood).getByRole('button', { name: 'Buy' })).toBeDisabled();
    expect(within(oxblood).getByText('Need 1,000 more chips')).toBeInTheDocument();
    const velvet = card('Plum velvet');
    expect(within(velvet).getByText('Unlocks at level 5')).toBeInTheDocument();
    expect(within(velvet).getByRole('button', { name: 'Buy' })).toBeDisabled();
  });

  it('shows consumable quantities owned and emote packs as owned', async () => {
    renderWithClient(<ShopScreen />, { me: makeMe({ owned: { 'throw-tomato': 7, 'emotes-rat': 1 } }) });
    await userEvent.click(screen.getByRole('tab', { name: 'Throwables' }));
    expect(within(card('Tomatoes')).getByText('7 owned')).toBeInTheDocument();
    expect(within(card('Tomatoes')).getByRole('button', { name: 'Buy 5' })).toBeEnabled();
    await userEvent.click(screen.getByRole('tab', { name: 'Emote packs' }));
    expect(within(card('Rat pack')).getByText('Owned')).toBeInTheDocument();
    expect(within(card('Rat pack')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('says what equipping a felt does', () => {
    renderWithClient(<ShopScreen />);
    expect(screen.getByText(/The felt you equip is the default for tables you open/)).toBeInTheDocument();
  });
});

describe('buyBlockedReason', () => {
  it('checks level before balance', () => {
    const velvet = getItem('felt-velvet')!;
    expect(buyBlockedReason(velvet, { balance: 0, level: { level: 1, into: 0, needed: 100 } })).toBe('Unlocks at level 5');
    expect(buyBlockedReason(velvet, { balance: 20_000, level: { level: 5, into: 0, needed: 100 } })).toBeNull();
  });
});
