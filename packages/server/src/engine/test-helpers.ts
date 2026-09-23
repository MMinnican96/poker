import { parseCards, type Card } from '@poker/shared';
import { applyAction, progress, startHand, type Hand, type HandConfig } from './hand.js';
import { createDeck } from './deck.js';

export const BLINDS: HandConfig = { smallBlind: 25, bigBlind: 50, ante: 0 };

export interface Setup {
  /** [id, seat, stack, hole cards like "Ah Kd"] in any order. */
  players: [string, number, number, string?][];
  buttonSeat: number;
  /** Up to five board cards, e.g. "2c 7d 9h Ks 3s". */
  board?: string;
  config?: Partial<HandConfig>;
}

/**
 * Build a hand with a stacked deck. Hole cards are dealt one at a time from the
 * seat left of the button, then burn/flop/burn/turn/burn/river — so the deck is
 * laid out in exactly that order. Unspecified cards are filled from the rest.
 */
export function setupHand(setup: Setup): Hand {
  const seated = setup.players.slice().sort((a, b) => a[1] - b[1]);
  const buttonIdx = seated.findIndex((p) => p[1] === setup.buttonSeat);
  const n = seated.length;
  const order = Array.from({ length: n }, (_, i) => seated[(buttonIdx + 1 + i) % n]);

  const used = new Set<string>();
  const key = (c: Card) => `${c.rank}${c.suit}`;
  const holes = new Map(order.map((p) => [p[0], p[3] ? parseCards(p[3]) : []]));
  const board = setup.board ? parseCards(setup.board) : [];
  for (const cs of [...holes.values(), board]) for (const c of cs) used.add(key(c));
  const spare = createDeck().filter((c) => !used.has(key(c)));
  const take = (c?: Card) => c ?? spare.shift()!;

  const deck: Card[] = [];
  for (const round of [0, 1]) for (const p of order) deck.push(take(holes.get(p[0])![round]));
  deck.push(take(), take(board[0]), take(board[1]), take(board[2]));
  deck.push(take(), take(board[3]));
  deck.push(take(), take(board[4]));
  deck.push(...spare);

  return startHand({
    handNumber: 1,
    buttonSeat: setup.buttonSeat,
    players: seated.map(([id, seat, stack]) => ({ id, seat, stack })),
    config: { ...BLINDS, ...setup.config },
    deck,
  });
}

/** Act for whoever is up and keep dealing until someone must act or the hand ends. */
export function play(hand: Hand, ...actions: [string, string, number?][]): void {
  for (const [id, type, amount] of actions) {
    const r = applyAction(hand, id, { type: type as 'fold', amount });
    if (!r.ok) throw new Error(`${id} ${type} ${amount ?? ''}: ${r.error}`);
    runOn(hand);
  }
}

/** Deal streets until someone must act or the hand completes. */
export function runOn(hand: Hand): void {
  while (hand.state.phase === 'dealing') progress(hand);
}

export function toAct(hand: Hand): string | null {
  const i = hand.state.toAct;
  return i === null ? null : hand.state.players[i].id;
}

export function stacks(hand: Hand): Record<string, number> {
  return Object.fromEntries(hand.state.players.map((p) => [p.id, p.stack]));
}
