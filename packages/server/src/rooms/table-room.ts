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
  type TableLeft,
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
  /**
   * The result stays up at least this long after a player turns on showing
   * their cards during it (once per player per hand), so the table sees them.
   */
  showGraceMs: number;
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
  foldWinMs: 3500,
  showGraceMs: 2500,
  handGapMs: 1500,
  disconnectStandMs: 90_000,
  sweepMs: 10_000,
};

/** Missed turns in a row before a player is sat out. */
const TIMEOUTS_TO_SIT_OUT = 2;

/** What members are told when they stop being at the table. */
export const LEFT = {
  left: { code: 'left', reason: 'You left the table.' },
  hostClosed: { code: 'host-closed', reason: 'The host closed the table.' },
  abandoned: { code: 'abandoned', reason: 'Everyone left the table.' },
  removed: { code: 'removed', reason: 'You were away too long, so your chips went back to your bankroll.' },
  shutdown: { code: 'shutdown', reason: 'The server is restarting. Your chips are back in your bankroll.' },
  interrupted: {
    code: 'interrupted',
    reason: 'The table was interrupted by a server problem. Your chips from before the last hand are going back to your bankroll.',
  },
} as const satisfies Record<string, TableLeft>;

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const OK: Result = { ok: true };

/** How the table talks to the outside world (sockets, lobby). */
export interface TableHooks {
  sendView(playerId: string, view: TableView): void;
  fx(fx: TableFx): void;
  /** The player is no longer a table member. */
  left(playerId: string, left: TableLeft): void;
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
  /**
   * Why chips can't be moved onto tables right now (server restarting, lease
   * lost), or null. Checked before every buy-in and top-up.
   */
  gate?: () => string | null;
}

interface Member {
  player: PublicPlayer;
  role: 'seated' | 'spectator';
  seat: number | null;
  /** The escrow row (`table_seats.id`) holding this member's chips while seated. */
  seatId: string | null;
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
  /** Stats/XP/challenge recording, kept off the table queue (see conclude()). */
  private readonly recordings = new Serial();
  private readonly fxLimit: RateLimiter;
  private readonly showLimit: RateLimiter;
  private readonly timing: TableTiming;
  private readonly clock: () => number;
  private readonly log: (message: string, err?: unknown) => void;

