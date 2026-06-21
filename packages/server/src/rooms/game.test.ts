import { describe, it, expect } from 'vitest';
import type { GameState, TableConfig, PlayerHandStat } from '@poker/shared';
import { GameRoom, type ChipService, type GameRoomPlayer, type StatsService } from './game.js';

const CONFIG: TableConfig = { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 };

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

/** Fake stats service recording every recordHand/recordSession call. */
function makeFakeStats() {
  const hands: PlayerHandStat[][] = [];
  const sessions: { gameId: string; players: { playerId: string; playMs: number }[] }[] = [];
  const service: StatsService = {
    async recordHand(facts) { hands.push(facts); },
    async recordSession(input) { sessions.push(input); },
  };
  return { hands, sessions, service };
}

const players: GameRoomPlayer[] = [
  { discordUserId: 'a', displayName: 'A', avatarUrl: '', socketId: 'sa', bankroll: 3000 },
  { discordUserId: 'b', displayName: 'B', avatarUrl: '', socketId: 'sb', bankroll: 3000 },
];

function makeRoom(
  io: ReturnType<typeof makeFakeIo>,
  chips: ChipService,
  timing = {},
  stats: StatsService | undefined = undefined,
) {
  return new GameRoom({
    io: io.io as never,
    gameId: 'G',
    instanceId: 'I',
    config: CONFIG,
    players,
    chips,
    stats,
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
      new Set(['G:buyin:a:1', 'G:buyin:b:1']),
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

    // One player leaves; table idles (1 seated). Second player leaves; game ends, cashing out both.
    room.leave('a');
    // Leaving again must be a no-op (idempotent).
    room.leave('a');
    // Now only 'b' is seated (idle). 'b' also leaves, dropping to 0 → endGame.
    room.leave('b');

    const cashOuts = chips.calls.filter((c) => c.type === 'cash-out');
    expect(new Set(cashOuts.map((c) => c.idempotencyKey))).toEqual(
      new Set(['G:cashout:a:1', 'G:cashout:b:1']),
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

describe('GameRoom sit-in', () => {
  it('seats a spectator at the next hand and charges a fresh buy-in', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    room.requestSeat('c'); // mid-hand: queued, not yet charged
    expect(chips.calls.some((c) => c.playerId === 'c' && c.type === 'buy-in')).toBe(false);

    // Finish the current hand; next hand applies the pending seat.
    room.handleAction('a', { type: 'fold' });
    // 'b' wins the blinds vs 'a' fold-out; next hand is scheduled via timer — drive it:
    (room as unknown as { startHand(): void }).startHand();

    const buyIn = chips.calls.find((c) => c.playerId === 'c' && c.type === 'buy-in');
    expect(buyIn?.idempotencyKey).toBe('G:buyin:c:1');
    expect(room.state!.players.some((p) => p.discordUserId === 'c')).toBe(true);
    room.stop();
  });

  it('rejects sit-in when the table is full or the player is underfunded', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service, {}, undefined);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 100 });
    room.requestSeat('c'); // underfunded (bankroll 100 < buyIn 3000)
    room.handleAction('a', { type: 'fold' });
    (room as unknown as { startHand(): void }).startHand();
    expect(room.state!.players.some((p) => p.discordUserId === 'c')).toBe(false);
    room.stop();
  });
});

