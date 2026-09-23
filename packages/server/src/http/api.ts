import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  LEADERBOARD_METRICS,
  LOADOUT_SLOTS,
  dmPartner,
  type AuthResponse,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LoadoutSlot,
} from '@poker/shared';
import type { Auth } from '../auth.js';
import { mockAuthAllowed, mockAvatar, mockIdentity } from '../auth.js';
import type { Services } from '../services/index.js';
import type { Realtime } from '../socket/realtime.js';
import { exchangeCode, fetchGuildMember, fetchUser, resolveIdentity } from '../discord.js';

type Authed = Request & { playerId: string };

export interface ApiOptions {
  services: Services;
  auth: Auth;
  realtime: Realtime;
  allowMockAuth?: boolean;
}

/** Wrap an async handler so rejections become 500s instead of hanging. */
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export function createApi(opts: ApiOptions): Router {
  const { services, auth, realtime } = opts;
  const allowMock = opts.allowMockAuth ?? mockAuthAllowed();
  const api = Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  async function issue(res: Response, identity: { id: string; name: string; avatarUrl: string }, accessToken?: string) {
    await services.bank.ensurePlayer({ id: identity.id, name: identity.name, avatarUrl: identity.avatarUrl });
    const me = await services.profiles.self(identity.id);
    const body: AuthResponse = {
      token: auth.sign({ sub: identity.id, name: identity.name, avatar: identity.avatarUrl }),
      accessToken,
      me: me!,
    };
    res.json(body);
  }

  /** Discord Activity handshake: exchange the OAuth code, resolve the member, issue a session. */
  api.post('/auth/token', wrap(async (req, res) => {
    const { code, guildId } = req.body as { code?: unknown; guildId?: unknown };
    if (typeof code !== 'string' || !code) {
      res.status(400).json({ error: 'Missing code' });
      return;
    }
    try {
      const accessToken = await exchangeCode(code);
      const user = await fetchUser(accessToken);
      const gid = typeof guildId === 'string' && /^\d+$/.test(guildId) ? guildId : undefined;
      const member = gid ? await fetchGuildMember(gid, user.id).catch(() => null) : null;
      const who = resolveIdentity(user, member, gid);
      await issue(res, { id: who.discordUserId, name: who.displayName, avatarUrl: who.avatarUrl }, accessToken);
    } catch (err) {
      console.error('[auth] Discord token exchange failed:', err);
      res.status(502).json({ error: 'Discord sign-in failed' });
    }
  }));

  /** Development sign-in with a made-up identity (disabled in production). */
  api.post('/auth/mock', wrap(async (req, res) => {
    if (!allowMock) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const who = mockIdentity((req.body as { name?: unknown }).name);
    if (!who) {
      res.status(400).json({ error: 'Pick a name with letters or numbers.' });
      return;
    }
    await issue(res, { ...who, avatarUrl: mockAvatar(who.id) });
  }));

  // Everything below needs a session.
  api.use((req, res, next) => {
    const header = req.headers.authorization ?? '';
    const claims = auth.verify(header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!claims) {
      res.status(401).json({ error: 'Sign in again.' });
      return;
    }
    (req as Authed).playerId = claims.sub;
    next();
  });
  const me = (req: Request) => (req as Authed).playerId;

  api.get('/me', wrap(async (req, res) => {
    const self = await services.profiles.self(me(req));
    if (!self) res.status(404).json({ error: 'Unknown player' });
    else res.json(self);
  }));

  api.post('/me/daily', wrap(async (req, res) => {
    const r = await services.rewards.claimDaily(me(req));
    if (r.ok) realtime.refreshMe(me(req));
    res.status(r.ok ? 200 : 409).json(r);
  }));

  api.get('/players/:id/profile', wrap(async (req, res) => {
    const card = await services.profiles.card(String(req.params.id));
    if (!card) res.status(404).json({ error: 'No such player' });
    else res.json(card);
  }));

  api.get('/players/:id/stats', wrap(async (req, res) => {
    const id = String(req.params.id);
    const [summary, curve] = await Promise.all([services.stats.summary(id), services.stats.profitCurve(id, 200)]);
    res.json({ summary, curve });
  }));

  /** Your own recent hands (only yours — they include your hole cards). */
  api.get('/me/hands', wrap(async (req, res) => {
    const limit = clampInt(req.query.limit, 20, 1, 50);
    res.json(await services.stats.history(me(req), limit));
  }));

  api.get('/leaderboard', wrap(async (req, res) => {
    const metric = String(req.query.metric ?? 'net_profit') as LeaderboardMetric;
    const period = (req.query.period === 'week' ? 'week' : 'all') as LeaderboardPeriod;
    if (!LEADERBOARD_METRICS.some((m) => m.id === metric)) {
      res.status(400).json({ error: 'Unknown metric' });
      return;
    }
    res.json(await services.stats.leaderboard(metric, period, clampInt(req.query.limit, 25, 1, 100)));
  }));

  api.post('/shop/purchase', wrap(async (req, res) => {
    const { itemId, nonce } = req.body as { itemId?: unknown; nonce?: unknown };
    const r = await services.shop.purchase(me(req), String(itemId ?? ''), String(nonce ?? ''));
    if (r.ok) realtime.refreshMe(me(req));
    res.status(r.ok ? 200 : 409).json(r);
  }));

  api.post('/shop/equip', wrap(async (req, res) => {
    const { slot, itemId } = req.body as { slot?: unknown; itemId?: unknown };
    if (!LOADOUT_SLOTS.includes(slot as LoadoutSlot)) {
      res.status(400).json({ ok: false, error: 'Unknown slot' });
      return;
    }
    const r = await services.shop.equip(me(req), slot as LoadoutSlot, String(itemId ?? ''));
    if (r.ok) realtime.refreshMe(me(req));
    res.status(r.ok ? 200 : 409).json(r);
  }));

  api.get('/challenges', wrap(async (req, res) => {
    res.json(await services.rewards.challenges(me(req)));
  }));

  api.post('/challenges/claim', wrap(async (req, res) => {
    const { periodKey, challengeId } = req.body as { periodKey?: unknown; challengeId?: unknown };
    const r = await services.rewards.claimChallenge(me(req), String(periodKey ?? ''), String(challengeId ?? ''));
    if (r.ok) realtime.refreshMe(me(req));
    res.status(r.ok ? 200 : 409).json(r);
  }));

  api.get('/messages/conversations', wrap(async (req, res) => {
    res.json(await services.chat.conversations(me(req)));
  }));

  /** History for a DM you're part of, or a room you're currently in. */
  api.get('/messages/history', wrap(async (req, res) => {
    const channel = String(req.query.channel ?? '');
    if (!canRead(me(req), channel)) {
      res.status(403).json({ error: "You can't read that conversation." });
      return;
    }
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    res.json(await services.chat.history(channel, { before, limit: 50 }));
  }));

  function canRead(playerId: string, channel: string): boolean {
    if (channel.startsWith('dm:')) return dmPartner(channel, playerId) !== null;
    if (channel.startsWith('room:')) return !!realtime.rooms.get(channel.slice(5))?.isPresent(playerId);
    return false;
  }

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] request failed', err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return api;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
}
