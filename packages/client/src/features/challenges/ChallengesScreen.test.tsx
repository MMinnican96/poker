import { describe, it, expect, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '../../app/Toaster';
import { makeMe, renderWithClient } from '../../test/harness';
import { makeAchievements, makeChallenge } from '../fixtures';
import { ChallengesScreen, timeLeft } from './ChallengesScreen';

describe('ChallengesScreen', () => {
  it('shows progress, rewards and time left per period', async () => {
    const challenges = vi.fn(async () => [
      makeChallenge(),
      makeChallenge({ id: 'w-win-50', period: 'weekly', periodKey: '2026-W39', title: 'Pot collector', goal: 50, progress: 12, reward: { chips: 5000, xp: 350 }, endsAt: new Date(Date.now() + 3 * 86_400_000 + 7_200_000).toISOString() }),
    ]);
    renderWithClient(<ChallengesScreen />, { api: { challenges } });
    const daily = await screen.findByRole('region', { name: 'Daily challenges' });
    const bar = within(daily).getByRole('progressbar', { name: 'Pull up a chair progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '10');
    expect(bar).toHaveAttribute('aria-valuemax', '25');
    expect(within(daily).getByText('10 / 25')).toBeInTheDocument();
    expect(within(daily).getByText('+40 XP')).toBeInTheDocument();
    expect(within(daily).getByText(/^4h 59m|^5h 0m/)).toBeInTheDocument();
    const weekly = screen.getByRole('region', { name: 'Weekly challenges' });
    expect(within(weekly).getByText(/^3d [12]h$/)).toBeInTheDocument();
    expect(within(daily).queryByRole('button', { name: /Claim/ })).not.toBeInTheDocument();
  });

  it('claims a completed challenge: toast, claimed stamp, and the pushed me clears the badge', async () => {
    const claimChallenge = vi.fn(async () => ({ ok: true as const, chips: 500, xp: 40, balance: 10_500, levelUps: [{ playerId: 'p1', level: 4, reward: 1000 }] }));
    const { store } = renderWithClient(<><ChallengesScreen /><Toaster /></>, {
      me: makeMe({ unclaimedChallenges: 1 }),
      api: { challenges: async () => [makeChallenge({ progress: 25, completed: true })], claimChallenge },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Claim Pull up a chair' }));
    expect(claimChallenge).toHaveBeenCalledWith('2026-09-24', 'd-play-25');
    expect(await screen.findByText('Claimed: Pull up a chair')).toBeInTheDocument();
    // The level-up has its own server notice; the claim toast doesn't repeat it.
    expect(screen.getByText('+500 chips and 40 XP.')).toBeInTheDocument();
    expect(screen.queryByText(/reached level/)).not.toBeInTheDocument();
    expect(screen.getByText('Claimed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim Pull up a chair' })).not.toBeInTheDocument();
    act(() => store.dispatch({ type: 'me', me: makeMe({ unclaimedChallenges: 0, balance: 10_500 }) }));
    expect(store.getState().me.unclaimedChallenges).toBe(0);
  });

  it('reports a refused claim', async () => {
    renderWithClient(<><ChallengesScreen /><Toaster /></>, {
      api: {
        challenges: async () => [makeChallenge({ progress: 25, completed: true })],
        claimChallenge: async () => ({ ok: false as const, error: 'Already claimed.' }),
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Claim Pull up a chair' }));
    expect(await screen.findByText("Couldn't claim that challenge")).toBeInTheDocument();
    expect(screen.getByText('Already claimed.')).toBeInTheDocument();
  });

  it('claims the daily bonus from its card', async () => {
    const claimDaily = vi.fn(async () => ({ ok: true as const, amount: 750, balance: 10_750, streak: 2, levelUps: [] }));
    renderWithClient(<><ChallengesScreen /><Toaster /></>, {
      me: makeMe({ daily: { available: true, streak: 2, nextAmount: 750 } }),
      api: { challenges: async () => [], claimDaily },
    });
    const card = screen.getByRole('region', { name: 'Daily bonus' });
    expect(within(card).getByText('Claim 750 free chips.')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Claim' }));
    expect(claimDaily).toHaveBeenCalled();
    expect(await screen.findByText('Daily bonus claimed')).toBeInTheDocument();
  });

  it('shows level progress and the next level-up reward', () => {
    renderWithClient(<ChallengesScreen />, { api: { challenges: async () => [] } });
    const card = screen.getByRole('region', { name: 'Level 3' });
    expect(card).toHaveTextContent('40 / 220 XP. Level 4 pays');
    expect(card).toHaveTextContent('1,000');
  });
});

describe('ChallengesScreen tabs', () => {
  it('switches between daily & weekly, career, feats and the trophy cabinet, loading achievements once', async () => {
    const achievements = vi.fn(async () => makeAchievements({ grinder: { progress: 300, tier: 2 } }));
    renderWithClient(<ChallengesScreen />, { me: makeMe({ unclaimedChallenges: 2 }), api: { challenges: async () => [makeChallenge()], achievements } });
    const tabs = screen.getByRole('tablist', { name: 'Challenge types' });
    expect(within(tabs).getByRole('tab', { name: /Daily & weekly/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(tabs).getByRole('tab', { name: /Daily & weekly/ })).toHaveTextContent('2');
    expect(await screen.findByRole('region', { name: 'Daily challenges' })).toBeInTheDocument();
    expect(achievements).not.toHaveBeenCalled();

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Career' }));
    expect(await screen.findByRole('heading', { name: 'Grind' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Daily challenges' })).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'challenges-tab-career');

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Feats' }));
    expect(await screen.findByText(/of 19 feats unlocked/)).toBeInTheDocument();

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Trophy cabinet' }));
    expect(await screen.findByText(/1 of 45 emblems unlocked/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'game-icons.net' })).toHaveAttribute('href', 'https://game-icons.net');
    expect(achievements).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when achievements fail to load', async () => {
    const achievements = vi.fn(async () => { throw new Error('Server is napping.'); });
    renderWithClient(<ChallengesScreen initialTab="career" />, { api: { challenges: async () => [], achievements } });
    expect(await screen.findByText("Couldn't load career challenges")).toBeInTheDocument();
    expect(screen.getByText('Server is napping.')).toBeInTheDocument();
  });

  it('fetches again when an unlock notice arrives', async () => {
    const achievements = vi.fn(async () => makeAchievements());
    const { store } = renderWithClient(<ChallengesScreen initialTab="feats" />, { api: { challenges: async () => [], achievements } });
    await screen.findByText(/of 19 feats unlocked/);
    act(() => store.dispatch({ type: 'notice', notice: { id: 'u1', tone: 'good', title: 'Feat unlocked: Fresh cheese', emblem: { achievementId: 'fresh-cheese', tier: 1 } } }));
    await vi.waitFor(() => expect(achievements).toHaveBeenCalledTimes(2));
  });
});

describe('ChallengesScreen keeps achievements fresh', () => {
  const unlock = (id: string, achievementId = 'grinder', tier = 1) =>
    ({ type: 'notice' as const, notice: { id, tone: 'good' as const, title: 'Unlocked', emblem: { achievementId, tier } } });

  it('fetches again on coming back from Daily & weekly, but not between achievement tabs, and keeps daily loaded', async () => {
    const achievements = vi.fn(async () => makeAchievements());
    const challenges = vi.fn(async () => [makeChallenge()]);
    renderWithClient(<ChallengesScreen />, { api: { challenges, achievements } });
    const tabs = screen.getByRole('tablist', { name: 'Challenge types' });
    await screen.findByRole('region', { name: 'Daily challenges' });

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Career' }));
    await screen.findByRole('heading', { name: 'Grind' });
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Feats' }));
    expect(achievements).toHaveBeenCalledTimes(1);

    // Back to daily: shown at once from what was loaded, no refetch, no spinner.
    await userEvent.click(within(tabs).getByRole('tab', { name: /Daily & weekly/ }));
    expect(screen.getByRole('region', { name: 'Daily challenges' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading challenges' })).not.toBeInTheDocument();
    expect(challenges).toHaveBeenCalledTimes(1);

    // A claim might have moved career progress: leaving daily fetches achievements again, keeping the old ones on screen.
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Career' }));
    expect(screen.getByRole('heading', { name: 'Grind' })).toBeInTheDocument();
    await vi.waitFor(() => expect(achievements).toHaveBeenCalledTimes(2));
  });

  it('shows the refetched progress in Career after an unlock notice', async () => {
    const achievements = vi.fn()
      .mockResolvedValueOnce(makeAchievements({ grinder: { progress: 49, tier: 0 } }))
      .mockResolvedValue(makeAchievements({ grinder: { progress: 50, tier: 1 } }));
    const { store } = renderWithClient(<ChallengesScreen initialTab="career" />, { api: { challenges: async () => [], achievements } });
    const row = await screen.findByRole('article', { name: 'Grinder' });
    expect(row).toHaveTextContent('Locked · no tier yet');
    act(() => store.dispatch(unlock('u1')));
    await vi.waitFor(() => expect(screen.getByRole('article', { name: 'Grinder' })).toHaveTextContent('Bronze · tier I of V'));
  });

  it('fetches once per unlock notice, not again when an older one becomes the latest', async () => {
    const achievements = vi.fn(async () => makeAchievements());
    const { store } = renderWithClient(<ChallengesScreen initialTab="feats" />, { api: { challenges: async () => [], achievements } });
    await screen.findByText(/of 19 feats unlocked/);
    act(() => store.dispatch(unlock('u1')));
    await vi.waitFor(() => expect(achievements).toHaveBeenCalledTimes(2));
    act(() => store.dispatch(unlock('u2', 'pot-taker')));
    await vi.waitFor(() => expect(achievements).toHaveBeenCalledTimes(3));
    act(() => store.dismissNotice('u2'));
    // A later notice is the sentinel: only it causes a fetch.
    act(() => store.dispatch(unlock('u3', 'big-fish')));
    await vi.waitFor(() => expect(achievements).toHaveBeenCalledTimes(4));
    await new Promise((r) => setTimeout(r, 20));
    expect(achievements).toHaveBeenCalledTimes(4);
  });

  it('Clear then save empties the showcase and the shelf shows the automatic pick', async () => {
    const achievements = vi.fn(async () => makeAchievements({
      grinder: { progress: 300, tier: 2 }, royalty: { progress: 1, tier: 1 },
    }, ['grinder']));
    const setShowcase = vi.fn(async (ids: string[]) => ({ ok: true as const, showcase: ids }));
    renderWithClient(<><ChallengesScreen initialTab="cabinet" /><Toaster /></>, { api: { challenges: async () => [], achievements, setShowcase } });
    const shelf = await screen.findByRole('list', { name: 'Showcase' });
    expect(within(shelf).getAllByRole('listitem')[0]).toHaveTextContent('Grinder II, silver');
    expect(within(shelf).getAllByRole('listitem')[1]).toHaveTextContent('Empty place');

    await userEvent.click(screen.getByRole('button', { name: 'Edit showcase' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit showcase' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save showcase' }));
    expect(setShowcase).toHaveBeenCalledWith([]);
    expect(await screen.findByText('It shows your best emblems for you.')).toBeInTheDocument();

    const auto = screen.getByRole('list', { name: 'Showcase' });
    const places = within(auto).getAllByRole('listitem');
    expect(places[0]).toHaveTextContent('Royalty, legendary feat');
    expect(places[1]).toHaveTextContent('Grinder II, silver');
    expect(screen.getByText(/Showing your best emblems until you pick your own/)).toBeInTheDocument();
  });

  it('names the tab that is loading or failed', async () => {
    let fail = true;
    const achievements = vi.fn(async () => {
      if (fail) throw new Error('Server is napping.');
      return makeAchievements();
    });
    renderWithClient(<ChallengesScreen initialTab="cabinet" />, { api: { challenges: async () => [], achievements } });
    expect(screen.getByRole('status', { name: 'Loading your trophy cabinet' })).toBeInTheDocument();
    expect(await screen.findByText("Couldn't load your trophy cabinet")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('tablist')).getByRole('tab', { name: 'Feats' }));
    expect(screen.getByText("Couldn't load feats")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/of 19 feats unlocked/)).toBeInTheDocument();
  });
});

describe('timeLeft', () => {
  it('formats countdowns', () => {
    expect(timeLeft(2 * 86_400_000 + 4 * 3_600_000)).toBe('2d 4h');
    expect(timeLeft(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m');
    expect(timeLeft(12 * 60_000 + 5_000)).toBe('12m 05s');
    expect(timeLeft(40_000)).toBe('40s');
    expect(timeLeft(-5)).toBe('0s');
  });
});
