import { describe, it, expect, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '../../app/Toaster';
import { makeMe, renderWithClient } from '../../test/harness';
import { makeChallenge } from '../fixtures';
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
    expect(within(weekly).getByText('3d 2h')).toBeInTheDocument();
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
    expect(screen.getByText('+500 chips and 40 XP. You reached level 4: +1,000 chips.')).toBeInTheDocument();
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
    const claimDaily = vi.fn(async () => ({ ok: true as const, amount: 750, balance: 10_750, streak: 2 }));
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

describe('timeLeft', () => {
  it('formats countdowns', () => {
    expect(timeLeft(2 * 86_400_000 + 4 * 3_600_000)).toBe('2d 4h');
    expect(timeLeft(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m');
    expect(timeLeft(12 * 60_000 + 5_000)).toBe('12m 05s');
    expect(timeLeft(40_000)).toBe('40s');
    expect(timeLeft(-5)).toBe('0s');
  });
});
