/** Table view fixtures for the sound tests. */
import { DEFAULT_COSMETICS, DEFAULT_RULES, type HandView, type SeatPlayer, type TableView } from '@poker/shared';

export function player(id: string, patch: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    id, name: id, avatarUrl: '', level: 1, cosmetics: DEFAULT_COSMETICS, stack: 1000, state: 'playing', connected: true,
    inHand: true, folded: false, allIn: false, committed: 0, holeCards: null, hasHiddenCards: true, revealed: false, lastAction: null,
    pending: null, sittingOut: false, pendingTopUp: 0, ...patch,
  };
}

export function hand(patch: Partial<HandView> = {}): HandView {
  return {
    handNumber: 1, street: 'pre-flop', board: [], pots: [], potTotal: 75, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2,
    toActSeat: 0, actionStartedAt: null, actionEndsAt: null, currentBet: 50, result: null, ...patch,
  };
}

export function view(h: HandView | null, players: SeatPlayer[], patch: Partial<TableView> = {}): TableView {
  return {
    tableId: 't', instanceId: 'r', rules: DEFAULT_RULES, status: 'running', hostId: 'a',
    seats: players.map((p, seat) => ({ seat, player: p })), spectators: [], hand: h, handsDealt: 1, closing: false,
    you: { id: 'a', role: 'seated', seat: 0, bankroll: 0, pending: null, sittingOut: false, pendingTopUp: 0, legal: null, emotes: [], showCards: false },
    serverNow: 0, ...patch,
  };
}

export const LEGAL = { canFold: true, canCheck: false, callAmount: 50, canRaise: true, minRaiseTo: 100, maxRaiseTo: 1000, allInTo: 1000 };
