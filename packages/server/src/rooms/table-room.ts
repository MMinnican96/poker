import { randomUUID } from 'node:crypto';
import {
  emotesFor,
  formatChips,
  getItem,
  validateRules,
  type ActivityEvent,
  type HandResultView,
  type Notice,
  type PendingChange,
  type PlayerAction,
  type PublicPlayer,
  type SeatPlayer,
  type TableFx,
  type TableRules,
  type TableStatus,
  type TableSummary,
  type TableView,
} from '@poker/shared';
import {
  applyAction,
  legalActions,
  nextButton,
  potTotal,
  progress,
  settledPots,
  startHand,
  type Hand,
  type RandomInt,
} from '../engine/index.js';
import { buildHandFacts, buildHistory } from '../services/hand-facts.js';
import type { Bank } from '../services/bank.js';
import type { HandRecorder } from '../services/recorder.js';
import type { ShopService } from '../services/shop.js';
import { RateLimiter, Serial } from './serial.js';

export interface TableTiming {
  /** Pause after a betting round before the next street is dealt. */
  streetMs: number;
  /** Pause between streets when the board runs out with no betting. */
  runoutMs: number;
  /** How long a showdown result stays up. */
  showdownMs: number;
  /** How long a fold-out result stays up. */
  foldWinMs: number;
  /** Pause before dealing the next hand. */
  handGapMs: number;
  /** A disconnected player is stood up after being away this long. */
  disconnectStandMs: number;
  /** How often idle tables check for disconnected players. */
  sweepMs: number;
  /** Overrides the table's turn timer (tests). */
  turnMs?: number;
}

export const DEFAULT_TIMING: TableTiming = {
  streetMs: 700,
  runoutMs: 1500,
  showdownMs: 6500,
  foldWinMs: 2500,
  handGapMs: 1500,
  disconnectStandMs: 90_000,
  sweepMs: 10_000,
};

/** Missed turns in a row before a player is sat out. */
const TIMEOUTS_TO_SIT_OUT = 2;

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };

/** How the table talks to the outside world (sockets, lobby). */
export interface TableHooks {
  sendView(playerId: string, view: TableView): void;
  fx(fx: TableFx): void;
  left(playerId: string, reason: string): void;
  /** Membership, seats or status changed (refresh the lobby). */
  changed(): void;
  /** A player's bankroll/XP may have changed. */
  balanceChanged(playerId: string): void;
  notice(playerId: string, notice: Omit<Notice, 'id'>): void;
  activity(event: Omit<ActivityEvent, 'id' | 'at'>): void;
  /** The table is gone. */
  closed(): void;
}

export interface TableDeps {
  bank: Bank;
  recorder: HandRecorder;
  shop: ShopService;
  hooks: TableHooks;
  timing?: Partial<TableTiming>;
  clock?: () => number;
  random?: RandomInt;
  log?: (message: string, err?: unknown) => void;
}

interface Member {
  player: PublicPlayer;
  role: 'seated' | 'spectator';
  seat: number | null;
  /** Chips at the table (between hands; during a hand the engine is authoritative). */
  stack: number;
  sittingOut: boolean;
  pending: PendingChange;
  pendingTopUp: number;
  connected: boolean;
  disconnectedAt: number | null;
  seatedAt: number;
  timeouts: number;
  emotes: string[];
}

/**
 * One poker table. Owns seats, spectators, the hand in progress and its timers,
 * and moves chips through the bank (escrow) — never in memory alone.
 */
export class TableRoom {
  readonly tableId = randomUUID();
  private rules: TableRules;
  private status: TableStatus = 'open';
  private hostId: string | null;
  private readonly members = new Map<string, Member>();
  private readonly reserved = new Set<number>();
  private readonly serial = new Serial();
  private readonly fxLimit: RateLimiter;
  private readonly timing: TableTiming;
  private readonly clock: () => number;
  private readonly log: (message: string, err?: unknown) => void;