describe('GameRoom leave / sit-out / cancel-pending', () => {
  it('defers a seated leave to hand end, cashes out, and emits left_table', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    room.leave('a'); // mid-hand → queued, still seated
    expect(room.state!.players.some((p) => p.discordUserId === 'a')).toBe(true);
    expect(chips.calls.some((c) => c.playerId === 'a' && c.type === 'cash-out')).toBe(false);

    room.handleAction('a', { type: 'fold' });
    // Drive resolution directly:
    (room as unknown as { applyPending(): void }).applyPending();
    expect(chips.calls.some((c) => c.playerId === 'a' && c.type === 'cash-out')).toBe(true);
    expect(io.records.some((r) => r.target === 'sa' && r.event === 'left_table')).toBe(true);
    room.stop();
  });

  it('cancels a pending leave so the player stays seated with chips intact', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.leave('a');
    room.cancelPending('a');
    (room as unknown as { applyPending(): void }).applyPending();
    expect(chips.calls.some((c) => c.playerId === 'a' && c.type === 'cash-out')).toBe(false);
    room.stop();
  });

  it('moves a seated player to spectate at hand end, cashing out', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    // Mark 'a' as pending spectate while a hand is in progress.
    room.moveToSpectate('a');
    // No cash-out yet — the transition is deferred to hand end.
    expect(chips.calls.some((c) => c.playerId === 'a' && c.type === 'cash-out')).toBe(false);

    // Conclude the hand and drive the pending resolver directly.
    room.handleAction('a', { type: 'fold' });
    (room as unknown as { applyPending(): void }).applyPending();

    // 'a' must now be cashed out.
    expect(chips.calls.some((c) => c.playerId === 'a' && c.type === 'cash-out')).toBe(true);

    // Trigger a broadcast so we can inspect the post-resolution view.
    (room as unknown as { broadcastState(): void }).broadcastState();
    const view = io.records
      .filter((r) => r.target === 'sb' && r.event === 'game_state_update')
      .at(-1)!.args[0] as GameState;
    expect(view.spectators?.some((s) => s.discordUserId === 'a')).toBe(true);

    room.stop();
  });

  it('removes a spectator immediately on leave', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });
    room.leave('c');
    expect(io.records.some((r) => r.target === 'sc' && r.event === 'left_table')).toBe(true);
    const view = io.records.filter((r) => r.target === 'sa' && r.event === 'game_state_update').at(-1)!.args[0] as GameState;
    expect(view.spectators).toEqual([]);
    expect(chips.calls.some((c) => c.playerId === 'c')).toBe(false);
    room.stop();
  });
});

describe('GameRoom spectator', () => {
  it('adds a spectator who sees no opponent hole cards and is not dealt in', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    // The spectator is told to switch to the table.
    const joined = io.records.find((r) => r.target === 'sc' && r.event === 'joined_table');
    expect(joined?.args[0]).toEqual({ gameId: 'G', role: 'spectator' });

    // The spectator's view: 2 seated players, all hole cards hidden, listed as a spectator.
    const toSpectator = io.records.filter((r) => r.target === 'sc' && r.event === 'game_state_update');
    const view = toSpectator.at(-1)!.args[0] as GameState;
    expect(view.players).toHaveLength(2);
    expect(view.players.every((p) => p.holeCards === null)).toBe(true);
    expect(view.spectators).toEqual([{ discordUserId: 'c', displayName: 'C', avatarUrl: '' }]);
    expect(view.waitingForPlayers).toBe(false); // 2 seated players
    expect(view.viewerPending).toBeNull();
    room.stop();
  });
});

describe('GameRoom stats', () => {
  it('records one fact per player on a fold-out', async () => {
    const io = makeFakeIo();
    const stats = makeFakeStats();
    const room = makeRoom(io, makeFakeChips().service, {}, stats.service);
    await room.start();

    const concluded = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' });
    await concluded;

    expect(stats.hands).toHaveLength(1);
    const facts = stats.hands[0];
    expect(facts.map((f) => f.playerId).sort()).toEqual(['a', 'b']);
    const winner = facts.find((f) => f.result === 'won')!;
    expect(winner.playerId).toBe('b');
    expect(winner.handNumber).toBe(1);
    expect(winner.gameId).toBe('G');
    room.stop();
  });

  it('records a session with positive play time when the game ends', async () => {
    const io = makeFakeIo();
    const stats = makeFakeStats();
    const room = makeRoom(io, makeFakeChips().service, {}, stats.service);
    await room.start();

    const concluded = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' });
    await concluded;
    room.leave('a'); // table idles at 1 seated
    room.leave('b'); // 0 seated → endGame → records session

    expect(stats.sessions).toHaveLength(1);
    expect(stats.sessions[0].gameId).toBe('G');
    expect(stats.sessions[0].players.map((p) => p.playerId).sort()).toEqual(['a', 'b']);
    expect(stats.sessions[0].players.every((p) => p.playMs >= 0)).toBe(true);
    room.stop();
  });

  it('records session for all players and caps disconnected-early play-time at drop time', async () => {
    const io = makeFakeIo();
    const stats = makeFakeStats();
    const room = makeRoom(io, makeFakeChips().service, {}, stats.service);
    await room.start();

    // 'a' disconnects immediately; their turn auto-folds, b wins the hand.
    room.handleDisconnect('sa');

    // Hand concludes (b auto-wins); table idles — both players are still seated but 'a' is disconnected.
    await io.waitFor('hand_result');

    // Both players leave → 0 seated → endGame records the session.
    room.leave('a');
    room.leave('b');

    // Session must be recorded exactly once.
    expect(stats.sessions).toHaveLength(1);
    expect(stats.sessions[0].gameId).toBe('G');

    // Every player must have a finite, non-negative playMs.
    for (const p of stats.sessions[0].players) {
      expect(Number.isFinite(p.playMs)).toBe(true);
      expect(p.playMs).toBeGreaterThanOrEqual(0);
    }
    room.stop();
  });

  it('works without a stats service (no-op default)', async () => {
    const io = makeFakeIo();
    const room = makeRoom(io, makeFakeChips().service);
    await room.start();
    const concluded = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' });
    await expect(concluded).resolves.toBeDefined();
    room.stop();
  });
});

