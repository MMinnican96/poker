import { Router, type Request, type Response, type NextFunction } from 'express';
import type { LeaderboardMetric } from '@poker/shared';
import { verifySession } from './auth.js';
import { LEADERBOARD_METRICS } from '../db/stats-leaderboard.js';
import type { StatsRepository } from '../db/stats.js';

/** Require a valid poker_session JWT cookie (parsed without cookie-parser). */
function requireSession(req: Request, res: Response, next: NextFunction): void {
  const cookie = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)poker_session=([^;]+)/.exec(cookie);
  if (!match) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    verifySession(decodeURIComponent(match[1]));
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (Number.isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseSince(raw: unknown): Date | undefined {
  if (typeof raw !== 'string') return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Read-only stats API. Injected repository keeps it DB-agnostic (a no-op repo is
 * supplied in dev/mock mode). Mounted at /api/stats.
 */
export function createStatsRouter(repo: StatsRepository): Router {
  const router = Router();
  router.use(requireSession);

  // Declared before '/:playerId' so it isn't captured as a player id.
  router.get('/leaderboard', async (req, res) => {
    const metric = (req.query.metric as string) ?? 'net_profit';
    if (!LEADERBOARD_METRICS.includes(metric as LeaderboardMetric)) {
      res.status(400).json({ error: `Unknown metric. Use one of: ${LEADERBOARD_METRICS.join(', ')}` });
      return;
    }
    const limit = parseLimit(req.query.limit, 10, 100);
    const since = parseSince(req.query.since);
    const entries = await repo.getLeaderboard({ metric: metric as LeaderboardMetric, limit, since });
    res.json(entries);
  });

  router.get('/:playerId', async (req, res) => {
    const summary = await repo.getPlayerStats(req.params.playerId);
    if (!summary) {
      res.status(404).json({ error: 'No stats for that player' });
      return;
    }
    res.json(summary);
  });

  router.get('/:playerId/hands', async (req, res) => {
    const limit = parseLimit(req.query.limit, 25, 200);
    const since = parseSince(req.query.since);
    const hands = await repo.getPlayerHandHistory(req.params.playerId, { limit, since });
    res.json(hands);
  });

  return router;
}
