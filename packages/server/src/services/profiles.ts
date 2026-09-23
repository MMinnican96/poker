import type { Badge, PlayerSelf, PlayerStatsSummary, ProfileCard, HandCategory } from '@poker/shared';
import { CATEGORY_ORDER, levelFromXp } from '@poker/shared';
import type { Db } from '../db/client.js';
import { getPlayerRow, loadoutOf, toPublic } from './players.js';
import type { Bank } from './bank.js';
import type { ShopService } from './shop.js';
import type { RewardsService } from './rewards.js';
import type { ChatService } from './chat.js';
import type { StatsRepository } from './stats-repo.js';

/** Achievement badges, derived from stats at read time. */
export function badgesFor(stats: PlayerStatsSummary, level: number, itemsOwned: number): Badge[] {
  const out: Badge[] = [];
  const has = (c: HandCategory) => (stats.categoryCounts[c] ?? 0) > 0;
  if (has('royal-flush')) out.push({ id: 'royal', name: 'Royalty', description: 'Showed down a royal flush.' });
  if (has('straight-flush')) out.push({ id: 'steel', name: 'Steel wheel', description: 'Showed down a straight flush.' });
  if (has('four-of-a-kind')) out.push({ id: 'quads', name: 'Quads', description: 'Showed down four of a kind.' });
  if (stats.handsPlayed >= 1000) out.push({ id: 'grinder', name: 'Grinder', description: 'Played 1,000 hands.' });
  else if (stats.handsPlayed >= 100) out.push({ id: 'regular', name: 'Regular', description: 'Played 100 hands.' });
  if (stats.biggestPotWon >= 50_000) out.push({ id: 'whale', name: 'Whale', description: 'Won a pot of 50,000 or more.' });
  else if (stats.biggestPotWon >= 10_000) out.push({ id: 'big-fish', name: 'Big fish', description: 'Won a pot of 10,000 or more.' });
  if (level >= 25) out.push({ id: 'veteran', name: 'Veteran', description: 'Reached level 25.' });
  else if (level >= 10) out.push({ id: 'made-rat', name: 'Made rat', description: 'Reached level 10.' });
  if (itemsOwned >= 10) out.push({ id: 'collector', name: 'Collector', description: 'Owns 10 shop items.' });
  return out;
}

function bestCategory(counts: Partial<Record<HandCategory, number>>): HandCategory | null {
  for (let i = CATEGORY_ORDER.length - 1; i >= 0; i--) {
    if ((counts[CATEGORY_ORDER[i]] ?? 0) > 0) return CATEGORY_ORDER[i];
  }
  return null;
}

export class ProfileService {
  constructor(
    private readonly db: Db,
    private readonly deps: {
      bank: Bank;
      shop: ShopService;
      rewards: RewardsService;
      chat: ChatService;
      stats: StatsRepository;
    },
  ) {}

  async self(playerId: string): Promise<PlayerSelf | null> {
    const row = await getPlayerRow(this.db, playerId);
    if (!row) return null;
    const [owned, daily, unreadMessages, unclaimedChallenges] = await Promise.all([
      this.deps.shop.owned(playerId),
      this.deps.rewards.dailyStatus(playerId),
      this.deps.chat.unreadTotal(playerId),
      this.deps.rewards.unclaimedCount(playerId),
    ]);
    return {
      id: row.discordUserId,
      name: row.displayName,
      avatarUrl: row.avatarUrl ?? '',
      balance: row.chipBalance,
      xp: row.xp,
      level: levelFromXp(row.xp),
      loadout: loadoutOf(row),
      owned,
      daily,
      unreadMessages,
      unclaimedChallenges,
    };
  }

  async card(playerId: string): Promise<ProfileCard | null> {
    const row = await getPlayerRow(this.db, playerId);
    if (!row) return null;
    const [stats, form, owned, escrow] = await Promise.all([
      this.deps.stats.summary(playerId),
      this.deps.stats.recentForm(playerId, 20),
      this.deps.shop.owned(playerId),
      this.deps.bank.escrowed(playerId),
    ]);
    const pub = toPublic(row);
    const progress = levelFromXp(row.xp);
    const itemsOwned = Object.keys(owned).length;
    return {
      ...pub,
      levelProgress: progress,
      joinedAt: row.createdAt.toISOString(),
      bankroll: row.chipBalance + escrow,
      stats: {
        handsPlayed: stats.handsPlayed,
        winRate: stats.winRate,
        netProfit: stats.netProfit,
        biggestPotWon: stats.biggestPotWon,
        bestHand: bestCategory(stats.categoryCounts),
        vpip: stats.vpip,
        pfr: stats.pfr,
        aggressionFactor: stats.aggressionFactor,
        showdownWinRate: stats.showdownWinRate,
        sessionsPlayed: stats.sessionsPlayed,
        totalPlayMs: stats.totalPlayMs,
      },
      recentForm: form,
      badges: badgesFor(stats, progress.level, itemsOwned),
      itemsOwned,
    };
  }
}
