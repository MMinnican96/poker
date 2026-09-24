import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_LOADOUT } from '@poker/shared';
import { Toaster } from '../../app/Toaster';
import { makeMe, renderWithClient } from '../../test/harness';
import { makeAchievements } from '../fixtures';
import { standings } from './achievements';
import { CabinetTab } from './CabinetTab';

const at = (tier: number) => ({ progress: 1, tier, unlocks: [{ tier, unlockedAt: '2026-09-20T12:00:00.000Z' }] });
/** Six unlocked emblems: one more than the shelf holds. */
const SIX = makeAchievements({
  grinder: at(3), 'pot-taker': at(5), 'big-fish': at(1), royalty: at(1), moby: at(1), 'fresh-cheese': at(1),
});

function shelfNames() {
  return [...screen.getByRole('list', { name: 'Showcase' }).querySelectorAll('li')].map((li) => li.textContent);
}

describe('CabinetTab', () => {
  it('shows the automatic pick until you choose, with counts', () => {
    renderWithClient(<CabinetTab all={standings(SIX)} showcase={[]} onShowcaseSaved={() => {}} />);
    expect(screen.getByText('6 of 45 emblems unlocked.')).toBeInTheDocument();
    expect(screen.getByText(/Showing your best emblems until you pick your own/)).toBeInTheDocument();
    // Feats by rarity, then career emblems by tier.
    expect(shelfNames()).toEqual([
      'Royalty, legendary featRoyalty', 'Moby, epic featMoby', 'Fresh cheese, common featFresh cheese',
      'Pot taker V, diamondPot taker V', 'Grinder III, goldGrinder III',
    ]);
  });

  it('with nothing unlocked, says where emblems come from and disables editing', () => {
    renderWithClient(<CabinetTab all={standings(makeAchievements())} showcase={[]} onShowcaseSaved={() => {}} />);
    expect(screen.getByText('0 of 45 emblems unlocked.')).toBeInTheDocument();
    expect(screen.getByText('Emblems come from career challenges and feats.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit showcase' })).toBeDisabled();
  });

  it('edits the showcase: choose in order, stop at five, reorder, save', async () => {
    const setShowcase = vi.fn(async (ids: string[]) => ({ ok: true as const, showcase: ids }));
    const onShowcaseSaved = vi.fn();
    renderWithClient(<><CabinetTab all={standings(SIX)} showcase={['grinder']} onShowcaseSaved={onShowcaseSaved} /><Toaster /></>, { api: { setShowcase } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit showcase' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit showcase' });
    const picker = within(dialog).getByRole('list', { name: 'Unlocked emblems' });
    expect(within(picker).getByRole('button', { name: 'Grinder III, gold' })).toHaveAttribute('aria-pressed', 'true');

    for (const name of ['Royalty, legendary feat', 'Moby, epic feat', 'Pot taker V, diamond', 'Big fish I, bronze']) {
      await userEvent.click(within(picker).getByRole('button', { name }));
    }
    expect(within(dialog).getByText('Your shelf holds 5. Remove one to add another.')).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: 'Fresh cheese, common feat' })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Move Royalty right' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Big fish I' }));
    await userEvent.click(within(picker).getByRole('button', { name: 'Fresh cheese, common feat' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save showcase' }));

    const ids = ['grinder', 'moby', 'royalty', 'pot-taker', 'fresh-cheese'];
    expect(setShowcase).toHaveBeenCalledWith(ids);
    expect(await screen.findByText('Trophy cabinet saved')).toBeInTheDocument();
    expect(onShowcaseSaved).toHaveBeenCalledWith(ids);
  });

  it('keeps the dialog open and toasts the reason when saving is refused', async () => {
    const setShowcase = vi.fn(async () => ({ ok: false as const, error: "You haven't unlocked that emblem yet." }));
    const onShowcaseSaved = vi.fn();
    renderWithClient(<><CabinetTab all={standings(SIX)} showcase={[]} onShowcaseSaved={onShowcaseSaved} /><Toaster /></>, { api: { setShowcase } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit showcase' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit showcase' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Royalty, legendary feat' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save showcase' }));
    expect(await screen.findByText("Couldn't save your trophy cabinet")).toBeInTheDocument();
    expect(screen.getByText("You haven't unlocked that emblem yet.")).toBeInTheDocument();
    expect(onShowcaseSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit showcase' })).toBeInTheDocument();
  });

  it('lists owned and earned titles in groups, marks the equipped one, and equips an earned title', async () => {
    const equip = vi.fn(async () => ({ ok: true as const, loadout: { ...DEFAULT_LOADOUT, title: 'ach:grinder:3' } }));
    renderWithClient(<><CabinetTab all={standings(SIX)} showcase={[]} onShowcaseSaved={() => {}} /><Toaster /></>, {
      me: makeMe({ owned: { 'title-nit': 1 }, loadout: { ...DEFAULT_LOADOUT, title: 'title-nit' } }),
      api: { equip },
    });
    const shop = screen.getByRole('group', { name: 'From the shop' });
    expect(within(shop).getByRole('button', { name: 'No title' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(shop).getByRole('button', { name: 'Nit' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(shop).getByText('Equipped')).toBeInTheDocument();

    const career = screen.getByRole('group', { name: 'Career challenges' });
    // Grinder III earns "Regular"; pot taker V earns both of its titles; big fish I earns none yet.
    expect(within(career).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Regular (Grinder III)', 'Pot taker (Pot taker III)', 'The bank (Pot taker V)',
    ]);
    const feats = screen.getByRole('group', { name: 'Feats' });
    expect(within(feats).getByRole('button', { name: 'Royalty (Royalty)' })).toBeInTheDocument();

    await userEvent.click(within(career).getByRole('button', { name: 'Regular (Grinder III)' }));
    expect(equip).toHaveBeenCalledWith('title', 'ach:grinder:3');
    expect(await screen.findByText('Now wearing Regular')).toBeInTheDocument();
  });

  it('toasts when equipping a title fails, and removes a title with its own wording', async () => {
    const equip = vi.fn(async (_c: string, id: string | null) =>
      id === 'ach:grinder:3' ? { ok: false as const, error: 'Not yours yet.' } : { ok: true as const, loadout: { ...DEFAULT_LOADOUT, title: null } });
    renderWithClient(<><CabinetTab all={standings(SIX)} showcase={[]} onShowcaseSaved={() => {}} /><Toaster /></>, {
      me: makeMe({ loadout: { ...DEFAULT_LOADOUT, title: 'ach:pot-taker:3' } }),
      api: { equip: equip as never },
    });
    await userEvent.click(within(screen.getByRole('group', { name: 'Career challenges' })).getByRole('button', { name: 'Regular (Grinder III)' }));
    expect(await screen.findByText("Couldn't equip Regular")).toBeInTheDocument();
    expect(screen.getByText('Not yours yet.')).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('group', { name: 'From the shop' })).getByRole('button', { name: 'No title' }));
    expect(equip).toHaveBeenLastCalledWith('title', expect.anything());
    expect(await screen.findByText('Title removed')).toBeInTheDocument();
  });

  it('says "Couldn\'t remove your title" when taking a title off fails', async () => {
    const equip = vi.fn(async () => ({ ok: false as const, error: 'Try again in a moment.' }));
    renderWithClient(<><CabinetTab all={standings(SIX)} showcase={[]} onShowcaseSaved={() => {}} /><Toaster /></>, {
      me: makeMe({ loadout: { ...DEFAULT_LOADOUT, title: 'ach:grinder:3' } }),
      api: { equip },
    });
    await userEvent.click(within(screen.getByRole('group', { name: 'From the shop' })).getByRole('button', { name: 'No title' }));
    expect(await screen.findByText("Couldn't remove your title")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't equip/)).not.toBeInTheDocument();
  });

  it('lists every emblem, unlocked ones with their tier and date for screen readers too', () => {
    renderWithClient(<CabinetTab all={standings(SIX)} showcase={[]} onShowcaseSaved={() => {}} />);
    const grid = screen.getByRole('list', { name: 'Every emblem' });
    const items = within(grid).getAllByRole('listitem');
    expect(items).toHaveLength(45);
    const grinder = within(grid).getByRole('img', { name: 'Grinder III, gold' }).closest('li')!;
    expect(grinder).toHaveAttribute('title', 'Grinder III, unlocked Sep 20, 2026');
    expect(within(grinder).getByText('Unlocked Sep 20, 2026')).toHaveClass('sr-only');
    const locked = within(grid).getByRole('img', { name: 'Flop chaser, locked' }).closest('li')!;
    expect(locked).not.toHaveAttribute('title');
    expect(locked).not.toHaveTextContent('Unlocked');
    expect(within(grid).getAllByRole('img', { name: 'Secret feat, locked' }).length).toBeGreaterThan(0);
  });

  it('credits every icon author, with links', () => {
    renderWithClient(<CabinetTab all={standings(SIX)} showcase={[]} onShowcaseSaved={() => {}} />);
    const credit = screen.getByText(/Emblem icons by/);
    expect(credit).toHaveTextContent('Emblem icons by Lorc, Delapouite, Skoll and Carl Olsen from game-icons.net, CC BY 3.0.');
    expect(within(credit).getByRole('link', { name: 'game-icons.net' })).toHaveAttribute('href', 'https://game-icons.net');
    expect(within(credit).getByRole('link', { name: 'CC BY 3.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/3.0/');
  });

  it('keeps focus on a sensible control while reordering, removing and clearing', async () => {
    renderWithClient(<CabinetTab all={standings(SIX)} showcase={['grinder', 'royalty', 'moby']} onShowcaseSaved={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit showcase' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit showcase' });
    const btn = (name: string) => within(dialog).getByRole('button', { name });

    // Royalty moves to the front: its Left button is now disabled, so focus goes to its Right.
    await userEvent.click(btn('Move Royalty left'));
    expect(btn('Move Royalty right')).toHaveFocus();
    // Moving right keeps focus on the same button while it can move further.
    await userEvent.click(btn('Move Royalty right'));
    expect(btn('Move Royalty right')).toHaveFocus();

    // Removing a row focuses the next row's Remove, or the last one's at the end.
    await userEvent.click(btn('Remove Royalty'));
    expect(btn('Remove Moby')).toHaveFocus();
    await userEvent.click(btn('Remove Moby'));
    expect(btn('Remove Grinder III')).toHaveFocus();
    // The last one: focus moves to that emblem in the picker.
    await userEvent.click(btn('Remove Grinder III'));
    expect(within(within(dialog).getByRole('list', { name: 'Unlocked emblems' })).getByRole('button', { name: 'Grinder III, gold' })).toHaveFocus();

    // Clear disables itself, so focus moves to the first emblem in the picker.
    await userEvent.click(btn('Moby, epic feat'));
    await userEvent.click(btn('Clear'));
    expect(within(dialog).getByRole('list', { name: 'Unlocked emblems' }).querySelector('button')).toHaveFocus();
  });
});
