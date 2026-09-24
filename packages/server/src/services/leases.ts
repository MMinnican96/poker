import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { serverLeases } from '../db/schema.js';

/** How often a live process refreshes its lease. */
export const LEASE_HEARTBEAT_MS = 15_000;
/** How often a process looks for seats left behind by dead ones. */
export const LEASE_RECOVERY_MS = 30_000;

/**
 * This process's server lease: a row in `server_leases` kept fresh by a
 * heartbeat. Seats the process opens carry the lease id; once the heartbeat
 * stops (crash) the lease goes stale and any process's recovery may refund
 * those seats. A graceful shutdown cashes everyone out, then releases it.
 */
export class ServerLease {
  readonly id: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Db, id: string = randomUUID(), private readonly log = (m: string, e?: unknown) => console.error(`[lease] ${m}`, e ?? '')) {
    this.id = id;
  }

  /** Create the lease row. Call before any seat is opened. */
  async register(): Promise<void> {
    await this.db.insert(serverLeases).values({ id: this.id })
      .onConflictDoUpdate({ target: serverLeases.id, set: { heartbeatAt: sql`now()` } });
  }

  /** Refresh the lease (re-creating it if something deleted it). */
  async heartbeat(): Promise<void> {
    const updated = await this.db.update(serverLeases).set({ heartbeatAt: sql`now()` })
      .where(eq(serverLeases.id, this.id)).returning({ id: serverLeases.id });
    if (updated.length === 0) await this.register();
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
    await this.db.delete(serverLeases).where(eq(serverLeases.id, this.id));
  }
}
