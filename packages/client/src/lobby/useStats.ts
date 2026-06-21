import { useEffect, useState } from 'react';
import type { PlayerStatsSummary } from '@poker/shared';

function isMockMode(): boolean {
  if (!import.meta.env.DEV) return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('mock') || import.meta.env.VITE_MOCK_DISCORD === '1';
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic, plausible stats for local mock mode (no DB/session). */
export function sampleStats(playerId: string): PlayerStatsSummary {
  const h = hash(playerId);
  const handsPlayed = 200 + (h % 4600);
  const winRate = 0.35 + ((h >> 3) % 30) / 100; // 0.35–0.65
  const handsWon = Math.round(handsPlayed * winRate);
  const handsLost = handsPlayed - handsWon;
  const biggestPotWon = 2000 + (h % 30) * 1000;
  const chipsWon = handsWon * (300 + (h % 200));
  const chipsLost = handsLost * (200 + ((h >> 5) % 200));
  const showdownsSeen = Math.round(handsPlayed * 0.4);
  const showdownsWon = Math.round(showdownsSeen * winRate);
  const aggressiveActions = handsPlayed * 2 + (h % 100);
  const passiveActions = handsPlayed + ((h >> 7) % 100);
  return {
    playerId,
    handsPlayed,
    handsWon,
    handsLost,
    chipsBet: chipsWon + chipsLost,
    chipsWon,
    chipsLost,
    netProfit: chipsWon - chipsLost,
    biggestPotWon,
    showdownsWon,
    showdownsSeen,
    vpipCount: Math.round(handsPlayed * 0.45),
    pfrCount: Math.round(handsPlayed * 0.22),
    aggressiveActions,
    passiveActions,
    categoryCounts: {},
    totalPlayMs: handsPlayed * 45_000,
    gamesPlayed: 1 + (h % 40),
    winRate,
    vpip: 0.45,
    pfr: 0.22,
    aggressionFactor: aggressiveActions / Math.max(1, passiveActions),
    showdownWinRate: showdownsSeen ? showdownsWon / showdownsSeen : 0,
  };
}

/** Fetch real stats; null on any non-OK/empty/error. */
export async function fetchStats(playerId: string): Promise<PlayerStatsSummary | null> {
  try {
    const res = await fetch(`/api/stats/${encodeURIComponent(playerId)}`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? (data as PlayerStatsSummary) : null;
  } catch {
    return null;
  }
}

export function useStats(playerId: string | null): {
  stats: PlayerStatsSummary | null;
  loading: boolean;
} {
  const [stats, setStats] = useState<PlayerStatsSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!playerId) {
      setStats(null);
      return;
    }
    if (isMockMode()) {
      setStats(sampleStats(playerId));
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchStats(playerId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  return { stats, loading };
}
