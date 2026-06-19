import { describe, it, expect } from 'vitest';
import type { GameState, TableConfig } from '@poker/shared';
import { GameRoom, type ChipService, type GameRoomPlayer } from './game.js';

const CONFIG: TableConfig = { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9 };

interface EmitRecord {
  target: string;
  event: string;
  args: unknown[];
}

/** Minimal fake of the socket.io server surface GameRoom uses. */
function makeFakeIo() {
  const records: EmitRecord[] = [];
  const listeners: Array<(r: EmitRecord) => void> = [];
  const io = {
    to(target: string) {
      return {
        emit(event: string, ...args: unknown[]) {
          const rec = { target, event, args };
          records.push(rec);
          for (const l of listeners) l(rec);
        },
      };
    },
  };
  return {
    io,
    records,
    waitFor(event: string): Promise<EmitRecord> {
      const existing = records.find((r) => r.event === event);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        listeners.push((r) => r.event === event && resolve(r));
      });
    },
  };
}

/** Fake chip ledger with idempotent application, recording every call. */
function makeFakeChips() {
  const calls: Array<{ playerId: string; amount: number; type: string; idempotencyKey: string }> = [];
  const seen = new Set<string>();
  const service: ChipService = {
    async adjust(input) {
      calls.push(input);
      if (seen.has(input.idempotencyKey)) return { applied: false, balance: 0 };
      seen.add(input.idempotencyKey);
      return { applied: true, balance: 0 };
    },
  };
  return { calls, service };
}

const players: GameRoomPlayer[] = [
  { discordUserId: 'a', displayName: 'A', avatarUrl: '', socketId: 'sa' },
  { discordUserId: 'b', displayName: 'B', avatarUrl: '', socketId: 'sb' },
];

function makeRoom(io: ReturnType<typeof makeFakeIo>, chips: ChipService, timing = {}) {
  return new GameRoom({
    io: io.io as never,
    gameId: 'G',
    instanceId: 'I',
    config: CONFIG,
    players,
    chips,
    // Huge timers by default so nothing auto-fires; tests drive actions directly.
    timing: { turnMs: 1e9, tickMs: 1e9, handDelayMs: 1e9, ...timing },
  });
}

const chipSum = (s: GameState) => s.players.reduce((t, p) => t + p.chipStack, 0);

describe('GameRoom', () => {
  it('charges buy-ins and runs an all-in hand to showdown', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    // Both buy-ins charged with stable idempotency keys.
    const buyIns = chips.calls.filter((c) => c.type === 'buy-in');
    expect(buyIns).toHaveLength(2);
    expect(buyIns.every((c) => c.amount === -3000)).toBe(true);
    expect(new Set(buyIns.map((c) => c.idempotencyKey))).toEqual(
      new Set(['G:buyin:a', 'G:buyin:b']),
    );

    // Heads-up: the button (seat 0 = 'a') acts first.
    const result = io.waitFor('hand_result');
    room.handleAction('a', { type: 'all-in' });
    room.handleAction('b', { type: 'all-in' });

    const rec = await result;
    const { potAmount, winnerIds, finalState } = rec.args[0] as {
      potAmount: number;
      winnerIds: string[];
      finalState: GameState;
    };
    expect(potAmount).toBe(6000);
    expect(winnerIds.length).toBeGreaterThanOrEqual(1);
    expect(chipSum(finalState)).toBe(6000); // chips conserved
    room.stop();
  });

  it('awards the pot to the last player standing on a fold-out', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    const result = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' }); // SB folds pre-flop

    const { winnerIds, potAmount } = (await result).args[0] as {
      winnerIds: string[];
      potAmount: number;
    };
    expect(winnerIds).toEqual(['b']);
    expect(potAmount).toBe(75); // SB 25 + BB 50
    room.stop();
  });

  it('only reveals the acting player their own cards', async () => {
    const io = makeFakeIo();
    const room = makeRoom(io, makeFakeChips().service);
    await room.start();

    const updates = io.records.filter((r) => r.event === 'game_state_update');
    const toA = updates.find((r) => r.target === 'sa')!.args[0] as GameState;
    const aSeesB = toA.players.find((p) => p.discordUserId === 'b')!.holeCards;
    const aSeesSelf = toA.players.find((p) => p.discordUserId === 'a')!.holeCards;
    expect(aSeesSelf).not.toBeNull();
    expect(aSeesB).toBeNull();
    room.stop();
  });

  it('auto-folds a player who runs out the turn timer', async () => {
    const io = makeFakeIo();
    const room = makeRoom(io, makeFakeChips().service, { turnMs: 40, tickMs: 15 });
    await room.start();

    const rec = await io.waitFor('hand_result'); // a (SB) times out -> folds -> b wins
    const { winnerIds } = rec.args[0] as { winnerIds: string[] };
    expect(winnerIds).toEqual(['b']);
    expect(io.records.some((r) => r.event === 'timer_tick')).toBe(true);
    room.stop();
  });

  it('cashes out remaining chips on leave/game-end with the ledger net to zero', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    // Conclude one hand by folding, so the table is between hands.
    const concluded = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' });
    await concluded;

    // One player leaves; the table drops below 2 and the game ends, cashing out both.
    room.leave('a');
    // Leaving again must be a no-op (idempotent).
    room.leave('a');

    const cashOuts = chips.calls.filter((c) => c.type === 'cash-out');
    expect(new Set(cashOuts.map((c) => c.idempotencyKey))).toEqual(
      new Set(['G:cashout:a', 'G:cashout:b']),
    );
    // Buy-ins (-3000 each) plus cash-outs return exactly to zero.
    const net = chips.calls.reduce((t, c) => t + c.amount, 0);
    expect(net).toBe(0);
    room.stop();
  });

  it('auto-folds a player who disconnects on their turn', async () => {
    const io = makeFakeIo();
    const room = makeRoom(io, makeFakeChips().service);
    await room.start();

    const result = io.waitFor('hand_result');
    room.handleDisconnect('sa'); // 'a' is the heads-up button and acts first
    const { winnerIds } = (await result).args[0] as { winnerIds: string[] };
    expect(winnerIds).toEqual(['b']);
    room.stop();
  });

  it('resends the current state to a reconnecting player on their new socket', async () => {
    const io = makeFakeIo();
    const room = makeRoom(io, makeFakeChips().service);
    await room.start();
    room.handleDisconnect('sa');

    room.reconnect('a', 'sa2');
    const resent = io.records.filter((r) => r.event === 'game_state_update' && r.target === 'sa2');
    expect(resent.length).toBeGreaterThanOrEqual(1);
    room.stop();
  });

  it('ignores leave requests while a hand is in progress', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    room.leave('a'); // hand is live -> must be a no-op
    expect(chips.calls.some((c) => c.type === 'cash-out')).toBe(false);
    room.stop();
  });
});
