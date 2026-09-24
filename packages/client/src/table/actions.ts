import { formatChips, formatChipsShort, type ActionType, type LegalActions, type PlayerAction } from '@poker/shared';

// ---------------------------------------------------------------------------
// Raise sizing
// ---------------------------------------------------------------------------

export interface RaisePreset {
  label: string;
  value: number;
}

/**
 * Quick raise sizes: minimum, fractions of the pot, and the maximum. A pot-sized
 * raise is "call, then raise by the pot": currentBet + fraction × (pot + toCall).
 * Sizes are clamped to the legal range and de-duplicated; the top one reads
 * "All-in" only when the maximum really is your whole stack.
 */
export function raisePresets(legal: LegalActions, potTotal: number, currentBet: number): RaisePreset[] {
  if (!legal.canRaise) return [];
  const { minRaiseTo: min, maxRaiseTo: max } = legal;
  const within = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  const potBase = potTotal + legal.callAmount;
  const out: RaisePreset[] = [{ label: 'Min', value: min }];
  for (const [label, f] of [['½ pot', 0.5], ['¾ pot', 0.75], ['Pot', 1]] as const) {
    const v = currentBet + f * potBase;
    if (v > min && v < max) out.push({ label, value: within(v) });
  }
  out.push({ label: maxLabel(legal), value: max });
  return out.filter((p, i, all) => all.findIndex((q) => q.value === p.value) === i);
}

/** "All-in" when the largest raise is your whole stack, otherwise "Max". */
export function maxLabel(legal: LegalActions): string {
  return legal.maxRaiseTo === legal.allInTo ? 'All-in' : 'Max';
}

/** The confirm button for a raise of `amount` (a raise-to total). */
export function raiseLabel(amount: number, legal: LegalActions, currentBet: number): string {
  if (amount === legal.allInTo) return `All-in ${formatChips(amount)}`;
  return currentBet === 0 ? `Bet ${formatChips(amount)}` : `Raise to ${formatChips(amount)}`;
}

/** The verb on the raise button before an amount is picked. */
export function raiseVerb(currentBet: number): 'Bet' | 'Raise' {
  return currentBet === 0 ? 'Bet' : 'Raise';
}

/**
 * The call/check button: "Check", "Call 200", or "All-in 150" when calling
 * takes your whole stack. `committed` is what you've already put in this street.
 */
export function callLabel(legal: LegalActions, committed: number): string {
  if (legal.canCheck || legal.callAmount === 0) return 'Check';
  return committed + legal.callAmount >= legal.allInTo
    ? `All-in ${formatChips(legal.callAmount)}`
    : `Call ${formatChips(legal.callAmount)}`;
}

// ---------------------------------------------------------------------------
// Action pills
// ---------------------------------------------------------------------------

/** Text for a seat's last-action pill, e.g. "Raise 600". */
export function actionText(a: { type: ActionType; amount: number }): string {
  switch (a.type) {
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return `Call ${formatChipsShort(a.amount)}`;
    case 'bet': return `Bet ${formatChipsShort(a.amount)}`;
    case 'raise': return `Raise ${formatChipsShort(a.amount)}`;
    case 'all-in': return 'All-in';
  }
}

// ---------------------------------------------------------------------------
// Pre-actions
// ---------------------------------------------------------------------------

/** Choices you can queue while it's someone else's turn. */
export type PreAction = 'check-fold' | 'check' | 'call-any';

/**
 * What a queued pre-action does now that it's your turn, or null when it no
 * longer makes sense (e.g. "Check" but someone bet).
 */
export function resolvePreAction(pre: PreAction, legal: LegalActions): PlayerAction | null {
  switch (pre) {
    case 'check-fold':
      if (legal.canCheck) return { type: 'check' };
      return legal.canFold ? { type: 'fold' } : null;
    case 'check':
      return legal.canCheck ? { type: 'check' } : null;
    case 'call-any':
      if (legal.callAmount > 0) return { type: 'call' };
      return legal.canCheck ? { type: 'check' } : null;
  }
}

/** Snapshot of what a pre-action was chosen against. */
export interface PreActionContext {
  handNumber: number;
  street: string;
  currentBet: number;
}

/**
 * Should a queued pre-action be cleared? Everything clears on a new hand or
 * street. "Check" also clears as soon as the bet changes (it would no longer be
 * a check); "Check/fold" and "Call any" are meant to survive a bet.
 */
export function preActionExpired(pre: PreAction, armed: PreActionContext, now: PreActionContext | null): boolean {
  if (!now) return true;
  if (now.handNumber !== armed.handNumber || now.street !== armed.street) return true;
  if (pre === 'check' && now.currentBet !== armed.currentBet) return true;
  return false;
}
