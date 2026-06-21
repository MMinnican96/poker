import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { fetchStats, sampleStats, useStats } from './useStats';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

describe('sampleStats', () => {
  it('is deterministic for a given playerId', () => {
    expect(sampleStats('alice')).toEqual(sampleStats('alice'));
  });
  it('differs across playerIds', () => {
    expect(sampleStats('alice').handsWon).not.toBe(sampleStats('bob').handsWon);
  });
  it('produces a coherent summary', () => {
    const s = sampleStats('alice');
    expect(s.handsWon).toBeLessThanOrEqual(s.handsPlayed);
    expect(s.winRate).toBeGreaterThanOrEqual(0);
    expect(s.winRate).toBeLessThanOrEqual(1);
  });
});

describe('fetchStats', () => {
  it('returns parsed data on a 200', async () => {
    const body = { playerId: 'x', handsWon: 5 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));
    expect(await fetchStats('x')).toEqual(body);
  });
  it('returns null on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(null) }));
    expect(await fetchStats('x')).toBeNull();
  });
  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await fetchStats('x')).toBeNull();
  });
  it('returns null when ok but body is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(null) }));
    expect(await fetchStats('x')).toBeNull();
  });
  it('returns null when ok but body is a string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve('a string') }));
    expect(await fetchStats('x')).toBeNull();
  });
});

describe('useStats hook', () => {
  it('returns { stats: null, loading: false } when playerId is null', () => {
    const { result } = renderHook(() => useStats(null));
    expect(result.current).toEqual({ stats: null, loading: false });
  });

  it('returns sampleStats in mock mode without any network call', () => {
    vi.stubEnv('DEV', 'true');
    window.history.replaceState(null, '', '/?mock=1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const playerId = 'alice';
    const { result } = renderHook(() => useStats(playerId));
    expect(result.current.stats).toEqual(sampleStats(playerId));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches real stats in non-mock mode', async () => {
    window.history.replaceState(null, '', '/');
    const body = { playerId: 'bob', handsWon: 10 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));
    const { result } = renderHook(() => useStats('bob'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.stats).toEqual(body));
    expect(result.current.loading).toBe(false);
  });
});
