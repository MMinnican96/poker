import { describe, it, expect } from 'vitest';
import type { TableConfig } from '@poker/shared';
import { createDeck } from './deck.js';
import { startHand, act } from './game-state.js';
import { settleHand } from './showdown.js';

const CONFIG: TableConfig = { buyIn: 0, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 };

describe('multi-way all-in integrity', () => {
  it('builds correct side pots and conserves chips across three unequal stacks', () => {
    const ctx = startHand({
      gameId: 'g',
      instanceId: 'i',
      handNumber: 1,
      dealerIndex: 0,
      seeds: [
        { discordUserId: 'a', displayName: 'a', avatarUrl: '', seatIndex: 0, chipStack: 100 },
        { discordUserId: 'b', displayName: 'b', avatarUrl: '', seatIndex: 1, chipStack: 200 },
        { discordUserId: 'c', displayName: 'c', avatarUrl: '', seatIndex: 2, chipStack: 300 },
      ],
      config: CONFIG,
      deck: createDeck(),
    });

    // Total chips in play = stacks + whatever is already committed (the blinds).
    const totalBefore = ctx.state.players.reduce(
      (t, p) => t + p.chipStack + p.totalBetThisHand,
      0,
    );
    expect(totalBefore).toBe(600);

    // UTG (a, seat 0) acts first 3-handed, then b, then c — all jam.
    act(ctx, 'a', { type: 'all-in' });
    act(ctx, 'b', { type: 'all-in' });
    act(ctx, 'c', { type: 'all-in' });

    expect(ctx.state.phase).toBe('showdown');
    // a:100, b:200, c:300 => main(300, all) + side(200, b&c) + top(100, c only)
    expect(ctx.state.pots).toHaveLength(3);
    expect(ctx.state.pots.map((p) => p.amount)).toEqual([300, 200, 100]);

    const result = settleHand(ctx.state);

    // Chips are conserved through the showdown.
    const totalAfter = ctx.state.players.reduce((t, p) => t + p.chipStack, 0);
    expect(totalAfter).toBe(600);
    // c is the only player eligible for the top 100, so it always returns to c.
    expect(result.winningsByPlayer['c'] ?? 0).toBeGreaterThanOrEqual(100);
    // Distributed winnings equal the whole pot.
    expect(Object.values(result.winningsByPlayer).reduce((x, y) => x + y, 0)).toBe(600);
  });
});
