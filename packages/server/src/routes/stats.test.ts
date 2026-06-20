import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';
import type { PlayerStatsSummary, LeaderboardEntry, PlayerHandStat } from '@poker/shared';
import { createStatsRouter } from './stats.js';
import type { StatsRepository } from '../db/stats.js';

const SUMMARY: PlayerStatsSummary = {
  playerId: 'a', handsPlayed: 10, handsWon: 4, handsLost: 6, chipsBet: 1000,
  chipsWon: 1200, chipsLost: 400, netProfit: 200, biggestPotWon: 300,
  showdownsWon: 2, showdownsSeen: 5, vpipCount: 6, pfrCount: 3,
  aggressiveActions: 8, passiveActions: 2, categoryCounts: { pair: 3 },
  totalPlayMs: 60000, gamesPlayed: 2, winRate: 0.4, vpip: 0.6, pfr: 0.3,
  aggressionFactor: 4, showdownWinRate: 0.4,
};

const fakeRepo: StatsRepository = {
  async getPlayerStats(id) { return id === 'a' ? SUMMARY : null; },
  async getLeaderboard() {
    return [{ playerId: 'a', displayName: 'A', metric: 'net_profit', value: 200, rank: 1 }] as LeaderboardEntry[];
  },
  async getPlayerHandHistory() { return [] as PlayerHandStat[]; },
};

let server: Server;
let base: string;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  const app = express();
  app.use('/api/stats', createStatsRouter(fakeRepo));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => { server?.close(); });

function authCookie(): string {
  const token = jwt.sign({ discordUserId: 'a', displayName: 'A', avatarUrl: '' }, 'test-secret');
  return `poker_session=${token}`;
}

describe('stats routes', () => {
  it('401s without a session cookie', async () => {
    const res = await fetch(`${base}/api/stats/a`);
    expect(res.status).toBe(401);
  });

  it('returns a player summary', async () => {
    const res = await fetch(`${base}/api/stats/a`, { headers: { cookie: authCookie() } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlayerStatsSummary;
    expect(body.playerId).toBe('a');
    expect(body.winRate).toBeCloseTo(0.4);
  });

  it('404s for an unknown player', async () => {
    const res = await fetch(`${base}/api/stats/zzz`, { headers: { cookie: authCookie() } });
    expect(res.status).toBe(404);
  });

  it('returns a leaderboard with a valid metric', async () => {
    const res = await fetch(`${base}/api/stats/leaderboard?metric=net_profit&limit=5`, {
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardEntry[];
    expect(body[0].rank).toBe(1);
  });

  it('400s on an unknown leaderboard metric', async () => {
    const res = await fetch(`${base}/api/stats/leaderboard?metric=bogus`, {
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(400);
  });
});
