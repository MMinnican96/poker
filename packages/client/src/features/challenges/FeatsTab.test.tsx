import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithClient } from '../../test/harness';
import { makeAchievements } from '../fixtures';
import { standings } from './achievements';
import { FeatsTab } from './FeatsTab';

describe('FeatsTab', () => {
  it('lists feats common first, legendary last', () => {
    renderWithClient(<FeatsTab all={standings(makeAchievements())} />);
    // Card headings sit under a (visually hidden) h2, so the outline has no gap after the screen's h1.
    expect(screen.getByRole('heading', { level: 2, name: 'Every feat' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Every feat' })).toBeInTheDocument();
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names[0]).toBe('Fresh cheese');
    expect(names.at(-1)).toBe('Hall of fame');
    expect(screen.getByText(/0 of 19 feats unlocked/)).toBeInTheDocument();
  });

  it('shows locked, secret and unlocked cards', () => {
    renderWithClient(<FeatsTab all={standings(makeAchievements({
      royalty: { progress: 1, tier: 1, unlocks: [{ tier: 1, unlockedAt: '2026-09-20T12:00:00.000Z' }] },
    }))} />);

    const locked = screen.getByRole('article', { name: 'Four horsemen' });
    expect(locked).toHaveAttribute('data-locked', 'true');
    expect(locked).toHaveTextContent('Win at showdown with four aces.');
    expect(locked).toHaveTextContent('Epic');
    expect(within(locked).getByText('10,000')).toBeInTheDocument();
    expect(locked).toHaveTextContent('Locked');

    // Secret feats keep their name, description and title hidden until unlocked.
    expect(screen.getAllByRole('article', { name: 'Secret feat' })).toHaveLength(3);
    expect(screen.getByText('The worst hand in poker has its day.')).toBeInTheDocument();
    expect(screen.queryByText('Win at showdown with seven-deuce offsuit.')).not.toBeInTheDocument();
    expect(screen.queryByText('The hammer')).not.toBeInTheDocument();

    const done = screen.getByRole('article', { name: 'Royalty' });
    expect(done).not.toHaveAttribute('data-locked');
    expect(done).toHaveTextContent('Legendary');
    expect(done).toHaveTextContent('Unlocked Sep 20, 2026');
    expect(done.querySelector('svg[data-emblem="royalty"]')).toHaveAttribute('data-tier', '1');
    expect(screen.getByText(/1 of 19 feats unlocked/)).toBeInTheDocument();
  });

  it('reveals a secret feat once unlocked', () => {
    renderWithClient(<FeatsTab all={standings(makeAchievements({ 'the-hammer': { progress: 1, tier: 1 } }))} />);
    const card = screen.getByRole('article', { name: 'The hammer' });
    expect(card).toHaveTextContent('Win at showdown with seven-deuce offsuit.');
    expect(screen.getAllByRole('article', { name: 'Secret feat' })).toHaveLength(2);
  });
});
