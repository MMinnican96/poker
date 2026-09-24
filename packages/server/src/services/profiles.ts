import type { PlayerSelf, ProfileCard, HandCategory } from '@poker/shared';
import { CATEGORY_ORDER, levelFromXp } from '@poker/shared';
import type { Db } from '../db/client.js';
import { getPlayerRow, loadoutOf, toPublic } from './players.js';
import type { AchievementService } from './achievements.js';
import type { Bank } from './bank.js';
import type { ShopService } from './shop.js';
import type { RewardsService } from './rewards.js';
import type { ChatService } from './chat.js';
import type { StatsRepository } from './stats-repo.js';

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
      achievements: AchievementService;
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
    const [stats, form, owned, escrow, trophies] = await Promise.all([
      this.deps.stats.summary(playerId),
      this.deps.stats.recentForm(playerId, 20),
      this.deps.shop.owned(playerId),
      this.deps.bank.escrowed(playerId),
      this.deps.achievements.trophies(playerId),
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
      trophies,
      itemsOwned,
    };
  }
}