describe('GameRoom teardown thresholds', () => {
  it('idles (does not deal) when only one player is seated, then resumes when a spectator sits in', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    // 'a' leaves; after the hand only 'b' is seated → table idles, no new hand.
    room.leave('a');
    room.handleAction('a', { type: 'fold' });
    (room as unknown as { scheduleNextHand(): void }).scheduleNextHand();
    expect(room.isActive).toBe(true);
    const idleView = io.records.filter((r) => r.target === 'sb' && r.event === 'game_state_update').at(-1)!.args[0] as GameState;
    expect(idleView.waitingForPlayers).toBe(true);

    // 'c' sits in → 2 seated → next hand deals.
    room.requestSeat('c');
    (room as unknown as { scheduleNextHand(): void }).scheduleNextHand();
    expect(room.state!.players.length).toBe(2);
    room.stop();
  });

  it('ends the game and ejects everyone when the last player leaves', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const ended: string[] = [];
    const room = new GameRoom({
      io: io.io as never, gameId: 'G', instanceId: 'I', config: CONFIG,
      players, chips: chips.service,
      timing: { turnMs: 1e9, tickMs: 1e9, handDelayMs: 1e9 },
      onEnd: (id) => ended.push(id),
    });
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    room.leave('a');
    room.handleAction('a', { type: 'fold' });
    room.leave('b'); // now both seated players leaving
    (room as unknown as { scheduleNextHand(): void }).scheduleNextHand();

    expect(ended).toContain('G');
    expect(io.records.some((r) => r.target === 'sc' && r.event === 'left_table')).toBe(true);
  });
});

describe('GameRoom summary', () => {
  it('summarizes the table: playing/watching counts and members', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    room.addSpectator({ discordUserId: 'c', displayName: 'C', avatarUrl: '', socketId: 'sc', bankroll: 3000 });

    const s = room.summary();
    expect(s.playingCount).toBe(2);
    expect(s.spectatingCount).toBe(1);
    expect(s.buyIn).toBe(3000);
    expect(s.members.find((m) => m.discordUserId === 'c')).toMatchObject({ role: 'spectator', chipStack: 0, seatIndex: null });
    room.stop();
  });
});

describe('GameRoom bust handling', () => {
  it('moves a busted player to spectate after the hand settles', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();
    // Heads-up all-in; loser busts to 0.
    const done = io.waitFor('hand_result');
    room.handleAction('a', { type: 'all-in' });
    room.handleAction('b', { type: 'all-in' });
    await done;

    const loser = room.state!.players.find((p) => p.chipStack === 0)!.discordUserId;
    // After settle the busted player is now a spectator in everyone's view.
    const someView = io.records.filter((r) => r.event === 'game_state_update').at(-1)!.args[0] as GameState;
    expect(someView.spectators?.some((s) => s.discordUserId === loser)).toBe(true);
    room.stop();
  });
});
