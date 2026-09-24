import { describe, expect, it } from 'vitest';
import type { LegalActions } from '@poker/shared';
import { actionText, callLabel, maxLabel, preActionExpired, raiseLabel, raisePresets, resolvePreAction } from './actions';

const legal = (patch: Partial<LegalActions> = {}): LegalActions => ({
  canFold: true, canCheck: false, callAmount: 50, canRaise: true, minRaiseTo: 100, maxRaiseTo: 5000, allInTo: 5000, ...patch,
});

describe('raise sizing', () => {
  it('offers min, pot fractions and the maximum, in range and de-duplicated', () => {
    // Pre-flop from the small blind: pot 75, 25 to call, current bet 50.
    const p = raisePresets(legal({ callAmount: 25, minRaiseTo: 100, maxRaiseTo: 4975, allInTo: 4975 }), 75, 50);
    expect(p).toEqual([
      { label: 'Min', value: 100 },
      { label: '¾ pot', value: 125 },
      { label: 'Pot', value: 150 },
      { label: 'All-in', value: 4975 },
    ]);
  });

  it('labels the top size "Max" when someone covers less than your stack', () => {
    const l = legal({ maxRaiseTo: 800, allInTo: 5000 });
    expect(maxLabel(l)).toBe('Max');
    expect(raisePresets(l, 200, 50).at(-1)).toEqual({ label: 'Max', value: 800 });
  });

  it('has no presets when you cannot raise', () => {
    expect(raisePresets(legal({ canRaise: false, minRaiseTo: 0, maxRaiseTo: 0 }), 300, 50)).toEqual([]);
  });

  it('names the confirm button by what it does', () => {
    expect(raiseLabel(200, legal(), 0)).toBe('Bet 200');
    expect(raiseLabel(300, legal(), 100)).toBe('Raise to 300');
    expect(raiseLabel(5000, legal(), 100)).toBe('All-in 5,000');
  });

  it('shows check, call or an all-in call', () => {
    expect(callLabel(legal({ canCheck: true, callAmount: 0 }), 0)).toBe('Check');
    expect(callLabel(legal({ callAmount: 200 }), 0)).toBe('Call 200');
    expect(callLabel(legal({ callAmount: 300, allInTo: 400 }), 100)).toBe('All-in 300');
  });
});

describe('action pills', () => {
  it('reads like a table talk shorthand', () => {
    expect(actionText({ type: 'raise', amount: 600 })).toBe('Raise 600');
    expect(actionText({ type: 'call', amount: 12_500 })).toBe('Call 12.5k');
    expect(actionText({ type: 'all-in', amount: 900 })).toBe('All-in');
    expect(actionText({ type: 'fold', amount: 0 })).toBe('Fold');
  });
});

describe('pre-actions', () => {
  it('check/fold checks when free and folds facing a bet', () => {
    expect(resolvePreAction('check-fold', legal({ canCheck: true, callAmount: 0 }))).toEqual({ type: 'check' });
    expect(resolvePreAction('check-fold', legal())).toEqual({ type: 'fold' });
  });
  it('check only fires when checking is still possible', () => {
    expect(resolvePreAction('check', legal({ canCheck: true, callAmount: 0 }))).toEqual({ type: 'check' });
    expect(resolvePreAction('check', legal())).toBeNull();
  });
  it('call any calls whatever it is, or checks', () => {
    expect(resolvePreAction('call-any', legal({ callAmount: 900 }))).toEqual({ type: 'call' });
    expect(resolvePreAction('call-any', legal({ canCheck: true, callAmount: 0 }))).toEqual({ type: 'check' });
  });
  it('expires on a new street or hand, and "check" also when the bet changes', () => {
    const at = { handNumber: 4, street: 'flop', currentBet: 0 };
    expect(preActionExpired('check', at, { ...at, currentBet: 200 })).toBe(true);
    expect(preActionExpired('check-fold', at, { ...at, currentBet: 200 })).toBe(false);
    expect(preActionExpired('call-any', at, { ...at, currentBet: 200 })).toBe(false);
    expect(preActionExpired('call-any', at, { ...at, street: 'turn' })).toBe(true);
    expect(preActionExpired('check-fold', at, { ...at, handNumber: 5 })).toBe(true);
    expect(preActionExpired('check-fold', at, null)).toBe(true);
  });
});
