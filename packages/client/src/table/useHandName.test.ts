import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHandName } from './useHandName';
import type { Card } from '@poker/shared';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('useHandName', () => {
  it('names two pair from hole + community', () => {
    const { result } = renderHook(() =>
      useHandName([c('A', 'spades'), c('10', 'spades')], [c('A', 'hearts'), c('10', 'diamonds'), c('4', 'clubs')]),
    );
    expect(result.current?.title).toBe('Two Pair');
  });

  it('names a pocket pair pre-flop (two hole cards, no board)', () => {
    const { result } = renderHook(() => useHandName([c('8', 'hearts'), c('8', 'diamonds')], []));
    expect(result.current?.title).toBe('Pair');
  });

  it('names high card pre-flop for unpaired hole cards', () => {
    const { result } = renderHook(() => useHandName([c('A', 'spades'), c('10', 'spades')], []));
    expect(result.current?.title).toBe('High Card');
  });

  it('returns null when there are no hole cards', () => {
    const { result } = renderHook(() => useHandName(null, []));
    expect(result.current).toBeNull();
  });
});