  private hand: Hand | null = null;
  /** Players who asked to show their cards this hand (cleared when a hand is dealt or cleared). */
  private readonly showing = new Set<string>();
  /** Players whose show already extended this hand's result (each may extend it once). */
  private readonly graced = new Set<string>();
  /** Clock time the current result must stay up until, pushed out by showCards(). */
  private resultUntil = 0;
  private handStartedAt = 0;
  private handsDealt = 0;
  private buttonSeat: number | null = null;
  /** True between a hand completing and the next one being dealable. */
  private boundary = false;
  private closing = false;
  private closed = false;
  private turnStartedAt: number | null = null;
  private turnDeadline: number | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private dealTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  /** Cash-outs that failed (e.g. DB unavailable) and are retried each boundary. */
  private readonly retryCashouts: { seatId: string; playerId: string; stack: number }[] = [];

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
    this.showLimit = new RateLimiter(6, 5000, this.clock);
    this.sweepTimer = setInterval(() => {
      this.sweep().catch((err) => this.log('sweep failed', err));
    }, this.timing.sweepMs);
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
    // Insert before any await: a second concurrent watch/take-seat must find this
    // member rather than create (and later overwrite it with) another one.
    const m: Member = {
      player, role: 'spectator', seat: null, seatId: null, stack: 0, sittingOut: false, pending: null, pendingTopUp: 0,
      connected: true, disconnectedAt: null, seatedAt: 0, timeouts: 0,
      emotes: emotesFor({}),
    };
    this.members.set(player.id, m);
    this.broadcast();
    this.deps.hooks.changed();
    try {
      const owned = await this.deps.shop.owned(player.id);
      if (this.members.get(player.id) === m) {
        m.emotes = emotesFor(owned);
        this.sendTo(player.id);
      }
    } catch (err) {
      this.log('loading emotes failed', err);
    }
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
      const blocked = this.deps.gate?.();
      if (blocked) return fail(blocked);
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
        // The chips are in escrow now, so this member must stay on the books even
        // if they disconnected (or re-joined) while the buy-in was in flight.
        const current = this.members.get(playerId);
        if (current !== m) {
          if (current) {
            m.player = current.player;
            m.connected = current.connected;
            m.disconnectedAt = current.disconnectedAt;
            m.emotes = current.emotes;
          } else {
            m.connected = false;
            m.disconnectedAt = this.clock();
          }
          this.members.set(playerId, m);
        }
        m.role = 'seated';
        m.seat = seat;
        m.seatId = r.seatId;
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
    if (!Number.isInteger(amount) || amount <= 0) return fail('Add a whole number of chips.');
    // Checked and applied in the queue, so concurrent top-ups see each other and
    // a hand can't be dealt while the chips are moving.
    return this.serial.run(async () => {
      const blocked = this.deps.gate?.();
      if (blocked) return fail(blocked);
      const m = this.members.get(playerId);
      if (!m || m.role !== 'seated') return fail('Take a seat first.');
      if (this.liveStack(m) + m.pendingTopUp + amount > this.rules.maxBuyIn) {
        return fail(`You can have at most ${formatChips(this.rules.maxBuyIn)} chips at this table.`);
      }
      if (this.inHand(playerId) || this.boundary) {
        m.pendingTopUp += amount;
        this.broadcast();
        return OK;
      }
      return this.applyTopUp(m, amount);
    });
  }

  /** Move chips onto a seat. Runs inside the serial queue. */
  private async applyTopUp(m: Member, amount: number): Promise<Result> {
    if (!m.seatId) return fail('Take a seat first.');
    try {
      const r = await this.deps.bank.topUp({ seatId: m.seatId, playerId: m.player.id, amount });
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
    // Decided inside the queue: a deal queued ahead of us may have put them in a
    // hand, and a deal queued behind us must not see them half cashed out.
    return this.serial.run(async () => {
      const m = this.members.get(playerId);
      if (!m || m.role !== 'seated') return fail("You're not seated.");
      if (this.inHand(playerId) || this.boundary) {
        m.pending = 'stand';
        this.broadcast();
        return OK;
      }
      await this.release(m, 'stand');
      this.afterMembershipChange();
      return OK;
    });
  }

  /** Leave for the lobby. Seated players in a hand leave when it ends. */
  async leave(playerId: string): Promise<Result> {
    return this.serial.run(async () => {
      const m = this.members.get(playerId);
      if (!m) return fail("You're not at the table.");
      if (m.role === 'seated' && (this.inHand(playerId) || this.boundary)) {
        m.pending = 'leave';
        this.broadcast();
        return OK;
      }
      await this.release(m, 'leave');
      this.afterMembershipChange();
      return OK;
    });
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

  async updateRules(playerId: string, patch: Partial<TableRules>): Promise<Result> {
    const check = (): Result | null => {
      if (this.closed) return fail('This table has closed.');
      if (playerId !== this.hostId) return fail('Only the host can change the rules.');
      if (this.status !== 'open') return fail('Rules are locked once the game starts.');
      return null;
    };
    const blocked = check();
    if (blocked) return blocked;
    const early = validateRules(patch, this.rules);
    if (!early.ok) return early;
    // A new felt must be one the host owns (as when opening the table).
    if (early.rules.feltId !== this.rules.feltId && !(await this.deps.shop.owns(playerId, early.rules.feltId))) {
      return fail("You don't own that felt.");
    }
    // Re-check after the await: host, status or rules may have changed meanwhile.
    const late = check();
    if (late) return late;
    const r = validateRules(patch, this.rules);
    if (!r.ok) return r;
    // Seats held by a buy-in still in flight count too.
    const highest = Math.max(-1, ...[...this.members.values()].map((m) => m.seat ?? -1), ...this.reserved);
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
    await this.closeNow(LEFT.hostClosed);
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

  /**
   * Show (or hide again) your cards to everyone once the hand is complete.
   * Open to anyone dealt into the hand, folded or not, until the result is
   * cleared. Mid-hand it only records the choice (and tells nobody else), so
   * nothing leaks before the end. Cards tabled at showdown stay face up.
   *
   * Synchronous on purpose: it moves no chips and has no await, so it sees the
   * hand exactly as it is at that moment — before `conclude()` clears it (the
   * change is broadcast at once) or after (a clean error). `handNumber` stops a
   * request meant for a finished hand from applying to the next one.
   */
  showCards(playerId: string, show: boolean, handNumber?: number): Result {
    if (this.closed) return fail('This table has closed.');
    const m = this.members.get(playerId);
    if (!m) return fail("You're not at the table.");
    const hand = this.hand;
    if (!hand || (handNumber !== undefined && handNumber !== hand.state.handNumber)) {
      return fail(handNumber === undefined ? 'No hand is in play.' : 'That hand has already moved on.');
    }
    const { state } = hand;
    if (m.role !== 'seated' || !state.players.some((p) => p.id === playerId)) {
      return fail("You weren't dealt into this hand.");
    }
    const complete = state.phase === 'complete';
    const tabled = complete && !!state.result && playerId in state.result.shown;
    if (tabled && !show) return fail('Cards shown at showdown stay face up.');
    if (tabled || this.showing.has(playerId) === show) return OK;
    if (!this.showLimit.allow(playerId)) return fail('Slow down a little.');
    if (show) this.showing.add(playerId);
    else this.showing.delete(playerId);
    // Showing during the result: keep it up long enough for the table to see.
    // Once per player per hand, so toggling can't hold the table open forever.
    if (show && complete && !this.graced.has(playerId)) {
      this.graced.add(playerId);
      this.resultUntil = Math.max(this.resultUntil, this.clock() + this.timing.showGraceMs);
    }
    // Mid-hand only your own view changes; everyone sees the cards once it's over.
    if (complete) this.broadcast();
    else this.sendTo(playerId);
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
      // Through the queue: a hand is never dealt while chips are moving for
      // anyone at the table (buy-ins, top-ups, cash-outs, checkpoints).
      void this.serial.run(() => this.deal()).catch((err) => this.log('dealing failed', err));
    }, immediate ? 0 : this.timing.handGapMs);
  }

  /** Deal the next hand. Runs inside the serial queue; eligibility is re-checked here. */
  private deal(): void {
    if (this.hand || this.boundary || this.closed || this.closing) return;
    const players = this.eligible();
    if (players.length < 2) {
      this.broadcast();
      return;
    }
    this.buttonSeat = nextButton(this.buttonSeat, players.map((m) => m.seat!));
    this.handsDealt += 1;
    this.showing.clear();
    this.graced.clear();
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
    this.turnStartedAt = this.clock();
    this.turnDeadline = this.turnStartedAt + ms;
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
    this.turnStartedAt = null;
    this.turnDeadline = null;
  }

  private async conclude(hand: Hand): Promise<void> {
    this.clearTurn();
    this.boundary = true;
    this.resultUntil = 0;
    const { state } = hand;
    const result = state.result!;
    for (const p of state.players) {
      const m = this.members.get(p.id);
      if (m) m.stack = p.stack;
    }
    this.broadcast();

    const now = this.clock();
    const facts = buildHandFacts({ state, tableId: this.tableId, startedAt: this.handStartedAt, now });
    const cardBacks = Object.fromEntries(state.players.flatMap((p) => {
      const back = this.members.get(p.id)?.player.cosmetics.cardBack;
      return back ? [[p.id, back]] : [];
    }));
    const history = buildHistory(state, this.tableId, cardBacks);
    const stacks = state.players.flatMap((p) => {
      const seatId = this.members.get(p.id)?.seatId;
      return seatId ? [{ seatId, stack: p.stack }] : [];
    });
    const hold = result.wentToShowdown ? this.timing.showdownMs : this.timing.foldWinMs;

    // The checkpoint stays in the queue: chip movements must apply in order.
    const persisted = this.serial.run(async () => {
      try {
        await this.deps.bank.checkpoint(state.handNumber, stacks);
      } catch (err) {
        this.log('checkpoint failed', err);
      }
    });
    // Stats, XP and challenges are recorded off the queue (in their own ordered
    // queue), so a slow database doesn't hold up the next deal, seat or leave.
    void this.recordings.run(async () => {
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
    }).catch((err) => this.log('recording the hand failed', err));
    this.announce(hand);

    await Promise.all([persisted, sleep(hold)]);
    // A show during the result may have pushed its end out. Each player extends
    // it at most once, so this ends even with a clock that doesn't move (tests).
    for (let seen = -1; this.resultUntil > this.clock() && this.resultUntil !== seen;) {
      seen = this.resultUntil;
      await sleep(this.resultUntil - this.clock());
    }
    // Leave the boundary in the same queued step that resolves it, so a request
    // queued behind it sees "between hands" and applies at once rather than
    // being deferred to a boundary that has already passed.
    await this.serial.run(async () => {
      await this.resolveBoundary();
      if (this.hand === hand) {
        this.hand = null;
        this.showing.clear();
        this.graced.clear();
      }
      this.boundary = false;
    });
    if (this.closed) return;
    if (this.closing) {
      await this.closeNow(LEFT.hostClosed);
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
        const requested = m.pendingTopUp;
        m.pendingTopUp = 0;
        // Queued against the stack behind mid-hand; a pot won since may leave less room.
        const room = Math.max(0, this.rules.maxBuyIn - m.stack);
        const amount = Math.min(requested, room);
        if (amount <= 0) {
          this.deps.hooks.notice(m.player.id, {
            tone: 'info', title: 'Chips not added',
            body: `You already have the table maximum of ${formatChips(this.rules.maxBuyIn)} chips.`,
          });
        } else {
          if (amount < requested) {
            this.deps.hooks.notice(m.player.id, {
              tone: 'info', title: 'Top-up reduced',
              body: `Added ${formatChips(amount)} instead of ${formatChips(requested)} to stay within the ${formatChips(this.rules.maxBuyIn)} table maximum.`,
            });
          }
          await this.applyTopUp(m, amount);
        }
      }
      if (m.stack <= 0) { await this.release(m, 'bust'); continue; }
      if (!m.connected) {
        m.sittingOut = true;
        if (m.disconnectedAt !== null && now - m.disconnectedAt >= this.timing.disconnectStandMs) {
          await this.release(m, 'remove');
        }
      }
    }
  }

  /** Idle tables still need to clear out players who disconnected. */
  private async sweep(): Promise<void> {
    const idle = () => !this.closed && !this.hand && !this.boundary;
    const gone = () => {
      const now = this.clock();
      return [...this.members.values()].filter(
        (m) => m.role === 'seated' && !m.connected && m.disconnectedAt !== null && now - m.disconnectedAt >= this.timing.disconnectStandMs,
      );
    };
    if (!idle() || (gone().length === 0 && this.retryCashouts.length === 0)) return;
    const changed = await this.serial.run(async () => {
      // Re-check in the queue: a hand may have been dealt since.
      if (!idle()) return false;
      await this.retryFailedCashouts();
      for (const m of gone()) if (this.members.get(m.player.id) === m) await this.release(m, 'remove');
      return true;
    });
    if (changed) this.afterMembershipChange();
  }

  /**
   * Cash a seated member out (or just remove a spectator). `stand` keeps them
   * watching, `leave` sends them to the lobby, `remove` does too for someone
   * away too long, and `bust` keeps them watching with a nudge.
   */
  private async release(m: Member, kind: 'stand' | 'leave' | 'remove' | 'bust'): Promise<void> {
    const id = m.player.id;
    if (m.role === 'seated') {
      const stack = m.stack;
      const seatId = m.seatId;
      if (seatId) {
        try {
          const r = await this.deps.bank.cashOut({ seatId, playerId: id, stack });
          if (!r.ok) this.log(`cash-out for ${id}: ${r.error}`);
        } catch (err) {
          this.log('cash-out failed; will retry', err);
          this.retryCashouts.push({ seatId, playerId: id, stack });
        }
      }
      const playMs = this.clock() - m.seatedAt;
      void this.recordings.run(() => this.deps.recorder.recordSession(id, playMs))
        .catch((err) => this.log('session record failed', err));
      m.role = 'spectator';
      m.seat = null;
      m.seatId = null;
      m.stack = 0;
      m.sittingOut = false;
      m.pendingTopUp = 0;
      this.deps.hooks.balanceChanged(id);
    }
    m.pending = null;
    if (kind === 'leave' || kind === 'remove') {
      this.members.delete(id);
      this.deps.hooks.left(id, kind === 'leave' ? LEFT.left : LEFT.removed);
    } else if (kind === 'bust') {
      this.deps.hooks.notice(id, { tone: 'info', title: "You're out of chips", body: 'Take a seat again to buy back in.' });
    }
  }

  private async retryFailedCashouts(): Promise<void> {
    const pending = this.retryCashouts.splice(0);
    for (const c of pending) {
      try {
        await this.deps.bank.cashOut(c);
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
      this.closeNow(LEFT.abandoned).catch((err) => this.log('closing the table failed', err));
      return;
    }
    this.broadcast();
    this.deps.hooks.changed();
    this.scheduleDeal();
  }

  private async closeNow(left: TableLeft): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    await this.serial.run(async () => {
      for (const m of [...this.members.values()]) {
        if (m.role === 'seated') await this.release(m, 'stand');
        this.members.delete(m.player.id);
        this.deps.hooks.left(m.player.id, left);
      }
      await this.retryFailedCashouts();
    });
    this.deps.hooks.closed();
  }

  /**
   * Server shutdown: cash everyone out now and close. A hand in progress is
   * voided — until it completes, each member's `stack` is still their pre-hand
   * stack (the last checkpoint), which is what they get back.
   */
  async shutdown(): Promise<void> {
    if (this.closed) {
      await this.serial.idle();
      return;
    }
    if (this.hand && this.hand.state.phase !== 'complete') this.hand = null;
    await this.closeNow(LEFT.shutdown);
    // Let hand recording finish before the database goes away.
    await this.recordings.idle();
  }

  /**
   * Drop the table without moving any chips: this process lost its server
   * lease, so recovery has refunded (or will refund) every open seat from its
   * last checkpoint — cashing out here too would be wrong. A hand in progress
   * is voided and everyone is sent back to the lobby.
   */
  async abandon(left: TableLeft = LEFT.interrupted): Promise<void> {
    if (this.closed) {
      await this.serial.idle();
      return;
    }
    this.closed = true;
    this.clearTimers();
    if (this.hand && this.hand.state.phase !== 'complete') this.hand = null;
    // In the queue, so a buy-in already in flight lands first (its seat carries
    // the lost lease and is refunded by recovery like the rest).
    await this.serial.run(() => {
      this.retryCashouts.length = 0;
      for (const m of [...this.members.values()]) {
        this.members.delete(m.player.id);
        this.deps.hooks.left(m.player.id, left);
        if (m.role === 'seated') this.deps.hooks.balanceChanged(m.player.id);
      }
      this.reserved.clear();
    });
    this.deps.hooks.closed();
  }

  /** Stop timers (tests). Does not cash anyone out. */
  dispose(): void {
    this.closed = true;
    this.clearTimers();
  }

  /** Resolves once queued bank work and hand recording have finished (tests). */
  async settled(): Promise<void> {
    await this.serial.idle();
    await this.recordings.idle();
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
      // Shown by choice: only once the hand is over, and folded hands too.
      const revealed = !!ep && complete && this.showing.has(m.player.id);
      const visible = !!ep && (own || shown || revealed);
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
        revealed,
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
        actionStartedAt: this.turnStartedAt,
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
        showCards: this.showing.has(viewerId),
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
