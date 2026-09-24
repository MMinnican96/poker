import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useNav } from '../../app/nav';
import { renderWithClient } from '../../test/harness';
import { EMPTY_SUMMARY, makeHand, makeSummary } from '../fixtures';
import { niceStep, yScale } from './ProfitChart';
import { HISTORY_LIMIT, StatsScreen } from './StatsScreen';

function Where() {
  return <p data-testid="section">{useNav().section}</p>;
}

describe('StatsScreen', () => {
  it('shows an empty state for a new player that leads to the table', async () => {
    const myHands = vi.fn(async () => []);
    renderWithClient(<><StatsScreen /><Where /></>, { section: 'stats', api: { playerStats: async () => ({ summary: EMPTY_SUMMARY, curve: [] }), myHands } });
    expect(await screen.findByRole('heading', { name: 'No hands yet' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Go to the table' }));
    expect(screen.getByTestId('section')).toHaveTextContent('table');
  });

  it('shows summary tiles with plain explanations and the category breakdown', async () => {
    const playerStats = vi.fn(async () => ({ summary: makeSummary(), curve: [{ hand: 1, total: 200, at: '' }, { hand: 2, total: -100, at: '' }] }));
    renderWithClient(<StatsScreen />, { api: { playerStats, myHands: async () => [] } });
    expect(playerStats).toHaveBeenCalledWith('p1');
    const tiles = await screen.findByText('Hands played');
    expect(tiles).toBeInTheDocument();
    expect(screen.getByText('How often you choose to put chips in before the flop.')).toBeInTheDocument();
    expect(screen.getByText('Bets and raises for every call. Above 2 is aggressive.')).toBeInTheDocument();
    expect(screen.getByText('You won 5 of 9 showdowns.')).toBeInTheDocument();
    const pair = screen.getByRole('rowheader', { name: 'Pair' }).closest('tr')!;
    expect(pair).toHaveTextContent('4');
    expect(screen.getByRole('rowheader', { name: 'Royal flush' }).closest('tr')).toHaveTextContent('0');
    // Chart table view carries every value.
    await userEvent.click(screen.getByText('Show as a table'));
    expect(screen.getByRole('cell', { name: '-300' })).toBeInTheDocument();
  });

  it('lists recent hands with your cards, shown opponent cards, and face-down backs for hidden ones', async () => {
    const myHands = vi.fn(async () => [makeHand()]);
    renderWithClient(<StatsScreen />, { api: { playerStats: async () => ({ summary: makeSummary(), curve: [] }), myHands } });
    expect(myHands).toHaveBeenCalledWith(HISTORY_LIMIT);
    const hands = await screen.findByRole('list', { name: 'Recent hands' });
    const hand = within(hands).getAllByRole('listitem')[0];
    const yours = within(hand).getByRole('group', { name: 'Your cards' });
    expect(within(yours).getByRole('img', { name: 'Ace of spades' })).toBeInTheDocument();
    expect(within(yours).getByRole('img', { name: 'Queen of clubs' })).toBeInTheDocument();
    const board = within(hand).getByRole('group', { name: 'Board' });
    expect(within(board).getAllByRole('img')).toHaveLength(5);
    const opponents = within(hand).getByRole('list', { name: 'Opponents' });
    const bob = within(opponents).getByText('Bob').closest('li')!;
    expect(within(bob).getByRole('img', { name: 'King of hearts' })).toBeInTheDocument();
    const carol = within(opponents).getByText('Carol').closest('li')!;
    expect(within(carol).getAllByRole('img', { name: 'Face-down card' })).toHaveLength(2);
    // Face-down cards use the back the opponent played that hand with.
    expect(carol.querySelectorAll('[data-card-back="back-navy"]')).toHaveLength(2);
    expect(within(carol).getByText('Folded')).toBeInTheDocument();
    expect(within(hand).getByText('+600')).toBeInTheDocument();
    expect(within(hand).getByText(/to You, pair of aces/)).toBeInTheDocument();
  });

  it('keeps long hand labels and names in their own columns', async () => {
    const hand = makeHand();
    const long = 'Full house, kings full of threes';
    hand.players = hand.players.map((p) =>
      p.id === 'p1' ? { ...p, handLabel: long } : p.name === 'Bob' ? { ...p, name: 'Bartholomew Longname' } : p,
    );
    renderWithClient(<StatsScreen />, { api: { playerStats: async () => ({ summary: makeSummary(), curve: [] }), myHands: async () => [hand] } });
    const yours = await screen.findByRole('group', { name: 'Your cards' });
    // The label sits under your cards in the same fixed column, not beside the board.
    expect(yours.parentElement).toHaveTextContent(long);
    expect(yours.parentElement).not.toContainElement(screen.getByRole('group', { name: 'Board' }));
    // A truncated opponent name keeps its full text on hover.
    const opponents = screen.getByRole('list', { name: 'Opponents' });
    expect(within(opponents).getByText('Bartholomew Longname')).toHaveAttribute('title', 'Bartholomew Longname');
  });

  it('pads a board that stopped early with empty slots', async () => {
    renderWithClient(<StatsScreen />, {
      api: { playerStats: async () => ({ summary: makeSummary(), curve: [] }), myHands: async () => [makeHand({ board: [] })] },
    });
    expect(await screen.findByRole('group', { name: 'No board dealt' })).toBeInTheDocument();
  });
});

describe('profit chart scale', () => {
  it('uses round steps and always includes zero', () => {
    expect(niceStep(1000)).toBe(200);
    expect(niceStep(90)).toBe(20);
    expect(yScale([120, 900])).toEqual({ lo: 0, hi: 1000, ticks: [0, 200, 400, 600, 800, 1000] });
    const s = yScale([-300, 200]);
    expect(s.lo).toBeLessThanOrEqual(-300);
    expect(s.ticks).toContain(0);
  });
});
