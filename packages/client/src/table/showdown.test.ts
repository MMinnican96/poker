import { describe, it, expect } from 'vitest';
import type { GamePlayer, ShowdownSummary } from '@poker/shared';
import { showdownBanner } from './showdown';

function player(id: string, name: string): GamePlayer {
  return { discordUserId: id, displayName: name, avatarUrl: '', seatIndex: 0, chipStack: 0, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false, lastAction: null };
}
const players = [player('a', 'Alice'), player('b', 'Bob')];

describe('showdownBanner', () => {
  it('returns null without a showdown', () => {
    expect(showdownBanner(null, players)).toBeNull();
    expect(showdownBanner(undefined, players)).toBeNull();
  });

  it('names a single winner with their hand label', () => {
    const sd: ShowdownSummary = { winnerIds: ['a'], hands: { a: { category: 'flush', label: 'Flush' }, b: { category: 'pair', label: 'Pair' } } };
    expect(showdownBanner(sd, players)).toBe('Alice wins with a Flush');
  });

  it('names a fold-out winner without a hand label', () => {
    const sd: ShowdownSummary = { winnerIds: ['b'], hands: {} };
    expect(showdownBanner(sd, players)).toBe('Bob wins the pot');
  });

  it('describes a split pot', () => {
    const sd: ShowdownSummary = { winnerIds: ['a', 'b'], hands: { a: { category: 'straight', label: 'Straight' }, b: { category: 'straight', label: 'Straight' } } };
    expect(showdownBanner(sd, players)).toBe('Split pot — Alice & Bob · Straight');
  });
});
