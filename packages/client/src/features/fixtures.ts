/** Test data for the feature screens (used by the *.test.tsx files next to each screen). */
import {
  DEFAULT_COSMETICS,
  parseCard,
  type Card,
  type ChallengeStatus,
  type ChatMessage,
  type Conversation,
  type LeaderboardEntry,
  type PlayerStatsSummary,
  type ProfileCard,
  type PublicPlayer,
} from '@poker/shared';
import type { HandHistoryView } from '../app/api';

export function makePublic(id: string, name: string, patch: Partial<PublicPlayer> = {}): PublicPlayer {
  return { id, name, avatarUrl: '', level: 1, cosmetics: DEFAULT_COSMETICS, ...patch };
}

export function makeProfile(patch: Partial<ProfileCard> = {}): ProfileCard {
  return {
    ...makePublic('p2', 'Bob', { level: 7, cosmetics: { ...DEFAULT_COSMETICS, title: 'Card shark', frame: 'frame-brass' } }),
    level: 7,
    levelProgress: { level: 7, into: 120, needed: 460 },
    joinedAt: '2026-08-01T12:00:00.000Z',
    bankroll: 24_500,
    stats: {
      handsPlayed: 412,
      winRate: 0.31,
      netProfit: 5_250,
      biggestPotWon: 8_800,
      bestHand: 'full-house',
      vpip: 0.28,
      pfr: 0.14,
      aggressionFactor: 2.3,
      showdownWinRate: 0.56,
      sessionsPlayed: 9,
      totalPlayMs: 3 * 3_600_000 + 20 * 60_000,
    },
    recentForm: [120, -50, -50, 300, 0, -200, 900],
    badges: [{ id: 'regular', name: 'Regular', description: 'Played 100 hands.' }],
    itemsOwned: 4,
    ...patch,
  };
}

export function makeSummary(patch: Partial<PlayerStatsSummary> = {}): PlayerStatsSummary {
  return {
    playerId: 'p1',
    handsPlayed: 40,
    handsWon: 12,
    handsLost: 28,
    chipsBet: 9_000,
    chipsWon: 10_200,
    netProfit: 1_200,
    biggestPotWon: 2_400,
    showdownsWon: 5,
    showdownsSeen: 9,
    flopsSeen: 22,
    vpipCount: 14,
    pfrCount: 6,
    aggressiveActions: 18,
    passiveActions: 9,
    categoryCounts: { pair: 4, 'two-pair': 3, flush: 1 },
    totalPlayMs: 45 * 60_000,
    sessionsPlayed: 2,
    winRate: 0.3,
    vpip: 0.35,
    pfr: 0.15,
    aggressionFactor: 2,
    showdownWinRate: 5 / 9,
    ...patch,
  };
}

export const EMPTY_SUMMARY = makeSummary({
  handsPlayed: 0, handsWon: 0, handsLost: 0, chipsBet: 0, chipsWon: 0, netProfit: 0, biggestPotWon: 0,
  showdownsWon: 0, showdownsSeen: 0, flopsSeen: 0, vpipCount: 0, pfrCount: 0, aggressiveActions: 0,
  passiveActions: 0, categoryCounts: {}, totalPlayMs: 0, sessionsPlayed: 0, winRate: 0, vpip: 0, pfr: 0,
  aggressionFactor: 0, showdownWinRate: 0,
});

const cards = (text: string) => text.split(' ').map(parseCard) as Card[];

export function makeHand(patch: Partial<HandHistoryView> = {}): HandHistoryView {
  return {
    tableId: 't1',
    handNumber: 7,
    playedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    board: cards('Ah Kd 7c 2s 9h'),
    pots: [{ amount: 1_200, winnerIds: ['p1'], handLabel: 'Pair of aces' }],
    players: [
      { id: 'p1', name: 'Alice', seat: 0, cards: cards('As Qc') as [Card, Card], shown: true, net: 600, handLabel: 'Pair of aces', result: 'won' },
      { id: 'p2', name: 'Bob', seat: 2, cards: cards('Kh Jc') as [Card, Card], shown: true, net: -600, handLabel: 'Pair of kings', result: 'lost' },
      { id: 'p3', name: 'Carol', seat: 4, cards: null, shown: false, net: 0, handLabel: null, result: 'folded' },
    ],
    ...patch,
  };
}

export function makeEntry(rank: number, id: string, name: string, value: number): LeaderboardEntry {
  return { rank, player: makePublic(id, name), value };
}

export function makeChallenge(patch: Partial<ChallengeStatus> = {}): ChallengeStatus {
  return {
    id: 'd-play-25',
    period: 'daily',
    periodKey: '2026-09-24',
    title: 'Pull up a chair',
    description: 'Play 25 hands.',
    goal: 25,
    progress: 10,
    completed: false,
    claimed: false,
    reward: { chips: 500, xp: 40 },
    endsAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    ...patch,
  };
}

let msgSeq = 0;
export function makeMessage(channel: string, senderId: string, body: string, createdAt: string): ChatMessage {
  return { id: `m${++msgSeq}`, channel, senderId, senderName: senderId === 'p1' ? 'Alice' : 'Bob', senderAvatar: '', body, createdAt };
}

export function makeConversation(patch: Partial<Conversation> = {}): Conversation {
  const channel = 'dm:p1:p2';
  return {
    channel,
    partner: { id: 'p2', name: 'Bob', avatarUrl: '' },
    last: makeMessage(channel, 'p2', 'nice hand', '2026-09-24T10:00:00.000Z'),
    unread: 2,
    ...patch,
  };
}
