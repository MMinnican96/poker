const RANK_VALUE = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '10': 10, J: 11, Q: 12, K: 13, A: 14,
};
/** Numeric value of a rank, Ace high (14). */
export function rankValue(rank) {
    return RANK_VALUE[rank];
}
const CATEGORY_RANK = {
    'high-card': 0, pair: 1, 'two-pair': 2, 'three-of-a-kind': 3,
    straight: 4, flush: 5, 'full-house': 6, 'four-of-a-kind': 7, 'straight-flush': 8,
};
const CATEGORY_NAME = {
    'high-card': 'High Card', pair: 'Pair', 'two-pair': 'Two Pair',
    'three-of-a-kind': 'Three of a Kind', straight: 'Straight', flush: 'Flush',
    'full-house': 'Full House', 'four-of-a-kind': 'Four of a Kind', 'straight-flush': 'Straight Flush',
};
const TIEBREAK_BASE = 15;
function encodeScore(category, tiebreak) {
    let score = CATEGORY_RANK[category];
    for (let i = 0; i < 5; i++)
        score = score * TIEBREAK_BASE + (tiebreak[i] ?? 0);
    return score;
}
function straightHigh(valuesDesc) {
    const distinct = Array.from(new Set(valuesDesc)).sort((a, b) => b - a);
    if (distinct.length !== 5)
        return null;
    if (distinct[0] - distinct[4] === 4)
        return distinct[0];
    if (distinct[0] === 14 && distinct[1] === 5 && distinct[4] === 2)
        return 5;
    return null;
}
/** Evaluate exactly 5 cards. */
export function evaluate5(cards) {
    if (cards.length !== 5)
        throw new Error('evaluate5 requires exactly 5 cards');
    const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
    const isFlush = cards.every((c) => c.suit === cards[0].suit);
    const high = straightHigh(values);
    const isStraight = high !== null;
    const counts = new Map();
    for (const v of values)
        counts.set(v, (counts.get(v) ?? 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const shape = groups.map((g) => g[1]);
    const byCount = groups.map((g) => g[0]);
    if (isStraight && isFlush)
        return { category: 'straight-flush', score: encodeScore('straight-flush', [high]) };
    if (shape[0] === 4)
        return { category: 'four-of-a-kind', score: encodeScore('four-of-a-kind', byCount) };
    if (shape[0] === 3 && shape[1] === 2)
        return { category: 'full-house', score: encodeScore('full-house', byCount) };
    if (isFlush)
        return { category: 'flush', score: encodeScore('flush', values) };
    if (isStraight)
        return { category: 'straight', score: encodeScore('straight', [high]) };
    if (shape[0] === 3)
        return { category: 'three-of-a-kind', score: encodeScore('three-of-a-kind', byCount) };
    if (shape[0] === 2 && shape[1] === 2)
        return { category: 'two-pair', score: encodeScore('two-pair', byCount) };
    if (shape[0] === 2)
        return { category: 'pair', score: encodeScore('pair', byCount) };
    return { category: 'high-card', score: encodeScore('high-card', values) };
}
function combinations(arr, k) {
    const result = [];
    const combo = [];
    const recurse = (start) => {
        if (combo.length === k) {
            result.push(combo.slice());
            return;
        }
        for (let i = start; i < arr.length; i++) {
            combo.push(arr[i]);
            recurse(i + 1);
            combo.pop();
        }
    };
    recurse(0);
    return result;
}
/** Evaluate the best 5-card hand from 5–7 cards (hole + community). */
export function evaluateBest(cards) {
    if (cards.length < 5)
        throw new Error('evaluateBest requires at least 5 cards');
    let best = null;
    for (const five of combinations(cards, 5)) {
        const e = evaluate5(five);
        if (!best || e.score > best.score)
            best = { ...e, cards: five };
    }
    const b = best;
    return { category: b.category, name: CATEGORY_NAME[b.category], score: b.score, cards: b.cards };
}
/** -1, 0, 1 comparison of two hands (a vs b). */
export function compareHands(a, b) {
    const sa = evaluateBest(a).score;
    const sb = evaluateBest(b).score;
    return sa === sb ? 0 : sa > sb ? 1 : -1;
}
/**
 * Classify fewer than 5 cards by rank multiplicity alone. Straights and flushes
 * are impossible with <5 cards, so this only ever yields four/three-of-a-kind,
 * two-pair, pair or high-card — enough to give the hero's hand a value pre-flop.
 */
function describeShort(cards) {
    const counts = new Map();
    for (const card of cards) {
        const v = rankValue(card.rank);
        counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const shape = [...counts.values()].sort((a, b) => b - a);
    const pairs = shape.filter((n) => n === 2).length;
    let category;
    if (shape[0] === 4)
        category = 'four-of-a-kind';
    else if (shape[0] === 3)
        category = 'three-of-a-kind';
    else if (pairs >= 2)
        category = 'two-pair';
    else if (shape[0] === 2)
        category = 'pair';
    else
        category = 'high-card';
    return { name: CATEGORY_NAME[category], category };
}
/**
 * Name the best hand from the given cards; null when there are fewer than 2.
 * With 5+ cards the full evaluator runs; with 2–4 it classifies by rank
 * multiplicity (see `describeShort`). Display-only.
 */
export function describeBestHand(cards) {
    if (cards.length < 2)
        return null;
    if (cards.length < 5)
        return describeShort(cards);
    const r = evaluateBest(cards);
    return { name: r.name, category: r.category };
}
//# sourceMappingURL=hand-eval.js.map