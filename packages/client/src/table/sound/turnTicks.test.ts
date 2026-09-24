import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { TableView } from '@poker/shared';
import type { SoundManager } from './SoundManager';
import { resetSoundSettings, setTimerTicks } from './soundStore';
import { hand, LEGAL, player, view } from './testViews';
import { planTurnTicks, useTurnTicks, yourDeadline } from './turnTicks';

function fakeManager() {
  const played: string[] = [];
  const m: SoundManager = { unlock: vi.fn(), setSettings: vi.fn(), play: (name) => void played.push(name) };
  return { m, played };
}

const T0 = 1_000_000;

/** Your turn, ending `ms` from now (server and local clocks agree unless a test says otherwise). */
function yourTurn(ms: number, patch: Partial<TableView> = {}): TableView {
  const v = view(hand({ actionEndsAt: Date.now() + ms, toActSeat: 0 }), [player('a'), player('b')], { serverNow: Date.now(), ...patch });
  return { ...v, you: { ...v.you, legal: LEGAL } };
}

describe('planTurnTicks', () => {
  it('ticks at 5..1 seconds left, urgent for the last three, for any turn length', () => {
    const plan = planTurnTicks(T0 + 30_000, T0);
    expect(plan.map((p) => p.in)).toEqual([25_000, 26_000, 27_000, 28_000, 29_000]);
    expect(plan.map((p) => p.urgent)).toEqual([false, false, true, true, true]);
    expect(planTurnTicks(T0 + 8_000, T0).map((p) => p.in)).toEqual([3_000, 4_000, 5_000, 6_000, 7_000]);
  });

  it('leaves out ticks already past (a short turn, or joining late)', () => {
    const plan = planTurnTicks(T0 + 2_500, T0);
    expect(plan.map((p) => p.in)).toEqual([500, 1_500]);
    expect(plan.every((p) => p.urgent)).toBe(true);
    expect(planTurnTicks(T0 - 1, T0)).toEqual([]);
  });
});

describe('yourDeadline', () => {
  it("is the deadline only while it's your turn", () => {
    const v = yourTurn(10_000);
    expect(yourDeadline(v)).toBe(v.hand!.actionEndsAt);
    expect(yourDeadline({ ...v, you: { ...v.you, legal: null } })).toBeNull();
    expect(yourDeadline({ ...v, hand: { ...v.hand!, toActSeat: 1 } })).toBeNull();
    expect(yourDeadline(null)).toBeNull();
  });
});

describe('useTurnTicks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    resetSoundSettings();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks once a second in the last five seconds, urgently in the last three', () => {
    const { m, played } = fakeManager();
    renderHook(() => useTurnTicks(yourTurn(12_000), m, true, Date.now));
    vi.advanceTimersByTime(6_999);
    expect(played).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(played).toEqual(['tick']);
    vi.advanceTimersByTime(5_000);
    expect(played).toEqual(['tick', 'tick', 'tickUrgent', 'tickUrgent', 'tickUrgent']);
  });

  it('plans from the server clock now, not from when the view was sent', () => {
    // The view is 2 s old (it arrived before a remount), and the server clock
    // runs 3 s ahead of ours. The deadline is 8 s from the server's now.
    const offset = 3_000;
    const serverNow = () => Date.now() + offset;
    const stale = view(hand({ actionEndsAt: serverNow() + 8_000, toActSeat: 0 }), [player('a'), player('b')], { serverNow: serverNow() - 2_000 });
    const v = { ...stale, you: { ...stale.you, legal: LEGAL } };
    const { m, played } = fakeManager();
    renderHook(() => useTurnTicks(v, m, true, serverNow));
    vi.advanceTimersByTime(2_999);
    expect(played).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(played).toEqual(['tick']);
    vi.advanceTimersByTime(4_000);
    expect(played).toHaveLength(5);
  });

  it('stops as soon as your turn ends', () => {
    const { m, played } = fakeManager();
    const { rerender } = renderHook(({ v }) => useTurnTicks(v, m, true, Date.now), { initialProps: { v: yourTurn(6_000) } });
    vi.advanceTimersByTime(1_000);
    expect(played).toEqual(['tick']);
    const acted = yourTurn(5_000);
    rerender({ v: { ...acted, you: { ...acted.you, legal: null } } });
    vi.advanceTimersByTime(10_000);
    expect(played).toEqual(['tick']);
  });

  it('replans for a new deadline instead of doubling up', () => {
    const { m, played } = fakeManager();
    const { rerender } = renderHook(({ v }) => useTurnTicks(v, m, true, Date.now), { initialProps: { v: yourTurn(6_000) } });
    rerender({ v: yourTurn(20_000) });
    vi.advanceTimersByTime(14_999);
    expect(played).toEqual([]);
    vi.advanceTimersByTime(5_001);
    expect(played).toHaveLength(5);
  });

  it('stops on unmount', () => {
    const { m, played } = fakeManager();
    const { unmount } = renderHook(() => useTurnTicks(yourTurn(5_500), m, true, Date.now));
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(played).toEqual([]);
  });

  it('honours the timer ticks switch, even mid-turn', () => {
    const off = fakeManager();
    const turn = yourTurn(5_500);
    renderHook(() => useTurnTicks(turn, off.m, false, Date.now));
    vi.advanceTimersByTime(10_000);
    expect(off.played).toEqual([]);

    const on = fakeManager();
    const later = yourTurn(5_500);
    renderHook(() => useTurnTicks(later, on.m, true, Date.now));
    vi.advanceTimersByTime(600);
    expect(on.played).toEqual(['tick']);
    act(() => setTimerTicks(false));
    vi.advanceTimersByTime(10_000);
    expect(on.played).toEqual(['tick']);
  });
});
