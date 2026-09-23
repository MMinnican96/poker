import type {
  Card,
  ChallengeStatus,
  ChatMessage,
  ChannelId,
  Conversation,
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardPeriod,
  Loadout,
  LoadoutSlot,
  PlayerSelf,
  PlayerStatsSummary,
  ProfileCard,
} from '@poker/shared';

/** A non-2xx response that isn't a business-rule refusal. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Business-rule result: 409s come back as `{ ok: false, error }`, not thrown. */
export type ApiResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ProfitPoint { hand: number; total: number; at: string }

/** One of your recent hands (`GET /api/me/hands`). Mirrors the server's HandHistoryView. */
export interface HandHistoryView {
  tableId: string;
  handNumber: number;
  playedAt: string;
  board: Card[];
  pots: { amount: number; winnerIds: string[]; handLabel: string | null }[];
  players: {
    id: string;
    name: string;
    seat: number;
    cards: [Card, Card] | null;
    shown: boolean;
    net: number;
    handLabel: string | null;
    result: 'won' | 'lost' | 'folded';
  }[];
}

export interface LevelUp { playerId: string; level: number; reward: number }

/** Typed REST client. Every call carries `Authorization: Bearer <token>`. */
export interface Api {
  me(): Promise<PlayerSelf>;
  claimDaily(): Promise<ApiResult<{ amount: number; balance: number; streak: number }>>;
  profile(playerId: string): Promise<ProfileCard>;
  playerStats(playerId: string): Promise<{ summary: PlayerStatsSummary; curve: ProfitPoint[] }>;
  myHands(limit?: number): Promise<HandHistoryView[]>;
  leaderboard(metric: LeaderboardMetric, period?: LeaderboardPeriod, limit?: number): Promise<LeaderboardEntry[]>;
  /** `nonce` makes retries idempotent; one is generated when omitted. */
  purchase(itemId: string, nonce?: string): Promise<ApiResult<{ balance: number; quantity: number }>>;
  equip(slot: LoadoutSlot, itemId: string): Promise<ApiResult<{ loadout: Loadout }>>;
  challenges(): Promise<ChallengeStatus[]>;
  claimChallenge(periodKey: string, challengeId: string): Promise<ApiResult<{
    chips: number; xp: number; balance: number; levelUps: LevelUp[];
  }>>;
  conversations(): Promise<Conversation[]>;
  /** Up to 50 messages, oldest first; pass `before` (ISO date) to page back. */
  history(channel: ChannelId, before?: string): Promise<ChatMessage[]>;
}

const newNonce = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Build the REST client for a session token. `base` defaults to same-origin `/api`. */
export function createApi(token: string, opts: { base?: string; fetch?: typeof fetch } = {}): Api {
  const base = opts.base ?? '/api';
  const f: typeof fetch = opts.fetch ?? ((input, init) => window.fetch(input, init));

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, allow409 = false): Promise<T> {
    let res: Response;
    try {
      res = await f(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "Couldn't reach the server.");
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (res.ok || (allow409 && res.status === 409 && data)) return data as T;
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`);
  }

  const q = (params: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, String(v));
    const text = s.toString();
    return text ? `?${text}` : '';
  };

  return {
    me: () => request('GET', '/me'),
    claimDaily: () => request('POST', '/me/daily', {}, true),
    profile: (id) => request('GET', `/players/${encodeURIComponent(id)}/profile`),
    playerStats: (id) => request('GET', `/players/${encodeURIComponent(id)}/stats`),
    myHands: (limit) => request('GET', `/me/hands${q({ limit })}`),
    leaderboard: (metric, period = 'all', limit) => request('GET', `/leaderboard${q({ metric, period, limit })}`),
    purchase: (itemId, nonce = newNonce()) => request('POST', '/shop/purchase', { itemId, nonce }, true),
    equip: (slot, itemId) => request('POST', '/shop/equip', { slot, itemId }, true),
    challenges: () => request('GET', '/challenges'),
    claimChallenge: (periodKey, challengeId) => request('POST', '/challenges/claim', { periodKey, challengeId }, true),
    conversations: () => request('GET', '/messages/conversations'),
    history: (channel, before) => request('GET', `/messages/history${q({ channel, before })}`),
  };
}
