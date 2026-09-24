import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithClient } from '../../test/harness';
import { makeAchievements } from '../fixtures';
import { standings } from './achievements';
import { CareerTab } from './CareerTab';

const row = (name: string) => screen.getByRole('article', { name });

describe('CareerTab', () => {
  it('groups rows in on-screen order', () => {
    renderWithClient(<CareerTab all={standings(makeAchievements())} />);
    const groups = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(groups).toEqual(['Grind', 'Winning', 'Big game', 'Aggression', 'Made hands', 'Hole cards', 'Club']);
    expect(screen.getByText(/0 of 130 tiers reached/)).toBeInTheDocument();
  });

  it('shows a locked row: silhouette, tier I goal, reward and the tier III title', () => {
    renderWithClient(<CareerTab all={standings(makeAchievements({ grinder: { progress: 12, tier: 0 } }))} />);
    const r = row('Grinder');
    expect(r).toHaveTextContent('Locked · no tier yet');
    expect(r).toHaveTextContent('Play 50 hands.');
    const bar = within(r).getByRole('progressbar', { name: 'Grinder progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '12');
    expect(bar).toHaveAttribute('aria-valuemax', '50');
    expect(r).toHaveTextContent('Tier I pays');
    expect(within(r).getByText('500')).toBeInTheDocument();
    expect(r).toHaveTextContent('+50 XP');
    expect(r).toHaveTextContent('Tier III title');
    expect(within(r).getByText('Regular')).toBeInTheDocument();
    expect(within(r).getByRole('list', { name: 'Tier 0 of 5' })).toBeInTheDocument();
    expect(r.querySelector('svg[data-emblem="grinder"]')).toHaveAttribute('data-tier', '0');
  });

  it('shows a mid-tier row with the next goal in display units (night owl in hours)', () => {
    renderWithClient(<CareerTab all={standings(makeAchievements({ 'night-owl': { progress: 1990, tier: 3 } }))} />);
    const r = row('Night owl');
    expect(r).toHaveTextContent('Gold · tier III of V');
    expect(r).toHaveTextContent('Spend 100 hours in hands.');
    // 1,990 minutes: hours and minutes, and the bar's value is in the same minutes.
    expect(within(r).getByText('33h 10m / 100h')).toBeInTheDocument();
    const bar = within(r).getByRole('progressbar', { name: 'Night owl progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '1990');
    expect(bar).toHaveAttribute('aria-valuemax', '6000');
    expect(bar).toHaveAttribute('aria-valuetext', '33h 10m of 100h');
    expect(r).toHaveTextContent('Tier IV pays');
    expect(within(r).getByText('5,000')).toBeInTheDocument();
    expect(r).toHaveTextContent('Tier V title');
    expect(within(r).getByText('Lives here')).toBeInTheDocument();
    expect(within(r).getByRole('list', { name: 'Tier 3 of 5' })).toBeInTheDocument();
  });

  it('shows night owl under an hour in minutes, agreeing with the bar', () => {
    renderWithClient(<CareerTab all={standings(makeAchievements({ 'night-owl': { progress: 59, tier: 0 } }))} />);
    const r = row('Night owl');
    expect(within(r).getByText('59m / 1h')).toBeInTheDocument();
    const bar = within(r).getByRole('progressbar', { name: 'Night owl progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '59');
    expect(bar).toHaveAttribute('aria-valuemax', '60');
    expect(bar).toHaveAttribute('aria-valuetext', '59m of 1h');
    expect((bar.firstElementChild as HTMLElement).style.width).toMatch(/^98\.3/);
  });

  it('marks a maxed row complete, with no progress bar or reward', () => {
    renderWithClient(<CareerTab all={standings(makeAchievements({ 'pot-taker': { progress: 12_000, tier: 5 } }))} />);
    const r = row('Pot taker');
    expect(r).toHaveTextContent('Diamond · tier V of V');
    expect(within(r).getByText('Complete')).toBeInTheDocument();
    expect(within(r).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(r).not.toHaveTextContent('pays');
    expect(r).not.toHaveTextContent('title');
  });
});
