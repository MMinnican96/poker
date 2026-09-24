import type { Db } from '../db/client.js';
import { Bank } from './bank.js';
import { ChatService } from './chat.js';
import { ProfileService } from './profiles.js';
import { HandRecorder } from './recorder.js';
import { RewardsService } from './rewards.js';
import { ServerLease } from './leases.js';
import { ShopService } from './shop.js';
import { StatsRepository } from './stats-repo.js';

export interface Services {
  db: Db;
  bank: Bank;
  recorder: HandRecorder;
  stats: StatsRepository;
  shop: ShopService;
  rewards: RewardsService;
  chat: ChatService;
  profiles: ProfileService;
}

export interface ServiceOptions {
  /** This process's server lease; seats it opens carry it (see ServerLease). */
  leaseId?: string | null;
}

export function createServices(db: Db, clock: () => Date = () => new Date(), opts: ServiceOptions = {}): Services {
  const bank = new Bank(db, opts.leaseId ?? null);
  const shop = new ShopService(db);
  const rewards = new RewardsService(db, clock);
  const chat = new ChatService(db);
  const stats = new StatsRepository(db);
  return {
    db,
    bank,
    recorder: new HandRecorder(db, clock),
    stats,
    shop,
    rewards,
    chat,
    profiles: new ProfileService(db, { bank, shop, rewards, chat, stats }),
  };
}

export { Bank, ChatService, HandRecorder, ProfileService, RewardsService, ServerLease, ShopService, StatsRepository };
