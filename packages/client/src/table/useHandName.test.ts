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

  it('returns null before there are five cards', () => {
    const { result } = renderHook(() => useHandName([c('A', 'spades'), c('10', 'spades')], []));
    expect(result.current).toBeNull();
  });
});
