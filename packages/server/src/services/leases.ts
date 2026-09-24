import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { serverLeases } from '../db/schema.js';
import { LEASE_STALE_MS } from './bank.js';

/** How often a live process refreshes its lease. */
export const LEASE_HEARTBEAT_MS = 10_000;
/** How often a process looks for seats left behind by dead ones. */
export const LEASE_RECOVERY_MS = 30_000;
/**
 * A process that hasn't heartbeat successfully for this long gives its lease up
 * (and abandons its tables) — well before anyone else may treat the lease as
 * stale (`LEASE_STALE_MS`) and refund its seats, so two processes never both
 * believe they own the same seats.
 */
export const LEASE_LOST_AFTER_MS = LEASE_STALE_MS / 2;

/**
 * Why the lease was lost: `deleted` — the row was gone or already stale when we
 * heartbeat, so another process's recovery may have refunded our seats;
 * `unreachable` — no successful heartbeat for `LEASE_LOST_AFTER_MS`.
 */
export type LeaseLossReason = 'deleted' | 'unreachable';

export interface LeaseLoss {
  /** The lease that was lost (seats carrying it are, or will be, refunded by recovery). */
  leaseId: string;
  reason: LeaseLossReason;
}

export interface LeaseOptions {
  id?: string;
  log?: (message: string, err?: unknown) => void;
  clock?: () => number;
  /** Treat the lease as lost after this long without a successful heartbeat. */
  lostAfterMs?: number;
  /** The age at which other processes may recover our seats. */
  staleMs?: number;
}

/**
 * This process's server lease: a row in `server_leases` kept fresh by a
 * heartbeat. Seats the process opens carry the lease id; once the heartbeat
 * stops (crash) the lease goes stale and any process's recovery may refund
 * those seats. A graceful shutdown cashes everyone out, then releases it.
 *
 * Losing the lease while running — the row was deleted or went stale (another
 * process may already have refunded our seats), or the heartbeat kept failing
 * for `LEASE_LOST_AFTER_MS` — is fatal for every table this process holds:
 * `onLost` must abandon them without cashing anyone out (recovery refunds each
 * seat from its last checkpoint). Once `onLost` has finished, a fresh lease
 * (new id) is registered for new tables and announced through `onRenewed`.
 */
export class ServerLease {
  private currentId: string;
  private held = false;
  private lastBeat: number;
  private beating: Promise<void> | null = null;
  /** Lease ids given up but whose rows may still exist (deleted best-effort so recovery runs at once). */
  private readonly abandoned = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly log: (message: string, err?: unknown) => void;
  private readonly clock: () => number;
  private readonly lostAfterMs: number;
  private readonly staleMs: number;

  /** Abandon every table holding seats under `loss.leaseId` (awaited before a new lease is taken). */
  onLost: ((loss: LeaseLoss) => void | Promise<void>) | null = null;
  /** A fresh lease is held again: stamp new seats with `id`. */
  onRenewed: ((id: string) => void) | null = null;

  constructor(private readonly db: Db, opts: LeaseOptions = {}) {
    this.currentId = opts.id ?? randomUUID();
    this.log = opts.log ?? ((m, e) => console.error(`[lease] ${m}`, e ?? ''));
    this.clock = opts.clock ?? Date.now;
    this.lostAfterMs = opts.lostAfterMs ?? LEASE_LOST_AFTER_MS;
    this.staleMs = opts.staleMs ?? LEASE_STALE_MS;
    this.lastBeat = this.clock();
  }

  /** The lease new seats should carry. */
  get id(): string {
    return this.currentId;
  }

  /** False between losing the lease and registering a fresh one. */
  get isHeld(): boolean {
    return this.held;
  }

  /** Create the lease row. Call before any seat is opened. */
  async register(): Promise<void> {
    await this.db.insert(serverLeases).values({ id: this.currentId })
      .onConflictDoUpdate({ target: serverLeases.id, set: { heartbeatAt: sql`now()` } });
    this.held = true;
    this.lastBeat = this.clock();
  }

  /**
   * Refresh the lease, detecting its loss. While the lease is lost, retries
   * taking a fresh one instead. Overlapping calls share one attempt.
   */
  heartbeat(): Promise<void> {
    this.beating ??= this.beat().finally(() => { this.beating = null; });
    return this.beating;
  }

  private async beat(): Promise<void> {
    if (!this.held) {
      await this.renew();
      return;
    }
    if (this.clock() - this.lastBeat >= this.lostAfterMs) {
      await this.lose('unreachable');
      return;
    }
    let updated: { id: string }[];
    try {
      // Only a lease that isn't stale yet may be refreshed: once it is, another
      // process's recovery may have refunded our seats (it then deletes the row,
      // but a heartbeat landing in between must not resurrect it).
      updated = await this.db.update(serverLeases).set({ heartbeatAt: sql`now()` })
        .where(and(
          eq(serverLeases.id, this.currentId),
          gt(serverLeases.heartbeatAt, sql`now() - make_interval(secs => ${this.staleMs / 1000}::double precision)`),
        ))
        .returning({ id: serverLeases.id });
    } catch (err) {
      if (this.clock() - this.lastBeat >= this.lostAfterMs) await this.lose('unreachable');
      throw err;
    }
    if (updated.length === 0) {
      await this.lose('deleted');
      return;
    }
    this.lastBeat = this.clock();
  }

  /** Give the lease up: abandon its tables (via `onLost`), then take a fresh one. */
  private async lose(reason: LeaseLossReason): Promise<void> {
    if (!this.held) return;
    this.held = false;
    const leaseId = this.currentId;
    this.abandoned.add(leaseId);
    this.log(`LOST server lease ${leaseId} (${reason === 'deleted'
      ? 'it was deleted or went stale — its seats may already have been refunded'
      : `no successful heartbeat for ${Math.round((this.clock() - this.lastBeat) / 1000)}s`}); abandoning this process's tables`);
    try {
      await this.onLost?.({ leaseId, reason });
    } catch (err) {
      this.log('abandoning tables after losing the lease failed', err);
    }
    await this.renew().catch((err) => this.log('could not take a fresh lease yet; retrying on the next heartbeat', err));
  }

  /** Drop abandoned lease rows (so recovery refunds their seats now) and register a new lease. */
  private async renew(): Promise<void> {
    if (this.abandoned.size > 0) {
      await this.db.delete(serverLeases).where(inArray(serverLeases.id, [...this.abandoned]));
      this.abandoned.clear();
    }
    this.currentId = randomUUID();
    await this.register();
    this.log(`registered a fresh server lease ${this.currentId}`);
    this.onRenewed?.(this.currentId);
  }

  /** Heartbeat every `intervalMs` until `stop()`. */
  start(intervalMs = LEASE_HEARTBEAT_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.heartbeat().catch((err) => this.log('heartbeat failed', err));
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stop heartbeating and drop the lease: any seat still open becomes recoverable at once. */
  async release(): Promise<void> {
    this.stop();
    this.held = false;
    await this.db.delete(serverLeases).where(inArray(serverLeases.id, [this.currentId, ...this.abandoned]));
  }
}
