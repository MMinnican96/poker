import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStats, sampleStats } from './useStats';

afterEach(() => vi.restoreAllMocks());

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
});