  private hand: Hand | null = null;
  private handStartedAt = 0;
  private handsDealt = 0;
  private buttonSeat: number | null = null;
  /** True between a hand completing and the next one being dealable. */
  private boundary = false;
  private closing = false;
  private closed = false;
  private turnDeadline: number | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private dealTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  /** Cash-outs that failed (e.g. DB unavailable) and are retried each boundary. */
  private readonly retryCashouts: { playerId: string; stack: number }[] = [];

  constructor(
    readonly instanceId: string,
    rules: TableRules,
    host: PublicPlayer,
    private readonly deps: TableDeps,
  ) {
    this.rules = rules;
    this.hostId = host.id;
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
    this.clock = deps.clock ?? Date.now;
    this.log = deps.log ?? ((m, e) => console.error(`[table] ${m}`, e ?? ''));
    this.fxLimit = new RateLimiter(3, 4000, this.clock);
    this.sweepTimer = setInterval(() => void this.sweep(), this.timing.sweepMs);
    this.sweepTimer.unref?.();
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  isMember(playerId: string): boolean {
    return this.members.has(playerId);
  }

  isSeated(playerId: string): boolean {
    return this.members.get(playerId)?.role === 'seated';
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get host(): string | null {
    return this.hostId;
  }

  memberIds(): string[] {
    return [...this.members.keys()];
  }

  roleOf(playerId: string): 'seated' | 'spectator' | null {
    return this.members.get(playerId)?.role ?? null;
  }

  /** Join as a spectator (no-op if already a member). */
  async watch(player: PublicPlayer): Promise<Result> {
    if (this.closed) return fail('This table has closed.');
    const existing = this.members.get(player.id);
    if (existing) {
      existing.player = player;
      this.markConnected(existing);
      this.sendTo(player.id);
      return OK;
    }
    this.members.set(player.id, {
      player, role: 'spectator', seat: null, stack: 0, sittingOut: false, pending: null, pendingTopUp: 0,
      connected: true, disconnectedAt: null, seatedAt: 0, timeouts: 0,
      emotes: emotesFor(await this.deps.shop.owned(player.id)),
    });
    this.broadcast();
    this.deps.hooks.changed();
    return OK;
  }

  /** Update a member's public profile/emotes (after a purchase, equip or level-up). */
  async refreshPlayer(player: PublicPlayer): Promise<void> {
    const m = this.members.get(player.id);
    if (!m) return;
    m.player = player;
    m.emotes = emotesFor(await this.deps.shop.owned(player.id));
    this.broadcast();
  }

  /** Buy in and take a seat. Dealt in from the next hand. */
  async takeSeat(playerId: string, seat: number, buyIn: number): Promise<Result> {
    return this.serial.run(async () => {
      if (this.closed || this.closing) return fail('This table is closing.');
      const m = this.members.get(playerId);
      if (!m) return fail('Join the table first.');
      if (m.role === 'seated') return fail("You're already seated.");
      if (!Number.isInteger(seat) || seat < 0 || seat >= this.rules.maxSeats) return fail('That seat does not exist.');
      if (this.occupant(seat) || this.reserved.has(seat)) return fail('That seat is taken.');
      if (!Number.isInteger(buyIn) || buyIn < this.rules.minBuyIn || buyIn > this.rules.maxBuyIn) {
        return fail(`Buy in for ${formatChips(this.rules.minBuyIn)}–${formatChips(this.rules.maxBuyIn)} chips.`);
      }
      this.reserved.add(seat);
      try {
        const r = await this.deps.bank.buyIn({ tableId: this.tableId, playerId, amount: buyIn });
        if (!r.ok) return fail(r.error);
        m.role = 'seated';
        m.seat = seat;
        m.stack = buyIn;
        m.sittingOut = false;
        m.pending = null;
        m.pendingTopUp = 0;
        m.timeouts = 0;
        m.seatedAt = this.clock();
      } catch (err) {
        this.log('buy-in failed', err);
        return fail('The bank is unavailable. Try again in a moment.');
      } finally {
        this.reserved.delete(seat);
      }
      this.deps.hooks.balanceChanged(playerId);
      this.deps.hooks.changed();
      this.broadcast();
      this.scheduleDeal();
      return OK;
    });
  }

  /** Add chips before the next hand (up to the maximum buy-in). */
  async topUp(playerId: string, amount: number): Promise<Result> {
    const m = this.members.get(playerId);
    if (!m || m.role !== 'seated') return fail('Take a seat first.');
    if (!Number.isInteger(amount) || amount <= 0) return fail('Add a whole number of chips.');
    const stack = this.liveStack(m);
    if (stack + m.pendingTopUp + amount > this.rules.maxBuyIn) {
      return fail(`You can have at most ${formatChips(this.rules.maxBuyIn)} chips at this table.`);
    }
    if (this.inHand(playerId) || this.boundary) {
      m.pendingTopUp += amount;
      this.broadcast();
      return OK;
    }
    return this.serial.run(() => this.applyTopUp(m, amount));
  }

  private async applyTopUp(m: Member, amount: number): Promise<Result> {
    try {
      const r = await this.deps.bank.topUp({ tableId: this.tableId, playerId: m.player.id, amount });
      if (!r.ok) {
        this.deps.hooks.notice(m.player.id, { tone: 'bad', title: 'Chips not added', body: r.error });
        return fail(r.error);
      }
      m.stack = r.stack;
      this.deps.hooks.balanceChanged(m.player.id);
      this.broadcast();
      this.scheduleDeal();
      return OK;
    } catch (err) {
      this.log('top-up failed', err);
      return fail('The bank is unavailable. Try again in a moment.');
    }
  }

  /** Stand up to watch. Waits for the hand to end if you're in it. */
  async standUp(playerId: string): Promise<Result> {
    const m = this.members.get(playerId);
    if (!m || m.role !== 'seated') return fail("You're not seated.");
    if (this.inHand(playerId) || this.boundary) {
      m.pending = 'stand';
      this.broadcast();
      return OK;
    }
    await this.serial.run(() => this.release(m, 'stand'));
    this.afterMembershipChange();
    return OK;
  }

  /** Leave for the lobby. Seated players in a hand leave when it ends. */
  async leave(playerId: string): Promise<Result> {
    const m = this.members.get(playerId);
    if (!m) return fail("You're not at the table.");
    if (m.role === 'seated' && (this.inHand(playerId) || this.boundary)) {
      m.pending = 'leave';
      this.broadcast();
      return OK;
    }
    await this.serial.run(() => this.release(m, 'leave'));
    this.afterMembershipChange();
    return OK;
  }

  setSittingOut(playerId: string, sittingOut: boolean): Result {
    const m = this.members.get(playerId);
    if (!m || m.role !== 'seated') return fail("You're not seated.");
    m.sittingOut = sittingOut;
    if (!sittingOut) m.timeouts = 0;
    this.broadcast();
    this.deps.hooks.changed();
    if (!sittingOut) this.scheduleDeal();
    return OK;
  }

  cancelPending(playerId: string): Result {
    const m = this.members.get(playerId);
    if (!m) return fail("You're not at the table.");
    m.pending = null;
    m.pendingTopUp = 0;
    this.broadcast();
    return OK;
  }

  // -------------------------------------------------------------------------
  // Host controls
  // -------------------------------------------------------------------------

  updateRules(playerId: string, patch: Partial<TableRules>): Result {
    if (playerId !== this.hostId) return fail('Only the host can change the rules.');
    if (this.status !== 'open') return fail('Rules are locked once the game starts.');
    const r = validateRules(patch, this.rules);
    if (!r.ok) return r;
    const highest = Math.max(-1, ...[...this.members.values()].map((m) => m.seat ?? -1));
    if (r.rules.maxSeats <= highest) return fail('Someone is sitting in a seat that would be removed.');
    this.rules = r.rules;
    this.broadcast();
    this.deps.hooks.changed();
    return OK;
  }

  start(playerId: string): Result {
    if (playerId !== this.hostId) return fail('Only the host can start the game.');
    if (this.status === 'running') return fail('The game is already running.');
    if (this.eligible().length < 2) return fail('At least two players need to be seated.');
    this.status = 'running';
    this.deps.hooks.changed();
    this.deps.hooks.activity({ kind: 'table', playerId: null, playerName: null, text: `The game at ${this.rules.name} has started.` });
    this.scheduleDeal(true);
    return OK;
  }

  /** Host closes the table: after the current hand, everyone is cashed out. */
  async close(playerId: string | null): Promise<Result> {
    if (playerId !== null && playerId !== this.hostId) return fail('Only the host can close the table.');
    if (this.closed) return OK;
    if (this.hand || this.boundary) {
      this.closing = true;
      this.broadcast();
      return OK;
    }
    await this.closeNow('The host closed the table.');
    return OK;
  }

  // -------------------------------------------------------------------------
  // Play
  // -------------------------------------------------------------------------

  act(playerId: string, action: PlayerAction): Result {
    const hand = this.hand;
    if (!hand || hand.state.phase !== 'betting') return fail('No action is expected right now.');
    const r = applyAction(hand, playerId, action);
    if (!r.ok) return r;
    const m = this.members.get(playerId);
    if (m) m.timeouts = 0;
    this.clearTurn();
    this.drive();
    return OK;
  }

  async emote(playerId: string, emote: string): Promise<Result> {
    const m = this.members.get(playerId);
    if (!m) return fail('Join the table first.');
    if (!m.emotes.includes(emote)) return fail("You don't own that emote.");
    if (!this.fxLimit.allow(playerId)) return fail('Slow down a little.');
    this.deps.hooks.fx({ id: randomUUID(), kind: 'emote', fromId: playerId, value: emote });
    return OK;
  }

  async throwItem(playerId: string, itemId: string, targetId: string): Promise<Result> {
    const m = this.members.get(playerId);
    if (!m) return fail('Join the table first.');
    const item = getItem(itemId);
    if (!item || item.category !== 'throwable') return fail("That can't be thrown.");
    const target = this.members.get(targetId);
    if (!target || target.role !== 'seated' || targetId === playerId) return fail('Pick someone seated at the table.');
    if (!this.fxLimit.allow(playerId)) return fail('Slow down a little.');
    if (!(await this.deps.shop.consume(playerId, itemId))) return fail(`You're out of ${item.name.toLowerCase()}. Buy more in the shop.`);
    this.deps.hooks.fx({ id: randomUUID(), kind: 'throw', fromId: playerId, toId: targetId, value: itemId });
    this.deps.hooks.balanceChanged(playerId);
    return OK;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  connect(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    this.markConnected(m);
    this.sendTo(playerId);
    this.broadcast();
  }

  disconnect(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    if (m.role === 'spectator') {
      this.members.delete(playerId);
      this.afterMembershipChange();
      return;
    }
    m.connected = false;
    m.disconnectedAt = this.clock();
    this.broadcast();
    this.deps.hooks.changed();
  }

  private markConnected(m: Member): void {
    m.connected = true;
    m.disconnectedAt = null;
  }

  // -------------------------------------------------------------------------
  // Hand driver
  // -------------------------------------------------------------------------

  /** Seated players who will be dealt into the next hand. */
  private eligible(): Member[] {
    return [...this.members.values()].filter(
      (m) => m.role === 'seated' && !m.sittingOut && m.stack > 0 && m.pending === null && m.connected,
    );
  }

  private scheduleDeal(immediate = false): void {
    if (this.status !== 'running' || this.hand || this.boundary || this.dealTimer || this.closed || this.closing) return;
    if (this.eligible().length < 2) {
      this.broadcast();
      return;
    }
    this.dealTimer = setTimeout(() => {
      this.dealTimer = null;
      this.deal();
    }, immediate ? 0 : this.timing.handGapMs);
  }

  private deal(): void {
    if (this.hand || this.boundary || this.closed || this.closing) return;
    const players = this.eligible();
    if (players.length < 2) {
      this.broadcast();
      return;
    }
    this.buttonSeat = nextButton(this.buttonSeat, players.map((m) => m.seat!));
    this.handsDealt += 1;
    this.hand = startHand({
      handNumber: this.handsDealt,
      buttonSeat: this.buttonSeat,
      players: players.map((m) => ({ id: m.player.id, seat: m.seat!, stack: m.stack })),
      config: { smallBlind: this.rules.smallBlind, bigBlind: this.rules.bigBlind, ante: this.rules.ante },
      random: this.deps.random,
    });
    this.handStartedAt = this.clock();
    this.deps.hooks.changed();
    this.drive();
  }

  /** Move the hand along until someone must act or it completes. */
  private drive(): void {
    const hand = this.hand;
    if (!hand) return;
    const { state } = hand;
    if (state.phase === 'betting') {
      this.startTurn(hand);
      this.broadcast();
      return;
    }
    if (state.phase === 'dealing') {
      this.clearTurn();
      this.broadcast();
      const runout = state.players.filter((p) => !p.folded && !p.allIn).length < 2;
      this.stepTimer = setTimeout(() => {
        this.stepTimer = null;
        if (this.hand !== hand) return;
        progress(hand);
        this.drive();
      }, runout ? this.timing.runoutMs : this.timing.streetMs);
      return;
    }
    this.conclude(hand).catch((err) => this.log('finishing the hand failed', err));
  }

  private startTurn(hand: Hand): void {
    this.clearTurn();
    const idx = hand.state.toAct!;
    const playerId = hand.state.players[idx].id;
    const ms = this.timing.turnMs ?? this.rules.turnSeconds * 1000;
    this.turnDeadline = this.clock() + ms;
    this.turnTimer = setTimeout(() => this.onTimeout(hand, idx, playerId), ms);
  }

  private onTimeout(hand: Hand, idx: number, playerId: string): void {
    this.turnTimer = null;
    if (this.hand !== hand || hand.state.toAct !== idx || hand.state.phase !== 'betting') return;
    const legal = legalActions(hand.state)!;
    applyAction(hand, playerId, { type: legal.canCheck ? 'check' : 'fold' });
    const m = this.members.get(playerId);
    if (m) {
      m.timeouts += 1;
      if (m.timeouts >= TIMEOUTS_TO_SIT_OUT && !m.sittingOut) {
        m.sittingOut = true;
        this.deps.hooks.notice(playerId, {
          tone: 'info', title: "You've been sat out", body: 'You missed two turns in a row. Tap "I\'m back" when you return.',
        });
      }
    }
    this.drive();
  }

  private clearTurn(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnDeadline = null;
  }

  private async conclude(hand: Hand): Promise<void> {
    this.clearTurn();
    this.boundary = true;
    const { state } = hand;
    const result = state.result!;
    for (const p of state.players) {
      const m = this.members.get(p.id);
      if (m) m.stack = p.stack;
    }
    this.broadcast();

    const now = this.clock();
    const facts = buildHandFacts({ state, tableId: this.tableId, startedAt: this.handStartedAt, now });
    const history = buildHistory(state, this.tableId);
    const stacks = state.players.map((p) => ({ playerId: p.id, stack: p.stack }));
    const hold = result.wentToShowdown ? this.timing.showdownMs : this.timing.foldWinMs;

    const persisted = this.serial.run(async () => {
      try {
        await this.deps.bank.checkpoint(this.tableId, state.handNumber, stacks);
      } catch (err) {
        this.log('checkpoint failed', err);
      }
      try {
        const outcome = await this.deps.recorder.recordHand(facts, history);
        for (const up of outcome.levelUps) {
          this.deps.hooks.notice(up.playerId, { tone: 'good', title: `Level ${up.level}!`, body: `+${formatChips(up.reward)} chips` });
          this.deps.hooks.activity({ kind: 'level-up', playerId: up.playerId, playerName: this.nameOf(up.playerId), text: `reached level ${up.level}` });
        }
        for (const done of outcome.completed) {
          this.deps.hooks.notice(done.playerId, { tone: 'good', title: 'Challenge complete', body: `${done.challenge.title} — claim your reward.` });
          this.deps.hooks.activity({ kind: 'challenge', playerId: done.playerId, playerName: this.nameOf(done.playerId), text: `completed “${done.challenge.title}”` });
        }
      } catch (err) {
        this.log('recording the hand failed', err);
      }
      for (const p of state.players) this.deps.hooks.balanceChanged(p.id);
    });
    this.announce(hand);

    await Promise.all([persisted, sleep(hold)]);
    await this.serial.run(() => this.resolveBoundary());
    if (this.hand === hand) this.hand = null;
    this.boundary = false;
    if (this.closing) {
      await this.closeNow('The host closed the table.');
      return;
    }
    this.afterMembershipChange();
    this.broadcast();
    this.scheduleDeal();
  }

  /** Post noteworthy hands to the room's activity feed. */
  private announce(hand: Hand): void {
    const { state } = hand;
    const result = state.result!;
    for (const pot of result.pots) {
      if (pot.winnerIds.length !== 1) continue;
      const id = pot.winnerIds[0];
      const shown = result.shown[id];
      if (shown && ['four-of-a-kind', 'straight-flush', 'royal-flush'].includes(shown.category)) {
        this.deps.hooks.activity({ kind: 'rare-hand', playerId: id, playerName: this.nameOf(id), text: `showed ${shown.label.toLowerCase()}` });
      }
    }
    for (const [id, amount] of Object.entries(result.payouts)) {
      if (amount >= this.rules.bigBlind * 50) {
        const label = result.shown[id]?.label;
        this.deps.hooks.activity({
          kind: 'big-win', playerId: id, playerName: this.nameOf(id),
          text: `won ${formatChips(amount)}${label ? ` with ${label.toLowerCase()}` : ''}`,
        });
      }
    }
  }

  /** Apply queued changes between hands: top-ups, busts, stands, leaves, disconnects. */
  private async resolveBoundary(): Promise<void> {
    await this.retryFailedCashouts();
    const now = this.clock();
    for (const m of [...this.members.values()]) {
      if (m.role !== 'seated') continue;
      if (m.pending === 'leave') { await this.release(m, 'leave'); continue; }
      if (m.pending === 'stand') { await this.release(m, 'stand'); continue; }
      if (m.pendingTopUp > 0) {
        const amount = m.pendingTopUp;
        m.pendingTopUp = 0;
        await this.applyTopUp(m, amount);
      }
      if (m.stack <= 0) { await this.release(m, 'bust'); continue; }
      if (!m.connected) {
        m.sittingOut = true;
        if (m.disconnectedAt !== null && now - m.disconnectedAt >= this.timing.disconnectStandMs) {
          await this.release(m, 'leave');
        }
      }
    }
  }

  /** Idle tables still need to clear out players who disconnected. */
  private async sweep(): Promise<void> {
    if (this.closed || this.hand || this.boundary) return;
    const now = this.clock();
    const gone = [...this.members.values()].filter(
      (m) => m.role === 'seated' && !m.connected && m.disconnectedAt !== null && now - m.disconnectedAt >= this.timing.disconnectStandMs,
    );
    if (gone.length === 0 && this.retryCashouts.length === 0) return;
    await this.serial.run(async () => {
      await this.retryFailedCashouts();
      for (const m of gone) if (this.members.get(m.player.id) === m) await this.release(m, 'leave');
    });
    this.afterMembershipChange();
  }

  /**
   * Cash a seated member out (or just remove a spectator). `stand` keeps them
   * watching, `leave` sends them to the lobby, `bust` keeps them watching with a nudge.
   */
  private async release(m: Member, kind: 'stand' | 'leave' | 'bust'): Promise<void> {
    const id = m.player.id;
    if (m.role === 'seated') {
      const stack = m.stack;
      try {
        const r = await this.deps.bank.cashOut({ tableId: this.tableId, playerId: id, stack });
        if (!r.ok) this.log(`cash-out for ${id}: ${r.error}`);
      } catch (err) {
        this.log('cash-out failed; will retry', err);
        this.retryCashouts.push({ playerId: id, stack });
      }
      void this.deps.recorder.recordSession(id, this.clock() - m.seatedAt).catch((err) => this.log('session record failed', err));
      m.role = 'spectator';
      m.seat = null;
      m.stack = 0;
      m.sittingOut = false;
      m.pendingTopUp = 0;
      this.deps.hooks.balanceChanged(id);
    }
    m.pending = null;
    if (kind === 'leave') {
      this.members.delete(id);
      this.deps.hooks.left(id, 'You left the table.');
    } else if (kind === 'bust') {
      this.deps.hooks.notice(id, { tone: 'info', title: "You're out of chips", body: 'Take a seat again to buy back in.' });
    }
  }

  private async retryFailedCashouts(): Promise<void> {
    const pending = this.retryCashouts.splice(0);
    for (const c of pending) {
      try {
        await this.deps.bank.cashOut({ tableId: this.tableId, ...c });
        this.deps.hooks.balanceChanged(c.playerId);
      } catch (err) {
        this.log('cash-out retry failed', err);
        this.retryCashouts.push(c);
      }
    }
  }

  /** After seats/members change: hand the host on, and close an abandoned table. */
  private afterMembershipChange(): void {
    if (this.closed) return;
    if (this.hostId && !this.members.has(this.hostId)) {
      const seated = [...this.members.values()].filter((m) => m.role === 'seated');
      const next = seated[0] ?? [...this.members.values()][0];
      this.hostId = next?.player.id ?? null;
      if (next) this.deps.hooks.notice(next.player.id, { tone: 'info', title: "You're the host now", body: 'You can change the rules or close the table.' });
    }
    const seatedCount = [...this.members.values()].filter((m) => m.role === 'seated').length;
    if (this.members.size === 0 || (this.status === 'running' && seatedCount === 0 && !this.hand)) {
      void this.closeNow('Everyone left the table.');
      return;
    }
    this.broadcast();
    this.deps.hooks.changed();
    this.scheduleDeal();
  }

  private async closeNow(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    await this.serial.run(async () => {
      for (const m of [...this.members.values()]) {
        if (m.role === 'seated') await this.release(m, 'stand');
        this.members.delete(m.player.id);
        this.deps.hooks.left(m.player.id, reason);
      }
      await this.retryFailedCashouts();
    });
    this.deps.hooks.closed();
  }

  /** Stop timers (tests / shutdown). Does not cash anyone out. */
  dispose(): void {
    this.closed = true;
    this.clearTimers();
  }

  /** Resolves once queued bank work has finished (tests). */
  settled(): Promise<void> {
    return this.serial.idle();
  }

  private clearTimers(): void {
    this.clearTurn();
    if (this.stepTimer) clearTimeout(this.stepTimer);
    if (this.dealTimer) clearTimeout(this.dealTimer);
    clearInterval(this.sweepTimer);
    this.stepTimer = null;
    this.dealTimer = null;
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  private occupant(seat: number): Member | undefined {
    return [...this.members.values()].find((m) => m.seat === seat);
  }

  private inHand(playerId: string): boolean {
    const h = this.hand?.state;
    return !!h && h.phase !== 'complete' && h.players.some((p) => p.id === playerId);
  }

  private liveStack(m: Member): number {
    const p = this.hand?.state.players.find((x) => x.id === m.player.id);
    return p && this.hand!.state.phase !== 'complete' ? p.stack : m.stack;
  }

  private nameOf(id: string): string | null {
    return this.members.get(id)?.player.name ?? null;
  }

  private broadcast(): void {
    for (const id of this.members.keys()) this.sendTo(id);
  }

  private sendTo(playerId: string): void {
    if (!this.members.has(playerId)) return;
    this.deps.hooks.sendView(playerId, this.viewFor(playerId));
  }

  /** The table as `viewerId` may see it — opponents' cards hidden until shown. */
  viewFor(viewerId: string): TableView {
    const state = this.hand?.state ?? null;
    const complete = state?.phase === 'complete';
    const result = state?.result ?? null;
    const live = state ? state.players.filter((p) => !p.folded) : [];
    // All-in with betting over: live hands are turned face up for the run-out.
    const allInReveal = !!state && !complete && state.phase === 'dealing' && live.length >= 2
      && live.filter((p) => !p.allIn).length < 2;

    const seats = Array.from({ length: this.rules.maxSeats }, (_, seat) => {
      const m = this.occupant(seat);
      if (!m) return { seat, player: null };
      const ep = state?.players.find((p) => p.id === m.player.id) ?? null;
      const own = m.player.id === viewerId;
      const shown = !!ep && !ep.folded && (allInReveal || (complete && !!result && m.player.id in result.shown));
      const visible = !!ep && (own || shown);
      const player: SeatPlayer = {
        ...m.player,
        stack: ep && !complete ? ep.stack : m.stack,
        state: m.sittingOut ? 'sitting-out' : state && !ep ? 'waiting' : 'playing',
        connected: m.connected,
        inHand: !!ep,
        folded: ep?.folded ?? false,
        allIn: ep?.allIn ?? false,
        committed: ep && !complete ? ep.committed : 0,
        holeCards: visible ? ep!.cards : null,
        hasHiddenCards: !!ep && !ep.folded && !visible,
        lastAction: ep?.lastAction ?? null,
        pending: m.pending,
        sittingOut: m.sittingOut,
        pendingTopUp: m.pendingTopUp,
      };
      return { seat, player };
    });

    const me = this.members.get(viewerId);
    const toActId = state && state.toAct !== null ? state.players[state.toAct].id : null;
    const legal = state && toActId === viewerId ? legalActions(state) : null;

    let resultView: HandResultView | null = null;
    if (complete && result) {
      resultView = {
        payouts: result.payouts,
        pots: result.pots.map((p) => ({ amount: p.amount, winnerIds: p.winnerIds, handLabel: p.handLabel })),
        shown: Object.fromEntries(Object.entries(result.shown).map(([id, r]) => {
          const cards = state!.players.find((p) => p.id === id)!.cards;
          return [id, { cards, category: r.category, label: r.label, best: r.cards }];
        })),
        returned: result.returned,
        wentToShowdown: result.wentToShowdown,
      };
    }

    return {
      tableId: this.tableId,
      instanceId: this.instanceId,
      rules: this.rules,
      status: this.status,
      hostId: this.hostId,
      seats,
      spectators: [...this.members.values()].filter((m) => m.role === 'spectator').map((m) => m.player),
      hand: state ? {
        handNumber: state.handNumber,
        street: state.street,
        board: state.board,
        pots: settledPots(state),
        potTotal: potTotal(state),
        buttonSeat: state.buttonSeat,
        smallBlindSeat: state.smallBlindSeat,
        bigBlindSeat: state.bigBlindSeat,
        toActSeat: state.toAct !== null ? state.players[state.toAct].seat : null,
        actionEndsAt: this.turnDeadline,
        currentBet: state.currentBet,
        result: resultView,
      } : null,
      handsDealt: this.handsDealt,
      closing: this.closing,
      you: {
        id: viewerId,
        role: me?.role ?? 'spectator',
        seat: me?.seat ?? null,
        bankroll: 0, // filled in by the socket layer
        pending: me?.pending ?? null,
        sittingOut: me?.sittingOut ?? false,
        pendingTopUp: me?.pendingTopUp ?? 0,
        legal,
        emotes: me?.emotes ?? [],
      },
      serverNow: this.clock(),
    };
  }

  /** Cards-free summary for the lobby. */
  summary(): TableSummary {
    const host = this.hostId ? this.members.get(this.hostId) : undefined;
    return {
      tableId: this.tableId,
      rules: this.rules,
      status: this.status,
      hostId: this.hostId,
      hostName: host?.player.name ?? null,
      seats: Array.from({ length: this.rules.maxSeats }, (_, seat) => {
        const m = this.occupant(seat);
        return { seat, player: m ? { ...m.player, stack: this.liveStack(m) } : null };
      }),
      spectatorCount: [...this.members.values()].filter((m) => m.role === 'spectator').length,
      handsDealt: this.handsDealt,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
