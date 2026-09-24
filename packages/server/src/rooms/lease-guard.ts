import type { Bank } from '../services/bank.js';
import type { ServerLease } from '../services/leases.js';
import { RECONNECTING, type RoomManager } from './instance-room.js';

/**
 * Tie the tables' fate to the server lease. When the lease is lost (another
 * process may already have refunded our seats, or we can't reach the database
 * to prove we're alive), every table is abandoned without cashing anyone out —
 * recovery refunds each seat from its last checkpoint — and nothing new may be
 * opened until a fresh lease is held. New seats then carry the fresh lease.
 */
export function guardTablesWithLease(
  lease: ServerLease,
  bank: Bank,
  rooms: RoomManager,
  log: (message: string, err?: unknown) => void = (m, e) => console.error(`[lease] ${m}`, e ?? ''),
): void {
  lease.onLost = async (loss) => {
    rooms.suspend(RECONNECTING);
    log(`abandoning every table: server lease ${loss.leaseId} lost (${loss.reason}); their seats are refunded by recovery`);
    await rooms.abandonAll();
  };
  lease.onRenewed = (id) => {
    bank.leaseId = id;
    rooms.resume();
  };
}
