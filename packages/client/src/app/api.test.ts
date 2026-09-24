import { describe, it, expect, vi } from 'vitest';
import { ApiError, createApi } from './api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createApi', () => {
  it('sends the bearer token and builds query strings', async () => {
    const fetch = vi.fn(async () => json([]));
    const api = createApi('tok', { fetch });
    await api.leaderboard('net_profit', 'week', 10);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/leaderboard?metric=net_profit&period=week&limit=10');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('posts JSON bodies with a nonce for purchases', async () => {
    const fetch = vi.fn(async () => json({ ok: true, balance: 10, quantity: 1 }));
    const api = createApi('tok', { fetch });
    await api.purchase('felt-oxblood', 'n-1');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/shop/purchase');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ itemId: 'felt-oxblood', nonce: 'n-1' });
  });

  it('returns business refusals (409) as results instead of throwing', async () => {
    const api = createApi('tok', { fetch: vi.fn(async () => json({ ok: false, error: 'Already claimed today.' }, 409)) });
    await expect(api.claimDaily()).resolves.toEqual({ ok: false, error: 'Already claimed today.' });
  });

  it('throws ApiError with the server message on other failures', async () => {
    const api = createApi('tok', { fetch: vi.fn(async () => json({ error: 'Sign in again.' }, 401)) });
    await expect(api.me()).rejects.toEqual(new ApiError(401, 'Sign in again.'));
  });

  it('reports a 401 through onUnauthorized (and still throws)', async () => {
    const onUnauthorized = vi.fn();
    const api = createApi('tok', { fetch: vi.fn(async () => json({ error: 'Sign in again.' }, 401)), onUnauthorized });
    await expect(api.challenges()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    const other = vi.fn();
    await expect(createApi('tok', { fetch: vi.fn(async () => json({ error: 'nope' }, 500)), onUnauthorized: other }).me()).rejects.toBeInstanceOf(ApiError);
    expect(other).not.toHaveBeenCalled();
  });

  it('loads achievements and puts the showcase, returning a 409 refusal as a result', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? json({ ok: false, error: "You haven't unlocked that emblem yet." }, 409) : json({ achievements: [], showcase: [] }));
    const api = createApi('tok', { fetch });
    await expect(api.achievements()).resolves.toEqual({ achievements: [], showcase: [] });
    expect(fetch.mock.calls[0][0]).toBe('/api/achievements');
    await expect(api.setShowcase(['grinder', 'royalty'])).resolves.toEqual({ ok: false, error: "You haven't unlocked that emblem yet." });
    const [url, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('/api/achievements/showcase');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ ids: ['grinder', 'royalty'] });
  });

  it('encodes channel ids for history', async () => {
    const fetch = vi.fn(async () => json([]));
    await createApi('tok', { fetch }).history('dm:a:b', '2026-01-01T00:00:00.000Z');
    expect(fetch.mock.calls[0][0]).toBe('/api/messages/history?channel=dm%3Aa%3Ab&before=2026-01-01T00%3A00%3A00.000Z');
  });
});
