import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeaderboardEntry, LeaderboardMetric, LeaderboardPeriod, LeaderboardResponse } from '@poker/shared';
import { renderWithClient } from '../../test/harness';
import { makeEntry, makeProfile } from '../fixtures';
import { LeaderboardScreen, MORE_LIMIT, SHOWN } from './LeaderboardScreen';

const board = (n: number, opts: { me?: number } = {}) =>
  Array.from({ length: n }, (_, i) => makeEntry(i + 1, i + 1 === opts.me ? 'p1' : `x${i}`, i + 1 === opts.me ? 'Alice' : `Player ${i + 1}`, 10_000 - i * 10));

/** A response like the server's: the top `limit` rows, plus your own entry wherever it is. */
const respond = (all: LeaderboardEntry[]) => async (_m: LeaderboardMetric, _p?: LeaderboardPeriod, limit = 25): Promise<LeaderboardResponse> => ({
  entries: all.slice(0, limit),
  me: all.find((e) => e.player.id === 'p1') ?? null,
});

describe('LeaderboardScreen', () => {
  it('asks for one more row than it shows and highlights your row', async () => {
    const leaderboard = vi.fn(respond(board(8, { me: 5 })));
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard } });
    expect(leaderboard).toHaveBeenCalledWith('net_profit', 'all', SHOWN + 1);
    const list = await screen.findByRole('list', { name: 'Rankings' });
    const mine = within(list).getByRole('button', { name: /Alice/ });
    expect(mine).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('group', { name: 'Your position' })).not.toBeInTheDocument();
  });

  it('pins your own entry from the server when you rank below the fetched rows', async () => {
    const leaderboard = vi.fn(respond(board(400, { me: 333 })));
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard } });
    const pinned = await screen.findByRole('group', { name: 'Your position' });
    expect(within(pinned).getByRole('button', { name: /Alice/ })).toHaveTextContent('333');
    expect(within(screen.getByRole('list', { name: 'Rankings' })).getAllByRole('listitem')).toHaveLength(SHOWN - 3);
  });

  it('shows more rows on request, still pinning you if you are further down', async () => {
    const leaderboard = vi.fn(respond(board(400, { me: 150 })));
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard } });
    await userEvent.click(await screen.findByRole('button', { name: `Show the top ${MORE_LIMIT}` }));
    expect(leaderboard).toHaveBeenLastCalledWith('net_profit', 'all', MORE_LIMIT);
    const list = screen.getByRole('list', { name: 'Rankings' });
    await vi.waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(MORE_LIMIT - 3));
    expect(within(screen.getByRole('group', { name: 'Your position' })).getByRole('button', { name: /Alice/ })).toHaveTextContent('150');
    expect(screen.queryByRole('button', { name: /Show the top/ })).not.toBeInTheDocument();
  });

  it('offers no "show more" when everyone fits', async () => {
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard: respond(board(SHOWN, { me: 2 })) } });
    await screen.findByRole('list', { name: 'Rankings' });
    expect(screen.queryByRole('button', { name: /Show the top/ })).not.toBeInTheDocument();
  });

  it('marks your pinned rank as tied when someone shown shares it', async () => {
    const entries = [...board(SHOWN), makeEntry(SHOWN + 1, 'x-tie', 'Tie', 1), makeEntry(SHOWN + 1, 'p1', 'Alice', 1)];
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard: respond(entries) } });
    const pinned = await screen.findByRole('group', { name: 'Your position' });
    expect(within(pinned).getByRole('button', { name: /Alice/ })).toHaveTextContent(`=${SHOWN + 1}`);
  });

  it('says when you are not on the board at all', async () => {
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard: respond(board(4)) } });
    expect(await screen.findByText("You're not on this board yet. Play a hand to get ranked.")).toBeInTheDocument();
  });

  it('only offers "This week" for weekly metrics', async () => {
    const leaderboard = vi.fn(respond(board(3)));
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard } });
    await screen.findByRole('list', { name: 'Top three' });

    await userEvent.click(screen.getByRole('radio', { name: 'This week' }));
    expect(leaderboard).toHaveBeenLastCalledWith('net_profit', 'week', SHOWN + 1);
    expect(await screen.findByText("You're not ranked this week. Play a hand to get on the board.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Bankroll' }));
    expect(screen.getByRole('radio', { name: 'This week' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'All time' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Bankroll is always all time.')).toBeInTheDocument();
    expect(leaderboard).toHaveBeenLastCalledWith('bankroll', 'all', SHOWN + 1);

    // Back to a weekly metric: the weekly choice is remembered.
    await userEvent.click(screen.getByRole('radio', { name: 'Hands won' }));
    expect(leaderboard).toHaveBeenLastCalledWith('hands_won', 'week', SHOWN + 1);
  });

  it('shows tied ranks and podium places', async () => {
    const entries = [makeEntry(1, 'a', 'Ann', 500), makeEntry(1, 'b', 'Ben', 500), makeEntry(3, 'c', 'Cat', 200), makeEntry(4, 'd', 'Dan', 100), makeEntry(4, 'e', 'Eve', 100)];
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard: respond(entries) } });
    const podium = await screen.findByRole('list', { name: 'Top three' });
    expect(within(podium).getByRole('button', { name: /^Tied 1st: Ann/ })).toBeInTheDocument();
    expect(within(podium).getByRole('button', { name: /^Tied 1st: Ben/ })).toBeInTheDocument();
    expect(within(podium).getByRole('button', { name: /^3rd: Cat/ })).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Rankings' })).getAllByRole('button');
    expect(rows.map((r) => r.textContent?.slice(0, 2))).toEqual(['=4', '=4']);
  });

  it('opens the profile card from a row', async () => {
    const profile = vi.fn(async () => makeProfile({ id: 'x0', name: 'Player 1' }));
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard: respond(board(3)), profile } });
    await userEvent.click(await screen.findByRole('button', { name: /1st: Player 1/ }));
    // The profile card is a lazy chunk: its dialog shows once loaded, then fetches the card.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await vi.waitFor(() => expect(profile).toHaveBeenCalledWith('x0'));
  });

  it('has an empty state', async () => {
    renderWithClient(<LeaderboardScreen />, { api: { leaderboard: respond([]) } });
    expect(await screen.findByRole('heading', { name: "Nobody's on the board yet" })).toBeInTheDocument();
  });
});
