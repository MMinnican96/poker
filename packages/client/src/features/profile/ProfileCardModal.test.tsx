import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../app/api';
import { useNav, useProfileCard } from '../../app/nav';
import { renderWithClient } from '../../test/harness';
import { makeProfile } from '../fixtures';
import { formSummary } from './FormTally';

/** Opens a profile card on mount and shows where navigation went. */
function Opener({ id }: { id: string }) {
  const profile = useProfileCard();
  const nav = useNav();
  return (
    <>
      <button type="button" onClick={() => profile.open(id)}>open</button>
      <p data-testid="nav">{`${nav.section}:${nav.messagesPartner ?? ''}`}</p>
    </>
  );
}

describe('ProfileCardModal', () => {
  it('renders the card: identity, stats, best hand, form and badges', async () => {
    const profile = vi.fn(async () => makeProfile());
    renderWithClient(<Opener id="p2" />, { api: { profile } });
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    const dialog = await screen.findByRole('dialog', { name: "Bob's profile card" });
    expect(profile).toHaveBeenCalledWith('p2');
    expect(await within(dialog).findByRole('heading', { name: 'Bob' })).toBeInTheDocument();
    expect(within(dialog).getByText('Card shark')).toBeInTheDocument();
    expect(within(dialog).getByText('24,500')).toBeInTheDocument();
    expect(within(dialog).getByText('Aug 2026')).toBeInTheDocument();
    expect(within(dialog).getByText('Full house')).toBeInTheDocument();
    expect(within(dialog).getByText('+5,250')).toBeInTheDocument();
    expect(within(dialog).getByText('31%')).toBeInTheDocument();
    expect(within(dialog).getByText('3h 20m')).toBeInTheDocument();
    expect(within(dialog).getByText('Regular')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: /Last 7 hands: 3 won, 3 lost, 1 even/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: /Level 7, 120 of 460 XP/ })).toBeInTheDocument();
  });

  it('Message opens a DM with the player and closes the card', async () => {
    renderWithClient(<Opener id="p2" />, { api: { profile: async () => makeProfile() } });
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Message' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav')).toHaveTextContent('messages:p2');
  });

  it('on your own card offers View stats instead of Message', async () => {
    renderWithClient(<Opener id="p1" />, { api: { profile: async () => makeProfile({ id: 'p1', name: 'Alice' }) } });
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText("That's you");
    expect(within(dialog).queryByRole('button', { name: 'Message' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'View stats' }));
    expect(screen.getByTestId('nav')).toHaveTextContent('stats:');
  });

  it('says so when the player does not exist', async () => {
    renderWithClient(<Opener id="ghost" />, { api: { profile: async () => { throw new ApiError(404, 'No such player'); } } });
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(await screen.findByRole('heading', { name: 'No such player' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Message' })).not.toBeInTheDocument();
  });

  it('shows a spinner while loading', async () => {
    renderWithClient(<Opener id="p2" />, { api: { profile: () => new Promise(() => {}) } });
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByRole('status', { name: 'Loading profile' })).toBeInTheDocument();
  });
});

describe('formSummary', () => {
  it('tallies wins, losses and the net', () => {
    expect(formSummary([100, -40, 0, 10])).toEqual({ up: 2, down: 1, even: 1, net: 70 });
  });
});
