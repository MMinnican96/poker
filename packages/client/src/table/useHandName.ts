import { useMemo } from 'react';
import type { Card } from '@poker/shared';
import { describeBestHand } from '@poker/shared';

/** Display-only name of the hero's best current hand. Null until 5+ cards exist. */
export function useHandName(
  holeCards: [Card, Card] | null,
  community: Card[],
): { title: string; sub: string } | null {
  return useMemo(() => {
    if (!holeCards) return null;
    const named = describeBestHand([...holeCards, ...community]);
    if (!named) return null;
    return { title: named.name, sub: named.name };
  }, [holeCards, community]);
}
