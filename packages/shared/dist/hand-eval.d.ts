import type { Card, Rank } from './types.js';
/** Numeric value of a rank, Ace high (14). */
export declare function rankValue(rank: Rank): number;
export type HandCategory = 'high-card' | 'pair' | 'two-pair' | 'three-of-a-kind' | 'straight' | 'flush' | 'full-house' | 'four-of-a-kind' | 'straight-flush';
export interface HandRank {
    category: HandCategory;
    name: string;
    /** Monotonic integer: higher is strictly better; equal means a tie. */
    score: number;
    /** The best 5 cards forming this hand. */
    cards: Card[];
}
/** Evaluate exactly 5 cards. */
export declare function evaluate5(cards: Card[]): {
    category: HandCategory;
    score: number;
};
/** Evaluate the best 5-card hand from 5–7 cards (hole + community). */
export declare function evaluateBest(cards: Card[]): HandRank;
/** -1, 0, 1 comparison of two hands (a vs b). */
export declare function compareHands(a: Card[], b: Card[]): number;
/**
 * Name the best hand from the given cards; null when there are fewer than 2.
 * With 5+ cards the full evaluator runs; with 2–4 it classifies by rank
 * multiplicity (see `describeShort`). Display-only.
 */
export declare function describeBestHand(cards: Card[]): {
    name: string;
    category: HandCategory;
} | null;
//# sourceMappingURL=hand-eval.d.ts.map