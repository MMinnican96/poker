# Poker Table Redesign (React/DOM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phaser canvas table with a React + Tailwind DOM table that matches the lobby's visual language and reuses its components.

**Architecture:** A new `packages/client/src/table/` folder (mirroring `lobby/`) renders the sanitized `GameState` as DOM. `App.tsx` mounts `<TableScreen>` instead of `<GameCanvas>`. Two small server-side additions feed the design: a transient `lastAction` on `GamePlayer`, and the pure hand-evaluator moved into `@poker/shared` so the client can name the hero's hand.

**Tech Stack:** React 18, TypeScript, Tailwind v4 (CSS-first `@theme` tokens in `index.css`), Vitest + React Testing Library (jsdom), Socket.io client, `@poker/shared` (ESM/NodeNext).

## Global Constraints

- **Server is authoritative.** The client renders `GameState` and emits intents; never compute game outcomes client-side (the hero hand-name is display-only).
- **Design tokens only** — never hardcode hex in components; use named Tailwind tokens from `packages/client/src/index.css` (`felt-*`, `gold*`, `mint*`, `blue`, `red`, `sage*`, `ink`, `cream`, radii, shadows). Add new tokens to `@theme` if the design needs one.
- **Fonts:** `font-display` (Fredoka) for headings/numbers, `font-body` (Nunito) for prose.
- **Discord avatars:** render real `avatarUrl` images for seats and spectators — no colored-initial placeholders.
- **`@poker/shared` is ESM (NodeNext), built to `dist/`.** Server consumes the built package via the workspace symlink — do **not** add a `paths` alias to `shared/src` in the server tsconfig. Shared imports use `.js` extensions.
- **Tests live next to source** as `*.test.ts(x)`; excluded from the `tsc` build.
- **After any change**, run `npm test` and `npm run build` from repo root before claiming done.
- **Out of scope:** Phase-2 reveal-all-at-hand-end; new gameplay rules; the mock's post-leave "Undo" overlay; Settings toggles (stay Coming Soon).
- Test commands (run from repo root):
  - Server suite: `npm run test --workspace=packages/server`
  - Client suite: `npm run test --workspace=packages/client`
  - Targeted: append the file path, e.g. `npm run test --workspace=packages/client -- src/table/SeatLayout.test.ts`

---

### Task 1: Add `lastAction` to the game model and engine

**Files:**
- Modify: `packages/shared/src/types.ts` (add field to `GamePlayer`)
- Modify: `packages/server/src/engine/game-state.ts` (init + clear)
- Modify: `packages/server/src/engine/actions.ts` (set on apply)
- Test: `packages/server/src/engine/actions.test.ts` (append cases)

**Interfaces:**
- Produces: `GamePlayer.lastAction?: ActionType | null` — the player's most recent action on the current street; `null` at hand start and after each street transition. Survives `viewFor()` (not secret).

- [ ] **Step 1: Write the failing test** — append to `packages/server/src/engine/actions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { startHand } from './game-state.js';
import { applyActionToState } from './actions.js';
import { DEFAULT_TABLE_CONFIG } from '@poker/shared';

function seed(id: string, seat: number) {
  return { discordUserId: id, displayName: id, avatarUrl: '', seatIndex: seat, chipStack: 1000 };
}

describe('lastAction tracking', () => {
  it('starts null and records the action type when a player acts', () => {
    const { state } = startHand({
      gameId: 'g', instanceId: 'i', handNumber: 1, dealerIndex: 0,
      seeds: [seed('a', 0), seed('b', 1), seed('c', 2)],
      config: DEFAULT_TABLE_CONFIG,
    });
    expect(state.players.every((p) => p.lastAction == null)).toBe(true);
    const actorId = state.players[state.currentPlayerIndex].discordUserId;
    applyActionToState(state, actorId, { type: 'fold' });
    expect(state.players.find((p) => p.discordUserId === actorId)!.lastAction).toBe('fold');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/server -- actions.test.ts`
Expected: FAIL — `lastAction` is `undefined` (not `'fold'`), or a type error on the unknown property.

- [ ] **Step 3: Add the field to the shared type**

In `packages/shared/src/types.ts`, inside `interface GamePlayer` (after `hasActed`):

```typescript
  /** Whether this player has acted since the last bet/raise on the current street. */
  hasActed: boolean;
  /** Most recent action this street (display-only); null at hand start and each new street. */
  lastAction?: ActionType | null;
```

- [ ] **Step 4: Initialize and clear it in the engine**

In `packages/server/src/engine/game-state.ts`, in the `startHand` player map (after `hasActed: false,`):

```typescript
    hasActed: false,
    lastAction: null,
```

In the same file, inside `advanceStreet`, extend the per-player reset loop:

```typescript
  for (const p of state.players) {
    p.betThisRound = 0;
    p.hasActed = false;
    p.lastAction = null;
  }
```

- [ ] **Step 5: Set it when an action is applied**

In `packages/server/src/engine/actions.ts`, in `applyActionToState`, immediately after `player.hasActed = true;`:

```typescript
  player.hasActed = true;
  player.lastAction = action.type;
```

- [ ] **Step 6: Rebuild shared and run tests**

Run: `npm run build --workspace=packages/shared && npm run test --workspace=packages/server -- actions.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/server/src/engine/game-state.ts packages/server/src/engine/actions.ts packages/server/src/engine/actions.test.ts
git commit -m "feat(engine): track per-street lastAction on GamePlayer"
```

---

### Task 2: Move the hand-evaluator into `@poker/shared`

**Files:**
- Create: `packages/shared/src/hand-eval.ts`
- Modify: `packages/shared/src/index.ts` (export it)
- Modify: `packages/server/src/engine/hand-evaluator.ts` (re-export shim)
- Modify: `packages/server/src/engine/cards.ts` (re-export `rankValue` from shared)
- Test: `packages/shared` has no test runner — coverage comes from the existing `packages/server/src/engine/hand-evaluator.test.ts` (unchanged; imports through the shim) plus a new client test in Task 5.

**Interfaces:**
- Produces (from `@poker/shared`):
  - `rankValue(rank: Rank): number`
  - `type HandCategory` (9 tiers, no royal-flush)
  - `interface HandRank { category: HandCategory; name: string; score: number; cards: Card[] }`
  - `evaluate5(cards: Card[]): { category: HandCategory; score: number }`
  - `evaluateBest(cards: Card[]): HandRank`
  - `compareHands(a: Card[], b: Card[]): number`
  - `describeBestHand(cards: Card[]): { name: string; category: HandCategory } | null` — returns `null` when fewer than 5 cards are supplied (so the client can call it with 2–7 cards safely).

- [ ] **Step 1: Create the shared module**

Create `packages/shared/src/hand-eval.ts` with the full evaluator (moved verbatim from the server, with `rankValue` inlined and the new `describeBestHand` helper):

```typescript
import type { Card, Rank } from './types.js';

const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/** Numeric value of a rank, Ace high (14). */
export function rankValue(rank: Rank): number {
  return RANK_VALUE[rank];
}

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';

const CATEGORY_RANK: Record<HandCategory, number> = {
  'high-card': 0, pair: 1, 'two-pair': 2, 'three-of-a-kind': 3,
  straight: 4, flush: 5, 'full-house': 6, 'four-of-a-kind': 7, 'straight-flush': 8,
};

const CATEGORY_NAME: Record<HandCategory, string> = {
  'high-card': 'High Card', pair: 'Pair', 'two-pair': 'Two Pair',
  'three-of-a-kind': 'Three of a Kind', straight: 'Straight', flush: 'Flush',
  'full-house': 'Full House', 'four-of-a-kind': 'Four of a Kind', 'straight-flush': 'Straight Flush',
};

export interface HandRank {
  category: HandCategory;
  name: string;
  /** Monotonic integer: higher is strictly better; equal means a tie. */
  score: number;
  /** The best 5 cards forming this hand. */
  cards: Card[];
}

const TIEBREAK_BASE = 15;

function encodeScore(category: HandCategory, tiebreak: number[]): number {
  let score = CATEGORY_RANK[category];
  for (let i = 0; i < 5; i++) score = score * TIEBREAK_BASE + (tiebreak[i] ?? 0);
  return score;
}

function straightHigh(valuesDesc: number[]): number | null {
  const distinct = Array.from(new Set(valuesDesc)).sort((a, b) => b - a);
  if (distinct.length !== 5) return null;
  if (distinct[0] - distinct[4] === 4) return distinct[0];
  if (distinct[0] === 14 && distinct[1] === 5 && distinct[4] === 2) return 5;
  return null;
}

/** Evaluate exactly 5 cards. */
export function evaluate5(cards: Card[]): { category: HandCategory; score: number } {
  if (cards.length !== 5) throw new Error('evaluate5 requires exactly 5 cards');
  const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);
  const high = straightHigh(values);
  const isStraight = high !== null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]);
  const byCount = groups.map((g) => g[0]);
  if (isStraight && isFlush) return { category: 'straight-flush', score: encodeScore('straight-flush', [high!]) };
  if (shape[0] === 4) return { category: 'four-of-a-kind', score: encodeScore('four-of-a-kind', byCount) };
  if (shape[0] === 3 && shape[1] === 2) return { category: 'full-house', score: encodeScore('full-house', byCount) };
  if (isFlush) return { category: 'flush', score: encodeScore('flush', values) };
  if (isStraight) return { category: 'straight', score: encodeScore('straight', [high!]) };
  if (shape[0] === 3) return { category: 'three-of-a-kind', score: encodeScore('three-of-a-kind', byCount) };
  if (shape[0] === 2 && shape[1] === 2) return { category: 'two-pair', score: encodeScore('two-pair', byCount) };
  if (shape[0] === 2) return { category: 'pair', score: encodeScore('pair', byCount) };
  return { category: 'high-card', score: encodeScore('high-card', values) };
}

function combinations<T>(arr: T[], k: number): T[][] {
  const result: T[][] = [];
  const combo: T[] = [];
  const recurse = (start: number) => {
    if (combo.length === k) { result.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); recurse(i + 1); combo.pop(); }
  };
  recurse(0);
  return result;
}

/** Evaluate the best 5-card hand from 5–7 cards (hole + community). */
export function evaluateBest(cards: Card[]): HandRank {
  if (cards.length < 5) throw new Error('evaluateBest requires at least 5 cards');
  let best: { category: HandCategory; score: number; cards: Card[] } | null = null;
  for (const five of combinations(cards, 5)) {
    const e = evaluate5(five);
    if (!best || e.score > best.score) best = { ...e, cards: five };
  }
  const b = best!;
  return { category: b.category, name: CATEGORY_NAME[b.category], score: b.score, cards: b.cards };
}

/** -1, 0, 1 comparison of two hands (a vs b). */
export function compareHands(a: Card[], b: Card[]): number {
  const sa = evaluateBest(a).score;
  const sb = evaluateBest(b).score;
  return sa === sb ? 0 : sa > sb ? 1 : -1;
}

/** Name the best hand from 2–7 cards; null when there are fewer than 5. Display-only. */
export function describeBestHand(cards: Card[]): { name: string; category: HandCategory } | null {
  if (cards.length < 5) return null;
  const r = evaluateBest(cards);
  return { name: r.name, category: r.category };
}
```

- [ ] **Step 2: Export from the shared barrel**

In `packages/shared/src/index.ts`, add:

```typescript
export * from './types.js';
export * from './events.js';
export * from './hand-eval.js';
```

- [ ] **Step 3: Turn the server evaluator into a re-export shim**

Replace the entire contents of `packages/server/src/engine/hand-evaluator.ts` with:

```typescript
// Hand evaluation now lives in @poker/shared so the client can reuse it.
// This shim preserves the engine's existing import paths.
export {
  evaluate5,
  evaluateBest,
  compareHands,
  describeBestHand,
  type HandCategory,
  type HandRank,
} from '@poker/shared';
```

- [ ] **Step 4: Source `rankValue` from shared in `cards.ts`**

In `packages/server/src/engine/cards.ts`, replace the local `RANK_VALUE` map and `rankValue` function with a re-export, keeping `RANKS`, `SUITS`, and `cardToString` intact. Change the top import and remove the local definitions:

```typescript
import type { Card, Rank, Suit } from '@poker/shared';
export { rankValue } from '@poker/shared';

export const RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

const SUIT_CHAR: Record<Suit, string> = {
  hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's',
};

/** Compact string like "Ah" / "10d" — handy for tests and logging. */
export function cardToString(card: Card): string {
  return `${card.rank}${SUIT_CHAR[card.suit]}`;
}
```

(Remove the now-unused `Rank` value import only if TypeScript flags it; `Rank` is still used as a type for `RANKS`.)

- [ ] **Step 5: Rebuild shared and run the server suite**

Run: `npm run build --workspace=packages/shared && npm run test --workspace=packages/server`
Expected: PASS — `hand-evaluator.test.ts` and `showdown.test.ts` still green through the shim.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/hand-eval.ts packages/shared/src/index.ts packages/server/src/engine/hand-evaluator.ts packages/server/src/engine/cards.ts
git commit -m "refactor(shared): move pure hand-evaluator into @poker/shared"
```

---

### Task 3: Seat layout geometry helper

**Files:**
- Create: `packages/client/src/table/SeatLayout.ts`
- Test: `packages/client/src/table/SeatLayout.test.ts`

**Interfaces:**
- Produces:
  - `interface SeatPos { leftPct: number; topPct: number; betLeftPct: number; betTopPct: number }`
  - `seatPositions(total: number): SeatPos[]` — positions for `total` slots on the felt ellipse; index 0 is bottom-center (the hero anchor), the rest fan evenly clockwise. Percentages are relative to the table box (0–100).
  - `arrangeSeats<T extends { discordUserId: string }>(players: T[], viewerId: string): { hero: T | null; opponents: T[] }` — rotates so the viewer is `hero` and the remaining players are `opponents` in clockwise order; `hero` is `null` when the viewer is not seated (spectating).

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/table/SeatLayout.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { seatPositions, arrangeSeats } from './SeatLayout';

describe('seatPositions', () => {
  it('places slot 0 at bottom-center', () => {
    const pos = seatPositions(6);
    expect(pos).toHaveLength(6);
    expect(Math.round(pos[0].leftPct)).toBe(50);
    expect(pos[0].topPct).toBeGreaterThan(95); // bottom of the ellipse
  });

  it('spreads slots evenly and keeps bet markers nearer the centre', () => {
    const pos = seatPositions(4);
    expect(Math.round(pos[2].topPct)).toBeLessThan(10); // slot opposite hero is at the top
    // bet marker is pulled toward centre (50,50)
    expect(Math.abs(pos[2].betTopPct - 50)).toBeLessThan(Math.abs(pos[2].topPct - 50));
  });
});

describe('arrangeSeats', () => {
  const players = [{ discordUserId: 'a' }, { discordUserId: 'b' }, { discordUserId: 'c' }];

  it('puts the viewer in hero and orders opponents clockwise after them', () => {
    const { hero, opponents } = arrangeSeats(players, 'b');
    expect(hero?.discordUserId).toBe('b');
    expect(opponents.map((p) => p.discordUserId)).toEqual(['c', 'a']);
  });

  it('returns hero=null and all players as opponents when spectating', () => {
    const { hero, opponents } = arrangeSeats(players, 'zzz');
    expect(hero).toBeNull();
    expect(opponents).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/client -- src/table/SeatLayout.test.ts`
Expected: FAIL — `Cannot find module './SeatLayout'`.

- [ ] **Step 3: Implement the helper**

Create `packages/client/src/table/SeatLayout.ts`:

```typescript
export interface SeatPos {
  leftPct: number;
  topPct: number;
  betLeftPct: number;
  betTopPct: number;
}

const RX = 49; // horizontal radius as % of the table box
const RY = 51; // vertical radius as % of the table box
const BET_RADIUS = 0.62; // bet markers sit this fraction of the way toward centre

/**
 * Positions for `total` seat slots on the felt ellipse. Slot 0 is bottom-centre
 * (the hero anchor); remaining slots fan evenly clockwise around the rest of the
 * ellipse. Angle 90° points down (matches screen Y growing downward).
 */
export function seatPositions(total: number): SeatPos[] {
  const out: SeatPos[] = [];
  for (let i = 0; i < total; i++) {
    const deg = 90 + (i * 360) / total;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    out.push({
      leftPct: 50 + RX * cos,
      topPct: 50 + RY * sin,
      betLeftPct: 50 + RX * BET_RADIUS * cos,
      betTopPct: 50 + RY * BET_RADIUS * sin,
    });
  }
  return out;
}

/** Rotate players so the viewer is the hero; opponents follow clockwise. */
export function arrangeSeats<T extends { discordUserId: string }>(
  players: T[],
  viewerId: string,
): { hero: T | null; opponents: T[] } {
  const idx = players.findIndex((p) => p.discordUserId === viewerId);
  if (idx === -1) return { hero: null, opponents: [...players] };
  return {
    hero: players[idx],
    opponents: [...players.slice(idx + 1), ...players.slice(0, idx)],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/client -- src/table/SeatLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/SeatLayout.ts packages/client/src/table/SeatLayout.test.ts
git commit -m "feat(client): seat ellipse geometry + viewer rotation helper"
```

---

### Task 4: Table animation tokens & keyframes

**Files:**
- Modify: `packages/client/src/index.css`

**Interfaces:**
- Produces CSS utility classes consumed by later tasks: `.animate-deal` (card drop-in), `.animate-reveal` (rotateY flip). Honors `prefers-reduced-motion`.

- [ ] **Step 1: Add keyframes and animation tokens**

In `packages/client/src/index.css`, add to the `@theme` block (after the existing `--animate-fade` line):

```css
  --animate-deal: rpn-deal 0.44s cubic-bezier(0.2, 1.05, 0.3, 1) both;
  --animate-reveal: rpn-reveal 0.36s ease-out both;
```

After the existing `@keyframes rpn-fade { ... }` block, add:

```css
@keyframes rpn-deal {
  0% { opacity: 0; transform: translateY(-56px) scale(0.84); }
  100% { opacity: 1; transform: none; }
}
@keyframes rpn-reveal {
  0% { transform: rotateY(82deg); opacity: 0.2; }
  100% { transform: none; opacity: 1; }
}
```

In the `@layer components` block, add helper classes:

```css
  .animate-deal { animation: var(--animate-deal); }
  .animate-reveal { animation: var(--animate-reveal); }
  @media (prefers-reduced-motion: reduce) {
    .animate-deal, .animate-reveal { animation: none; }
  }
```

- [ ] **Step 2: Verify the client still builds**

Run: `npm run build --workspace=packages/client`
Expected: PASS (type-check + Vite build succeed; CSS compiles).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/index.css
git commit -m "feat(client): table deal/reveal animation tokens"
```

---

### Task 5: Card component + hero hand-name hook

**Files:**
- Create: `packages/client/src/table/Card.tsx`
- Create: `packages/client/src/table/useHandName.ts`
- Test: `packages/client/src/table/Card.test.tsx`
- Test: `packages/client/src/table/useHandName.test.ts`

**Interfaces:**
- Consumes: `describeBestHand` from `@poker/shared` (Task 2); `Card` type.
- Produces:
  - `Card` component — `function PlayingCard(props: { card: Card | null; size?: 'sm' | 'md' | 'lg'; rotate?: number; reveal?: boolean }): JSX.Element`. `card: null` (or `reveal === false`) renders a felt-green card back with a gold spade; otherwise the face (rank + suit, red for hearts/diamonds).
  - `useHandName(holeCards: [Card, Card] | null, community: Card[]): { title: string; sub: string } | null` — `title` is the category name (e.g. "Two Pair"); `sub` is a short descriptor (currently the same category, room to enrich later). Returns `null` when no hand can be named yet.

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/table/Card.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayingCard } from './Card';

describe('PlayingCard', () => {
  it('renders the rank and a red suit for hearts when face-up', () => {
    render(<PlayingCard card={{ rank: 'A', suit: 'hearts' }} reveal />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByTestId('card-face')).toHaveAttribute('data-red', 'true');
  });

  it('renders a card back when card is null', () => {
    render(<PlayingCard card={null} />);
    expect(screen.getByTestId('card-back')).toBeInTheDocument();
  });
});
```

Create `packages/client/src/table/useHandName.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=packages/client -- src/table/Card.test.tsx src/table/useHandName.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the hook**

Create `packages/client/src/table/useHandName.ts`:

```typescript
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
```

- [ ] **Step 4: Implement the Card component**

Create `packages/client/src/table/Card.tsx`:

```tsx
import type { Card } from '@poker/shared';

const SUIT_SYMBOL: Record<Card['suit'], string> = {
  hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠',
};
const RED: Card['suit'][] = ['hearts', 'diamonds'];

const SIZES = {
  sm: 'h-[58px] w-[42px] rounded-[9px] text-[15px]',
  md: 'h-[106px] w-[76px] rounded-xl text-[19px]',
  lg: 'h-[118px] w-[84px] rounded-[15px] text-[24px]',
} as const;

interface Props {
  card: Card | null;
  size?: keyof typeof SIZES;
  rotate?: number;
  reveal?: boolean;
}

export function PlayingCard({ card, size = 'md', rotate = 0, reveal = true }: Props) {
  const faceUp = reveal && card != null;
  const style = rotate ? { transform: `rotate(${rotate}deg)` } : undefined;

  if (!faceUp) {
    return (
      <div
        data-testid="card-back"
        style={style}
        className={`flex items-center justify-center border-2 border-ink bg-gradient-to-br from-felt-400 to-felt-800 text-gold shadow-hard-ink-sm ${SIZES[size]}`}
      >
        ♠
      </div>
    );
  }

  const red = RED.includes(card!.suit);
  return (
    <div
      data-testid="card-face"
      data-red={red}
      style={style}
      className={`relative flex items-center justify-center border-[2.5px] border-ink bg-cream font-display font-bold shadow-card ${SIZES[size]} ${red ? 'text-red-border' : 'text-felt-900'}`}
    >
      <span className="absolute left-2 top-1.5 flex flex-col items-center leading-none">
        <span>{card!.rank}</span>
        <span className="text-[0.8em]">{SUIT_SYMBOL[card!.suit]}</span>
      </span>
      <span className="text-[2.2em] leading-none">{SUIT_SYMBOL[card!.suit]}</span>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=packages/client -- src/table/Card.test.tsx src/table/useHandName.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/table/Card.tsx packages/client/src/table/useHandName.ts packages/client/src/table/Card.test.tsx packages/client/src/table/useHandName.test.ts
git commit -m "feat(client): PlayingCard component + hero hand-name hook"
```

---

### Task 6: Seat component

**Files:**
- Create: `packages/client/src/table/Seat.tsx`
- Test: `packages/client/src/table/Seat.test.tsx`

**Interfaces:**
- Consumes: `PlayingCard` (Task 5); `SeatPos` (Task 3); `GamePlayer`, `ActionType` from `@poker/shared`.
- Produces: `Seat` component —
  `function Seat(props: { player: GamePlayer; pos: SeatPos; role: 'D' | 'SB' | 'BB' | null; isActive: boolean; timerPct: number | null; reveal: boolean; onOpen: () => void }): JSX.Element`.
  `role` is the dealer/blind badge; `isActive` draws the conic countdown ring fed by `timerPct` (0–100); `reveal` shows the opponent's hole-card faces (showdown); `onOpen` opens the player profile modal.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/table/Seat.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Seat } from './Seat';
import type { GamePlayer } from '@poker/shared';

const pos = { leftPct: 50, topPct: 5, betLeftPct: 50, betTopPct: 30 };

function player(over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    discordUserId: 'b', displayName: 'Bandit', avatarUrl: 'http://x/y.png', seatIndex: 1,
    chipStack: 4200, betThisRound: 200, totalBetThisHand: 200, holeCards: null,
    status: 'active', hasActed: true, lastAction: 'call', ...over,
  };
}

describe('Seat', () => {
  it('shows name, stack, the action pill and a role badge', () => {
    render(<Seat player={player()} pos={pos} role="BB" isActive={false} timerPct={null} reveal={false} onOpen={() => {}} />);
    expect(screen.getByText('Bandit')).toBeInTheDocument();
    expect(screen.getByText('4,200')).toBeInTheDocument();
    expect(screen.getByText('Call')).toBeInTheDocument();
    expect(screen.getByText('BB')).toBeInTheDocument();
  });

  it('labels an all-in player regardless of lastAction', () => {
    render(<Seat player={player({ status: 'all-in' })} pos={pos} role={null} isActive={false} timerPct={null} reveal={false} onOpen={() => {}} />);
    expect(screen.getByText('All-In')).toBeInTheDocument();
  });

  it('reveals hole-card faces when reveal is true', () => {
    const p = player({ holeCards: [{ rank: 'K', suit: 'hearts' }, { rank: 'Q', suit: 'hearts' }] });
    render(<Seat player={p} pos={pos} role={null} isActive={false} timerPct={null} reveal onOpen={() => {}} />);
    expect(screen.getAllByTestId('card-face').length).toBe(2);
  });

  it('calls onOpen when the avatar is clicked', () => {
    const onOpen = vi.fn();
    render(<Seat player={player()} pos={pos} role={null} isActive={false} timerPct={null} reveal={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Bandit/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/client -- src/table/Seat.test.tsx`
Expected: FAIL — `Cannot find module './Seat'`.

- [ ] **Step 3: Implement the component**

Create `packages/client/src/table/Seat.tsx`:

```tsx
import type { GamePlayer, ActionType } from '@poker/shared';
import { PlayingCard } from './Card';
import type { SeatPos } from './SeatLayout';

type Tone = 'fold' | 'call' | 'raise' | 'allin';

const TONE_CLASS: Record<Tone, string> = {
  fold: 'text-[#ff8a8a] bg-red/15 border-red/40',
  call: 'text-mint-bright bg-mint/15 border-mint/40',
  raise: 'text-gold-soft bg-gold/15 border-gold/40',
  allin: 'text-[#d8b6ff] bg-purple/20 border-purple/45',
};

const ROLE_CLASS: Record<'D' | 'SB' | 'BB', string> = {
  D: 'bg-gold', SB: 'bg-blue', BB: 'bg-mint',
};

function actionPill(player: GamePlayer): { text: string; tone: Tone } | null {
  if (player.status === 'all-in') return { text: 'All-In', tone: 'allin' };
  if (player.status === 'folded') return { text: 'Fold', tone: 'fold' };
  const map: Partial<Record<ActionType, { text: string; tone: Tone }>> = {
    check: { text: 'Check', tone: 'call' },
    call: { text: 'Call', tone: 'call' },
    raise: { text: 'Raise', tone: 'raise' },
    'all-in': { text: 'All-In', tone: 'allin' },
    fold: { text: 'Fold', tone: 'fold' },
  };
  return player.lastAction ? map[player.lastAction] ?? null : null;
}

interface Props {
  player: GamePlayer;
  pos: SeatPos;
  role: 'D' | 'SB' | 'BB' | null;
  isActive: boolean;
  timerPct: number | null;
  reveal: boolean;
  onOpen: () => void;
}

export function Seat({ player, pos, role, isActive, timerPct, reveal, onOpen }: Props) {
  const folded = player.status === 'folded';
  const pill = actionPill(player);
  const showCards = !folded;
  const revealed = reveal && !folded && player.holeCards != null;
  const ringColor = (timerPct ?? 100) > 33 ? '#44e0a3' : '#ff6b6b';

  return (
    <>
      <div
        className="absolute z-[4] flex w-[106px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
        style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%`, opacity: folded ? 0.45 : 1 }}
      >
        {showCards && (
          <div className="z-[1] mb-[-6px] flex h-12 justify-center">
            {revealed ? (
              <>
                <div className="animate-reveal"><PlayingCard card={player.holeCards![0]} size="sm" rotate={-9} reveal /></div>
                <div className="-ml-2 animate-reveal"><PlayingCard card={player.holeCards![1]} size="sm" rotate={9} reveal /></div>
              </>
            ) : (
              <>
                <PlayingCard card={null} size="sm" rotate={-9} />
                <div className="-ml-2"><PlayingCard card={null} size="sm" rotate={9} /></div>
              </>
            )}
          </div>
        )}

        <button
          onClick={onOpen}
          aria-label={`Open ${player.displayName} profile`}
          className="relative h-[52px] w-[52px] rounded-[15px] border-[3px] border-ink shadow-hard-ink hover:brightness-110"
          style={isActive && timerPct != null
            ? { background: `conic-gradient(${ringColor} ${timerPct}%, rgba(0,0,0,.4) 0)`, padding: 3 }
            : undefined}
        >
          <img src={player.avatarUrl} alt="" className="h-full w-full rounded-[12px] object-cover" />
          {role && (
            <span className={`absolute -bottom-1.5 -right-1.5 flex h-[23px] w-[23px] items-center justify-center rounded-full border-[2.5px] border-ink font-display text-[10px] font-bold text-[#0b2c1f] ${ROLE_CLASS[role]}`}>
              {role}
            </span>
          )}
        </button>

        <div className="flex flex-col items-center rounded-xl border-2 border-black/35 bg-felt-900/70 px-2.5 py-1 leading-tight shadow-hard-ink-sm">
          <span className="max-w-[104px] truncate font-display text-[13px] font-semibold text-white">{player.displayName}</span>
          <span className="text-xs font-extrabold text-gold-soft">● {player.chipStack.toLocaleString()}</span>
        </div>

        {pill && (
          <span className={`rounded-pill border-2 px-2.5 py-0.5 text-[11px] font-extrabold ${TONE_CLASS[pill.tone]}`}>{pill.text}</span>
        )}
      </div>

      {player.betThisRound > 0 && (
        <div
          className="absolute z-[5] inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-pill border-2 border-ink bg-felt-900/80 py-0.5 pl-1 pr-2.5 font-display text-[13px] font-bold text-gold-soft shadow-hard-ink-sm"
          style={{ left: `${pos.betLeftPct}%`, top: `${pos.betTopPct}%` }}
        >
          <span className="h-[11px] w-[11px] rounded-full border-2 border-gold-border bg-gold" />
          {player.betThisRound.toLocaleString()}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/client -- src/table/Seat.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/Seat.tsx packages/client/src/table/Seat.test.tsx
git commit -m "feat(client): table Seat component (avatar, ring, role, action, bet)"
```

---

### Task 7: Center cluster — community cards & pot

**Files:**
- Create: `packages/client/src/table/CenterCluster.tsx`
- Test: `packages/client/src/table/CenterCluster.test.tsx`

**Interfaces:**
- Consumes: `PlayingCard` (Task 5); `GameState`, `Pot`, `GamePhase` from `@poker/shared`.
- Produces: `CenterCluster` component —
  `function CenterCluster(props: { phase: GamePhase; community: Card[]; pots: Pot[] }): JSX.Element`.
  Renders the phase pill, five board slots (filled cards animate in; empties are dashed), and a pot row: main pot (first entry of `pots`) plus a side-pot pill for each additional entry.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/table/CenterCluster.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CenterCluster } from './CenterCluster';
import type { Card, Pot } from '@poker/shared';

const board: Card[] = [
  { rank: 'A', suit: 'hearts' }, { rank: '10', suit: 'diamonds' }, { rank: '4', suit: 'clubs' },
];

describe('CenterCluster', () => {
  it('renders the flop cards and the main pot total', () => {
    const pots: Pot[] = [{ amount: 1450, eligiblePlayerIds: ['a', 'b'] }];
    render(<CenterCluster phase="flop" community={board} pots={pots} />);
    expect(screen.getAllByTestId('card-face')).toHaveLength(3);
    expect(screen.getByText('1,450')).toBeInTheDocument();
  });

  it('shows a side-pot pill when there is more than one pot', () => {
    const pots: Pot[] = [
      { amount: 1450, eligiblePlayerIds: ['a', 'b'] },
      { amount: 600, eligiblePlayerIds: ['a'] },
    ];
    render(<CenterCluster phase="river" community={board} pots={pots} />);
    expect(screen.getByText(/SIDE/)).toBeInTheDocument();
    expect(screen.getByText('600')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/client -- src/table/CenterCluster.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `packages/client/src/table/CenterCluster.tsx`:

```tsx
import type { Card, GamePhase, Pot } from '@poker/shared';
import { PlayingCard } from './Card';

const PHASE_LABEL: Partial<Record<GamePhase, string>> = {
  'pre-flop': '♦ PRE-FLOP', flop: '♦ FLOP', turn: '♦ TURN', river: '♦ RIVER',
  showdown: '♠ SHOWDOWN', 'hand-complete': '♠ SHOWDOWN', waiting: '♣ WAITING',
};

interface Props {
  phase: GamePhase;
  community: Card[];
  pots: Pot[];
}

export function CenterCluster({ phase, community, pots }: Props) {
  const main = pots[0]?.amount ?? 0;
  const sidePots = pots.slice(1);

  return (
    <div className="absolute left-1/2 top-[47%] flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2.5">
      <div className="inline-flex items-center gap-2 rounded-pill border-[2.5px] border-gold-border bg-gold px-4 py-1.5 font-display text-[13px] font-semibold tracking-[0.18em] text-felt-900 shadow-hard-gold">
        {PHASE_LABEL[phase] ?? ''}
      </div>

      <div className="flex h-[112px] items-center gap-2.5">
        {Array.from({ length: 5 }).map((_, i) =>
          community[i] ? (
            <div key={i} className="animate-deal" style={{ animationDelay: `${i * 90}ms` }}>
              <PlayingCard card={community[i]} size="md" reveal />
            </div>
          ) : (
            <div key={i} className="h-[106px] w-[76px] rounded-xl border-[2.5px] border-dashed border-white/15" />
          ),
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <div className="inline-flex items-center gap-2.5 rounded-pill border-[2.5px] border-ink bg-felt-900/70 py-1.5 pl-2.5 pr-2.5 shadow-pill">
          <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">POT</span>
          <span className="font-display text-[22px] font-bold leading-none text-gold-soft">{main.toLocaleString()}</span>
        </div>
        {sidePots.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-pill border-2 border-blue/40 bg-felt-900/70 px-2.5 py-1.5 text-[11px] font-extrabold text-blue">
            SIDE ● {p.amount.toLocaleString()}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/client -- src/table/CenterCluster.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/CenterCluster.tsx packages/client/src/table/CenterCluster.test.tsx
git commit -m "feat(client): center cluster (phase pill, board, pot + side pots)"
```

---

### Task 8: Hero HUD

**Files:**
- Create: `packages/client/src/table/HeroHud.tsx`
- Test: `packages/client/src/table/HeroHud.test.tsx`

**Interfaces:**
- Consumes: `PlayingCard` (Task 5); `useHandName` (Task 5); `GamePlayer` from `@poker/shared`.
- Produces: `HeroHud` component —
  `function HeroHud(props: { me: GamePlayer | null; community: Card[]; bank: number; isSpectating: boolean; isMyTurn: boolean; turnSecondsLeft: number | null }): JSX.Element`.
  Seated: fanned hole cards, hand-name line (or "Folded"), table chip stack, bank, and a turn-timer chip when it's the hero's turn. Spectating: a "Watching the table" panel + bank.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/table/HeroHud.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroHud } from './HeroHud';
import type { Card, GamePlayer } from '@poker/shared';

const community: Card[] = [
  { rank: 'A', suit: 'hearts' }, { rank: '10', suit: 'diamonds' }, { rank: '4', suit: 'clubs' },
];

function me(over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    discordUserId: 'me', displayName: 'You', avatarUrl: '', seatIndex: 0,
    chipStack: 3000, betThisRound: 0, totalBetThisHand: 0,
    holeCards: [{ rank: 'A', suit: 'spades' }, { rank: '10', suit: 'spades' }],
    status: 'active', hasActed: false, lastAction: null, ...over,
  };
}

describe('HeroHud', () => {
  it('shows the hand name, table chips and bank when seated', () => {
    render(<HeroHud me={me()} community={community} bank={10000} isSpectating={false} isMyTurn={false} turnSecondsLeft={null} />);
    expect(screen.getByText('Two Pair')).toBeInTheDocument();
    expect(screen.getByText('3,000')).toBeInTheDocument();
    expect(screen.getByText('10,000')).toBeInTheDocument();
  });

  it('shows a turn timer when it is the hero turn', () => {
    render(<HeroHud me={me()} community={community} bank={10000} isSpectating={false} isMyTurn turnSecondsLeft={12} />);
    expect(screen.getByText('12s')).toBeInTheDocument();
  });

  it('shows the spectating panel when spectating', () => {
    render(<HeroHud me={null} community={[]} bank={10000} isSpectating isMyTurn={false} turnSecondsLeft={null} />);
    expect(screen.getByText(/Watching the table/i)).toBeInTheDocument();
  });

  it('shows Folded when the hero has folded', () => {
    render(<HeroHud me={me({ status: 'folded' })} community={community} bank={10000} isSpectating={false} isMyTurn={false} turnSecondsLeft={null} />);
    expect(screen.getByText('Folded')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/client -- src/table/HeroHud.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `packages/client/src/table/HeroHud.tsx`:

```tsx
import type { Card, GamePlayer } from '@poker/shared';
import { PlayingCard } from './Card';
import { useHandName } from './useHandName';

interface Props {
  me: GamePlayer | null;
  community: Card[];
  bank: number;
  isSpectating: boolean;
  isMyTurn: boolean;
  turnSecondsLeft: number | null;
}

export function HeroHud({ me, community, bank, isSpectating, isMyTurn, turnSecondsLeft }: Props) {
  const folded = me?.status === 'folded';
  const handName = useHandName(folded ? null : me?.holeCards ?? null, community);

  return (
    <div className="flex flex-none justify-center px-[18px] pb-2">
      <div className="inline-flex items-stretch gap-4 rounded-[18px] border-[2.5px] border-black/35 bg-felt-900/85 px-4 py-3 shadow-panel">
        {!isSpectating && me && (
          <>
            <div className="flex items-center gap-2.5">
              <PlayingCard card={me.holeCards?.[0] ?? null} size="lg" reveal={!!me.holeCards} />
              <PlayingCard card={me.holeCards?.[1] ?? null} size="lg" reveal={!!me.holeCards} />
            </div>
            <div className="flex min-w-[150px] flex-col justify-center gap-0.5 border-r-2 border-black/20 pr-4">
              <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">YOUR HAND</span>
              {folded ? (
                <>
                  <span className="font-display text-[26px] font-semibold leading-tight text-[#ff8a8a]">Folded</span>
                  <span className="text-sm font-bold text-[#9b6a6a]">Sitting this one out</span>
                </>
              ) : (
                <>
                  <span className="font-display text-[26px] font-semibold leading-tight text-white">{handName?.title ?? '—'}</span>
                  <span className="text-sm font-bold text-sage-light">{handName?.sub ?? ''}</span>
                </>
              )}
            </div>
            <Stat label="CHIPS · TABLE" value={me.chipStack.toLocaleString()} accent />
          </>
        )}

        {isSpectating && (
          <div className="flex min-w-[220px] items-center gap-3 border-r-2 border-black/20 pr-[18px]">
            <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[13px] border-[2.5px] border-ink bg-felt-300 text-[23px] text-sage-light">👁</span>
            <div className="flex flex-col gap-0.5 leading-tight">
              <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">SPECTATING</span>
              <span className="font-display text-[22px] font-semibold leading-tight text-white">Watching the table</span>
              <span className="text-[13px] font-bold text-sage-light">You won't be dealt in — hole cards stay hidden.</span>
            </div>
          </div>
        )}

        <Stat label="BANK" value={bank.toLocaleString()} />

        {isMyTurn && turnSecondsLeft != null && (
          <div className="flex flex-col items-center justify-center gap-0.5 rounded-[13px] border-2 border-gold/40 bg-gold/15 px-4 py-1.5">
            <span className="text-[10px] font-extrabold tracking-[0.12em] text-gold-soft">YOUR TURN</span>
            <span className="font-display text-[22px] font-bold leading-none text-gold-soft">{Math.ceil(turnSecondsLeft)}s</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 rounded-[13px] border-2 px-[15px] py-2 ${accent ? 'border-gold/35 bg-gold/10' : 'border-black/25 bg-white/5'}`}>
      <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg border-2 text-sm ${accent ? 'border-gold-border bg-gold text-[#2a1c00]' : 'border-ink bg-felt-300 text-sage-light'}`}>●</span>
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] font-extrabold tracking-[0.1em] text-sage-muted">{label}</span>
        <span className={`font-display text-[20px] font-bold ${accent ? 'text-gold-soft' : 'text-white'}`}>{value}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/client -- src/table/HeroHud.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/HeroHud.tsx packages/client/src/table/HeroHud.test.tsx
git commit -m "feat(client): hero HUD (hole cards, hand name, chips, bank, timer)"
```

---

### Task 9: Action bar (rebuilt)

**Files:**
- Create: `packages/client/src/table/TableActionBar.tsx`
- Test: `packages/client/src/table/TableActionBar.test.tsx`
- (The old `packages/client/src/ActionBar.tsx` is removed in Task 13.)

**Interfaces:**
- Consumes: `GameState`, `PlayerAction` from `@poker/shared`.
- Produces: `TableActionBar` component —
  `function TableActionBar(props: { state: GameState; myId: string; onAction: (a: PlayerAction) => void }): JSX.Element | null`.
  Renders only when it is the hero's turn in a betting phase. Quick-raise buttons set the slider to ½-pot / pot / 2×-pot totals (clamped to `[minRaiseTotal, maxTotal]`, stepped by `smallBlind`); Fold, Call/Check, Raise (to slider value), All-In emit actions.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/table/TableActionBar.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableActionBar } from './TableActionBar';
import type { GameState, GamePlayer } from '@poker/shared';

function hero(over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    discordUserId: 'me', displayName: 'You', avatarUrl: '', seatIndex: 0,
    chipStack: 3000, betThisRound: 0, totalBetThisHand: 0,
    holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }],
    status: 'active', hasActed: false, lastAction: null, ...over,
  };
}

function state(over: Partial<GameState> = {}): GameState {
  return {
    gameId: 'g', instanceId: 'i', phase: 'flop', players: [hero()],
    communityCards: [], pots: [{ amount: 400, eligiblePlayerIds: ['me'] }],
    currentPlayerIndex: 0, dealerIndex: 0, smallBlindIndex: 0, bigBlindIndex: 0,
    callAmount: 0, minRaise: 50, handNumber: 1,
    config: { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 },
    ...over,
  };
}

describe('TableActionBar', () => {
  it('returns null when it is not the hero turn', () => {
    const { container } = render(<TableActionBar state={state({ currentPlayerIndex: 0, players: [hero({ status: 'folded' })] })} myId="me" onAction={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('emits check when there is nothing to call', () => {
    const onAction = vi.fn();
    render(<TableActionBar state={state()} myId="me" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'check' });
  });

  it('emits a raise to the slider value', () => {
    const onAction = vi.fn();
    render(<TableActionBar state={state()} myId="me" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /^Raise/ }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'raise' }));
  });

  it('emits all-in', () => {
    const onAction = vi.fn();
    render(<TableActionBar state={state()} myId="me" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'All-In' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'all-in' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/client -- src/table/TableActionBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `packages/client/src/table/TableActionBar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { GameState, PlayerAction } from '@poker/shared';

const BETTING_PHASES: GameState['phase'][] = ['pre-flop', 'flop', 'turn', 'river'];

interface Props {
  state: GameState;
  myId: string;
  onAction: (action: PlayerAction) => void;
}

export function TableActionBar({ state, myId, onAction }: Props) {
  const me = state.players.find((p) => p.discordUserId === myId);
  const isMyTurn =
    BETTING_PHASES.includes(state.phase) &&
    me?.status === 'active' &&
    state.players[state.currentPlayerIndex]?.discordUserId === myId;

  const toCall = me ? state.callAmount - me.betThisRound : 0;
  const maxTotal = me ? me.betThisRound + me.chipStack : 0;
  const minRaiseTotal = Math.min(state.callAmount + state.minRaise, maxTotal);
  const canRaise = !!me && maxTotal > state.callAmount && me.chipStack > toCall;
  const potTotal = state.pots.reduce((s, p) => s + p.amount, 0);
  const step = state.config.smallBlind;

  const clamp = (v: number) => Math.max(minRaiseTotal, Math.min(maxTotal, Math.round(v / step) * step));
  const [raiseTo, setRaiseTo] = useState(minRaiseTotal);

  useEffect(() => {
    setRaiseTo(minRaiseTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, state.callAmount, state.handNumber]);

  if (!me || !isMyTurn) return null;

  const allIn = raiseTo >= maxTotal;
  const preset = (factor: number) => setRaiseTo(clamp((potTotal + toCall) * factor));

  const quick = 'rounded-xl border-[2.5px] border-ink bg-felt-300 px-3 py-2.5 font-display text-[13px] font-semibold text-[#dfeee6] shadow-hard-ink-sm active:translate-y-0.5';
  const bigBtn = 'rounded-[15px] border-[2.5px] px-6 py-3 font-display text-base font-semibold active:translate-y-1';

  return (
    <div className="flex-none px-[18px] pb-3.5">
      <div className="rounded-[18px] border-[2.5px] border-black/35 bg-felt-900/70 px-[18px] py-3 shadow-panel">
        <div className="flex items-center gap-3.5">
          <div className="flex flex-none gap-1.5">
            <button className={quick} onClick={() => preset(0.5)}>½ Pot</button>
            <button className={quick} onClick={() => preset(1)}>Pot</button>
            <button className={quick} onClick={() => preset(2)}>2× Pot</button>
          </div>
          {canRaise && (
            <div className="flex min-w-[90px] flex-1 items-center gap-2.5">
              <input
                type="range"
                min={minRaiseTotal}
                max={maxTotal}
                step={step}
                value={raiseTo}
                onChange={(e) => setRaiseTo(clamp(Number(e.target.value)))}
                className="min-w-[60px] flex-1"
              />
              <span className="min-w-[78px] flex-none text-right font-display text-lg font-bold text-gold">
                {allIn ? 'ALL-IN' : raiseTo.toLocaleString()}
              </span>
            </div>
          )}
          <div className="flex flex-none gap-2.5">
            <button
              className={`${bigBtn} border-red-border bg-red text-white shadow-hard-red`}
              onClick={() => onAction({ type: 'fold' })}
            >
              Fold
            </button>
            <button
              className={`${bigBtn} border-mint-border bg-mint text-felt-900 shadow-pill`}
              onClick={() => onAction(toCall === 0 ? { type: 'check' } : { type: 'call' })}
            >
              {toCall === 0 ? 'Check' : `Call ${Math.min(toCall, me.chipStack).toLocaleString()}`}
            </button>
            {canRaise && (
              <button
                className={`${bigBtn} border-gold-border bg-gold text-[#2a1c00] shadow-hard-gold`}
                onClick={() => onAction({ type: 'raise', amount: raiseTo })}
              >
                {allIn ? 'All-In' : `Raise ${raiseTo.toLocaleString()}`}
              </button>
            )}
            <button
              className={`${bigBtn} border-[#6d3fd6] bg-purple text-white`}
              onClick={() => onAction({ type: 'all-in' })}
            >
              All-In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/client -- src/table/TableActionBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/TableActionBar.tsx packages/client/src/table/TableActionBar.test.tsx
git commit -m "feat(client): rebuilt action bar with quick-raise presets"
```

---

### Task 10: Extend `UserPopout` with seat actions

**Files:**
- Modify: `packages/client/src/lobby/UserPopout.tsx`
- Test: `packages/client/src/lobby/UserPopout.test.tsx` (append cases)

**Interfaces:**
- Consumes: existing `UserPopoutProps` (`identity`, `stats`, `onClose`).
- Produces: extended `UserPopoutProps` with an **optional** `seat?: SeatActions`:

```typescript
export interface SeatActions {
  mode: 'playing' | 'spectating';
  buyIn: number;
  canJoin: boolean;
  joinReason: string;            // shown when canJoin is false
  pending: 'leave' | 'spectate' | null;
  leaveHint: string;
  onSpectate: () => void;        // sit_out
  onJoin: () => void;            // sit_in
  onLeave: () => void;           // leave_table
  onCancelPending: () => void;   // cancel_pending
}
```

When `seat` is provided, a "Your Seat" section renders below the tabs (Spectate / Join Table / pending+Cancel / Leave Table). When `seat` is omitted (lobby usage), the popout is unchanged.

- [ ] **Step 1: Write the failing test** — append to `packages/client/src/lobby/UserPopout.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserPopout } from './UserPopout';
import type { DiscordIdentity } from '@poker/shared';

const identity: DiscordIdentity = {
  discordUserId: 'me', displayName: 'You', avatarUrl: '', chipBalance: 10000,
};

describe('UserPopout seat actions', () => {
  it('shows Spectate and Leave Table when seated and playing', () => {
    const onSpectate = vi.fn();
    render(
      <UserPopout
        identity={identity}
        stats={null}
        onClose={() => {}}
        seat={{
          mode: 'playing', buyIn: 3000, canJoin: true, joinReason: '', pending: null,
          leaveHint: 'Back to the lobby', onSpectate, onJoin: () => {}, onLeave: () => {}, onCancelPending: () => {},
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Spectate/i }));
    expect(onSpectate).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Leave Table/i })).toBeInTheDocument();
  });

  it('disables Join with a reason when canJoin is false', () => {
    render(
      <UserPopout
        identity={identity}
        stats={null}
        onClose={() => {}}
        seat={{
          mode: 'spectating', buyIn: 3000, canJoin: false, joinReason: 'Not enough chips', pending: null,
          leaveHint: 'Any time', onSpectate: () => {}, onJoin: () => {}, onLeave: () => {}, onCancelPending: () => {},
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /Join Table/i })).toBeDisabled();
    expect(screen.getByText('Not enough chips')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/client -- src/lobby/UserPopout.test.tsx`
Expected: FAIL — `seat` prop not accepted / "Your Seat" controls absent.

- [ ] **Step 3: Extend the component**

In `packages/client/src/lobby/UserPopout.tsx`, add the `SeatActions` interface and `seat` prop, and render the section. Add near the top (after imports):

```typescript
export interface SeatActions {
  mode: 'playing' | 'spectating';
  buyIn: number;
  canJoin: boolean;
  joinReason: string;
  pending: 'leave' | 'spectate' | null;
  leaveHint: string;
  onSpectate: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onCancelPending: () => void;
}
```

Change the props interface:

```typescript
export interface UserPopoutProps {
  identity: DiscordIdentity;
  stats: PlayerStatsSummary | null;
  onClose: () => void;
  seat?: SeatActions;
}

export function UserPopout({ identity, stats, onClose, seat }: UserPopoutProps) {
```

Then, inside the content `div` (the `px-[18px] pb-[18px] pt-4` block), replace the existing trailing **Close** button with the seat section followed by Close:

```tsx
          {seat && (
            <div className="mt-3.5 flex flex-col gap-2.5 border-t-2 border-black/20 pt-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">YOUR SEAT</span>
                <span className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 font-display text-xs font-bold ${seat.mode === 'playing' ? 'bg-mint/15 text-mint-bright' : 'bg-blue/15 text-blue'}`}>
                  <span className={`h-2 w-2 rounded-pill ${seat.mode === 'playing' ? 'bg-mint' : 'bg-blue'}`} />
                  {seat.mode === 'playing' ? 'Playing' : 'Spectating'}
                </span>
              </div>

              {seat.mode === 'playing' && (
                <button
                  onClick={seat.onSpectate}
                  className="flex w-full items-center gap-3 rounded-2xl border-2 border-black/30 bg-felt-600 px-3.5 py-3 text-left font-display text-base font-semibold text-white hover:bg-felt-700"
                >
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border-2 border-blue/40 bg-blue/15 text-[17px] text-blue">👁</span>
                  <span className="flex flex-col leading-tight"><span>Spectate</span><span className="text-xs font-bold text-sage-muted">Sit out — stop being dealt in</span></span>
                </button>
              )}

              {seat.mode === 'spectating' && (
                <div className="relative">
                  <button
                    onClick={seat.onJoin}
                    disabled={!seat.canJoin}
                    className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3.5 py-3 text-left font-display text-base font-semibold ${seat.canJoin ? 'cursor-pointer border-gold-border bg-gold text-[#2a1c00] shadow-hard-gold' : 'cursor-not-allowed border-black/30 bg-felt-300 text-sage-muted opacity-75'}`}
                  >
                    <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border-2 border-black/30 bg-black/15 text-[17px]">♠</span>
                    <span className="flex flex-col leading-tight"><span>Join Table</span><span className="text-xs font-bold text-sage-muted">Buy in for {seat.buyIn.toLocaleString()} · next hand</span></span>
                  </button>
                  {!seat.canJoin && seat.joinReason && (
                    <p className="mt-2 rounded-xl border-2 border-ink bg-felt-800 px-3 py-2 text-[13px] font-bold text-[#ffd0d0]">{seat.joinReason}</p>
                  )}
                </div>
              )}

              {seat.pending && (
                <div className="flex items-center justify-between gap-2.5 rounded-xl border-2 border-gold/35 bg-gold/10 py-2.5 pl-3.5 pr-2.5">
                  <span className="text-[13px] font-bold text-gold-soft">
                    {seat.pending === 'leave' ? 'Leaving when this hand finishes' : 'Moving to spectate when this hand finishes'}
                  </span>
                  <button onClick={seat.onCancelPending} className="flex-none rounded-[10px] border-2 border-ink bg-felt-300 px-3 py-1.5 font-display text-xs font-semibold text-[#dfeee6]">Cancel</button>
                </div>
              )}

              <button
                onClick={seat.onLeave}
                className="flex w-full items-center gap-3 rounded-2xl border-2 border-red/35 bg-red/15 px-3.5 py-3 text-left font-display text-base font-semibold text-white hover:bg-red/20"
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border-2 border-red/40 bg-red/20 text-[17px] text-[#ff9b9b]">↩</span>
                <span className="flex flex-col leading-tight"><span>Leave Table</span><span className="text-xs font-bold text-[#cc9999]">{seat.leaveHint}</span></span>
              </button>
            </div>
          )}

          <button
            onClick={onClose}
            className="mt-3.5 w-full rounded-xl border-2 border-red/30 bg-red/10 py-2.5 font-display text-sm font-semibold text-[#ff9b9b] hover:bg-red/20"
          >
            Close
          </button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/client -- src/lobby/UserPopout.test.tsx`
Expected: PASS (new seat cases + existing lobby cases).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lobby/UserPopout.tsx packages/client/src/lobby/UserPopout.test.tsx
git commit -m "feat(client): UserPopout seat actions (spectate/join/leave/pending)"
```

---

### Task 11: Table header (logo, hand #, spectator eye, user button)

**Files:**
- Create: `packages/client/src/table/TableHeader.tsx`
- Test: `packages/client/src/table/TableHeader.test.tsx`

**Interfaces:**
- Consumes: `DiscordIdentity`, `GameState['spectators']`, `TableConfig` from `@poker/shared`.
- Produces: `TableHeader` component —
  `function TableHeader(props: { identity: DiscordIdentity; handNumber: number; config: TableConfig; spectators: { discordUserId: string; displayName: string; avatarUrl: string }[]; heroStack: number | null; onOpenUser: () => void }): JSX.Element`.
  Shows the blinds label (`SB/BB`), "Hand #N", the spectator **eye** count with a hover popout listing spectators, and the user button (avatar + table stack) that calls `onOpenUser`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/table/TableHeader.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TableHeader } from './TableHeader';
import type { DiscordIdentity, TableConfig } from '@poker/shared';

const identity: DiscordIdentity = { discordUserId: 'me', displayName: 'You', avatarUrl: '', chipBalance: 10000 };
const config: TableConfig = { buyIn: 3000, smallBlind: 50, bigBlind: 100, maxPlayers: 9, turnSeconds: 30 };

describe('TableHeader', () => {
  it('shows the hand number, blinds and spectator count', () => {
    render(
      <TableHeader identity={identity} handNumber={1284} config={config}
        spectators={[{ discordUserId: 's', displayName: 'Squeak', avatarUrl: '' }]}
        heroStack={3000} onOpenUser={() => {}} />,
    );
    expect(screen.getByText(/Hand #1,284/)).toBeInTheDocument();
    expect(screen.getByText(/50 \/ 100/)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // spectator count
  });

  it('opens the user menu when the user button is clicked', () => {
    const onOpenUser = vi.fn();
    render(
      <TableHeader identity={identity} handNumber={1} config={config} spectators={[]}
        heroStack={null} onOpenUser={onOpenUser} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /You/ }));
    expect(onOpenUser).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/client -- src/table/TableHeader.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `packages/client/src/table/TableHeader.tsx`:

```tsx
import type { DiscordIdentity, TableConfig } from '@poker/shared';

interface Spectator { discordUserId: string; displayName: string; avatarUrl: string }

interface Props {
  identity: DiscordIdentity;
  handNumber: number;
  config: TableConfig;
  spectators: Spectator[];
  heroStack: number | null;
  onOpenUser: () => void;
}

export function TableHeader({ identity, handNumber, config, spectators, heroStack, onOpenUser }: Props) {
  return (
    <header className="z-20 flex flex-none items-center gap-4 px-[22px] py-2.5">
      <div className="flex flex-none items-center gap-2.5">
        <div className="flex h-[42px] w-[42px] -rotate-[4deg] items-center justify-center rounded-[13px] border-[2.5px] border-gold-border bg-gold text-[23px] text-[#2a1c00] shadow-hard-gold">♠</div>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base font-semibold text-white">Ratbag Table</span>
          <span className="text-[11px] font-extrabold tracking-[0.06em] text-sage">
            NL HOLD'EM · {config.smallBlind} / {config.bigBlind}
          </span>
        </div>
      </div>

      <div className="mx-auto inline-flex items-center gap-2 rounded-pill border-2 border-black/30 bg-black/25 px-3.5 py-1.5">
        <span className="h-[9px] w-[9px] rounded-pill bg-mint" />
        <span className="font-display text-sm font-semibold text-[#cfeadd]">Hand #{handNumber.toLocaleString()}</span>
      </div>

      <div className="group relative flex-none">
        <div className="flex items-center gap-1.5 rounded-pill border-2 border-black/30 bg-black/25 px-3 py-1.5">
          <span className="text-base text-sage-light">👁</span>
          <span className="font-display text-sm font-bold text-[#cfeadd]">{spectators.length}</span>
        </div>
        <div className="invisible absolute right-0 top-[calc(100%+8px)] z-[45] w-[212px] rounded-2xl border-[2.5px] border-black/40 bg-felt-500 p-3 opacity-0 shadow-panel transition group-hover:visible group-hover:opacity-100">
          <div className="mb-2.5 text-[11px] font-extrabold tracking-[0.1em] text-sage">SPECTATING · {spectators.length}</div>
          <div className="flex flex-col gap-2.5">
            {spectators.length === 0 && <span className="text-[13px] font-bold text-sage-muted">No spectators</span>}
            {spectators.map((s) => (
              <div key={s.discordUserId} className="flex items-center gap-2.5">
                <img src={s.avatarUrl} alt="" className="h-[30px] w-[30px] flex-none rounded-[9px] border-2 border-ink object-cover" />
                <span className="font-display text-sm font-semibold text-white">{s.displayName}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={onOpenUser}
        className="flex flex-none items-center gap-2.5 rounded-2xl border-[2.5px] border-black/30 bg-white/5 py-1.5 pl-1.5 pr-3.5 shadow-hard-ink hover:-translate-y-px"
      >
        <img src={identity.avatarUrl} alt="" className="h-[38px] w-[38px] rounded-[11px] border-[2.5px] border-gold-border object-cover" />
        <span className="flex flex-col items-start leading-tight">
          <span className="font-display text-sm font-semibold text-white">{identity.displayName}</span>
          {heroStack != null && <span className="text-xs font-extrabold text-gold-soft">● {heroStack.toLocaleString()}</span>}
        </span>
        <span className="ml-0.5 text-[11px] text-sage">▼</span>
      </button>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/client -- src/table/TableHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/TableHeader.tsx packages/client/src/table/TableHeader.test.tsx
git commit -m "feat(client): table header (blinds, hand #, spectator eye, user button)"
```

---

### Task 12: TableScreen composition + socket wiring

**Files:**
- Create: `packages/client/src/table/TableScreen.tsx`
- Test: `packages/client/src/table/TableScreen.test.tsx`

**Interfaces:**
- Consumes: every table component above; `UserPopout` + `SeatActions` (Task 10); `PlayerProfileModal` (lobby, reused); `useStats` (lobby); `arrangeSeats` + `seatPositions` (Task 3); `ClientSocket` (from `../socket`); `DiscordIdentity`, `GameState`, `PlayerAction`, `LobbyPlayer` from `@poker/shared`.
- Produces: `TableScreen` component —
  `function TableScreen(props: { socket: ClientSocket; identity: DiscordIdentity }): JSX.Element`.
  Subscribes to `game_state_update`, `timer_tick`, `hand_result`; renders header + felt (seats via `arrangeSeats`/`seatPositions` + `CenterCluster`) + `HeroHud` + `TableActionBar`; opens `UserPopout` (with `seat` actions wired to `sit_out`/`sit_in`/`leave_table`/`cancel_pending`) and `PlayerProfileModal` on seat click. Shows a board-free waiting view when `waitingForPlayers`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/table/TableScreen.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { EventEmitter } from 'events';
import { TableScreen } from './TableScreen';
import type { DiscordIdentity, GameState } from '@poker/shared';

function fakeSocket() {
  const ee = new EventEmitter();
  return {
    on: (ev: string, fn: (...a: any[]) => void) => { ee.on(ev, fn); return undefined as any; },
    off: (ev: string, fn: (...a: any[]) => void) => { ee.off(ev, fn); return undefined as any; },
    emit: vi.fn((ev: string, ...a: any[]) => { ee.emit(ev, ...a); return undefined as any; }),
    __ee: ee,
  };
}

const identity: DiscordIdentity = { discordUserId: 'me', displayName: 'You', avatarUrl: '', chipBalance: 10000 };

function state(): GameState {
  return {
    gameId: 'g', instanceId: 'i', phase: 'flop',
    players: [
      { discordUserId: 'me', displayName: 'You', avatarUrl: '', seatIndex: 0, chipStack: 3000, betThisRound: 0, totalBetThisHand: 0, holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }], status: 'active', hasActed: false, lastAction: null },
      { discordUserId: 'b', displayName: 'Bandit', avatarUrl: '', seatIndex: 1, chipStack: 4200, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false, lastAction: 'call' },
    ],
    communityCards: [{ rank: 'A', suit: 'hearts' }, { rank: '10', suit: 'diamonds' }, { rank: '4', suit: 'clubs' }],
    pots: [{ amount: 1450, eligiblePlayerIds: ['me', 'b'] }],
    currentPlayerIndex: 0, dealerIndex: 0, smallBlindIndex: 0, bigBlindIndex: 1,
    callAmount: 0, minRaise: 50, handNumber: 7,
    config: { buyIn: 3000, smallBlind: 50, bigBlind: 100, maxPlayers: 9, turnSeconds: 30 },
    spectators: [], viewerBankroll: 10000,
  };
}

describe('TableScreen', () => {
  it('requests state on mount and renders seats + pot from an update', () => {
    const socket = fakeSocket();
    render(<TableScreen socket={socket as any} identity={identity} />);
    expect(socket.emit).toHaveBeenCalledWith('request_game_state');
    act(() => { socket.__ee.emit('game_state_update', state()); });
    expect(screen.getByText('Bandit')).toBeInTheDocument();
    expect(screen.getByText('1,450')).toBeInTheDocument();
    expect(screen.getByText(/Hand #7/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/client -- src/table/TableScreen.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `packages/client/src/table/TableScreen.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import type { DiscordIdentity, GameState, PlayerAction, LobbyPlayer } from '@poker/shared';
import type { ClientSocket } from '../socket';
import { TableHeader } from './TableHeader';
import { CenterCluster } from './CenterCluster';
import { Seat } from './Seat';
import { HeroHud } from './HeroHud';
import { TableActionBar } from './TableActionBar';
import { arrangeSeats, seatPositions } from './SeatLayout';
import { UserPopout, type SeatActions } from '../lobby/UserPopout';
import { PlayerProfileModal } from '../lobby/PlayerProfileModal';
import { useStats } from '../lobby/useStats';

const BETTING_PHASES: GameState['phase'][] = ['pre-flop', 'flop', 'turn', 'river'];

interface Props {
  socket: ClientSocket;
  identity: DiscordIdentity;
}

export function TableScreen({ socket, identity }: Props) {
  const viewerId = identity.discordUserId;
  const [view, setView] = useState<GameState | null>(null);
  const [timer, setTimer] = useState<{ playerId: string; remainingMs: number } | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { stats } = useStats(userOpen ? viewerId : null);

  useEffect(() => {
    const onState = (s: GameState) => setView(s);
    const onTimer = (p: { playerId: string; remainingMs: number }) => setTimer(p);
    const onResult = (p: { finalState: GameState }) => setView(p.finalState);
    socket.on('game_state_update', onState);
    socket.on('timer_tick', onTimer);
    socket.on('hand_result', onResult);
    socket.emit('request_game_state');
    return () => {
      socket.off('game_state_update', onState);
      socket.off('timer_tick', onTimer);
      socket.off('hand_result', onResult);
    };
  }, [socket]);

  const act = (a: PlayerAction) => socket.emit('player_action', a);

  const { hero, opponents, positions } = useMemo(() => {
    if (!view) return { hero: null, opponents: [], positions: [] as ReturnType<typeof seatPositions> };
    const seated = view.players.filter((p) => p.status !== 'sitting-out');
    const { hero, opponents } = arrangeSeats(seated, viewerId);
    return { hero, opponents, positions: seatPositions(opponents.length + 1) };
  }, [view, viewerId]);

  if (!view) {
    return <div className="flex h-screen w-full items-center justify-center bg-felt-900 text-sage-light">Dealing…</div>;
  }

  const me = view.players.find((p) => p.discordUserId === viewerId) ?? null;
  const isSpectating = me == null || me.status === 'sitting-out';
  const isMyTurn =
    BETTING_PHASES.includes(view.phase) &&
    me?.status === 'active' &&
    view.players[view.currentPlayerIndex]?.discordUserId === viewerId;

  const activeId = view.players[view.currentPlayerIndex]?.discordUserId ?? null;
  const timerPctFor = (id: string): number | null => {
    if (id !== activeId || !timer || timer.playerId !== id) return null;
    return Math.max(0, Math.min(100, (timer.remainingMs / (view.config.turnSeconds * 1000)) * 100));
  };
  const roleFor = (seatIndex: number): 'D' | 'SB' | 'BB' | null =>
    seatIndex === view.dealerIndex ? 'D'
      : seatIndex === view.smallBlindIndex ? 'SB'
      : seatIndex === view.bigBlindIndex ? 'BB' : null;

  const reveal = view.phase === 'showdown' || view.phase === 'hand-complete';
  const bank = view.viewerBankroll ?? identity.chipBalance;
  const seatFull = view.players.length >= view.config.maxPlayers;
  const underfunded = bank < view.config.buyIn;
  const canJoin = !seatFull && !underfunded;
  const joinReason = seatFull ? `The table is full (${view.config.maxPlayers} seats).`
    : underfunded ? `Not enough chips for the ${view.config.buyIn.toLocaleString()} buy-in.` : '';

  const seatActions: SeatActions = {
    mode: isSpectating ? 'spectating' : 'playing',
    buyIn: view.config.buyIn,
    canJoin,
    joinReason,
    pending: view.viewerPending === 'leave' ? 'leave' : view.viewerPending === 'spectate' ? 'spectate' : null,
    leaveHint: isSpectating ? 'Back to the lobby — any time' : 'After this hand finishes',
    onSpectate: () => { setUserOpen(false); socket.emit('sit_out'); },
    onJoin: () => { setUserOpen(false); socket.emit('sit_in'); },
    onLeave: () => { setUserOpen(false); socket.emit('leave_table'); },
    onCancelPending: () => socket.emit('cancel_pending'),
  };

  const selected = selectedId ? view.players.find((p) => p.discordUserId === selectedId) ?? null : null;

  return (
    <div className="felt-bg flex h-screen w-full flex-col overflow-hidden text-cream">
      <TableHeader
        identity={identity}
        handNumber={view.handNumber}
        config={view.config}
        spectators={view.spectators ?? []}
        heroStack={me?.chipStack ?? null}
        onOpenUser={() => setUserOpen(true)}
      />

      <main className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative" style={{ width: 'min(880px, calc(100vw - 240px))', height: 'min(440px, calc(100vh - 280px))' }}>
          <div className="absolute inset-0 rounded-[50%] border-[3px] border-[#0c0a05] bg-gradient-to-b from-[#3a2a12] to-[#1c1407] shadow-tablecard" />
          <div className="absolute inset-[14px] rounded-[50%] border-[3px] border-felt-900 bg-[radial-gradient(120%_120%_at_50%_38%,#1f7a55_0%,#156040_55%,#0c4730_100%)]" />
          <div className="absolute inset-[13%] rounded-[50%] border-2 border-dashed border-white/10" />

          {view.waitingForPlayers ? (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-pill border-[2.5px] border-gold-border bg-gold px-5 py-2 font-display text-sm font-semibold tracking-[0.16em] text-felt-900 shadow-hard-gold">
              WAITING FOR PLAYERS…
            </div>
          ) : (
            <CenterCluster phase={view.phase} community={view.communityCards} pots={view.pots} />
          )}

          {opponents.map((p, i) => (
            <Seat
              key={p.discordUserId}
              player={p}
              pos={positions[i + 1]}
              role={roleFor(p.seatIndex)}
              isActive={p.discordUserId === activeId && BETTING_PHASES.includes(view.phase)}
              timerPct={timerPctFor(p.discordUserId)}
              reveal={reveal}
              onOpen={() => setSelectedId(p.discordUserId)}
            />
          ))}
        </div>
      </main>

      <HeroHud
        me={isSpectating ? null : me}
        community={view.communityCards}
        bank={bank}
        isSpectating={isSpectating}
        isMyTurn={!!isMyTurn}
        turnSecondsLeft={isMyTurn && timer ? timer.remainingMs / 1000 : null}
      />

      <TableActionBar state={view} myId={viewerId} onAction={act} />

      {userOpen && (
        <UserPopout identity={{ ...identity, chipBalance: bank }} stats={stats} onClose={() => setUserOpen(false)} seat={seatActions} />
      )}

      {selected && (
        <PlayerProfileModal
          player={gamePlayerToLobby(selected)}
          tableRole="seated"
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/** Adapt a GamePlayer to the LobbyPlayer shape the reused modal expects. */
function gamePlayerToLobby(p: GameState['players'][number]): LobbyPlayer {
  return {
    discordUserId: p.discordUserId,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    chipBalance: p.chipStack,
    isReady: false,
    socketId: '',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/client -- src/table/TableScreen.test.tsx`
Expected: PASS. (If `useStats` performs a fetch, it is passed `null` until the popout opens; ensure no unhandled fetch — the test never opens the popout.)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/TableScreen.tsx packages/client/src/table/TableScreen.test.tsx
git commit -m "feat(client): TableScreen composition + socket wiring"
```

---

### Task 13: Swap App over to TableScreen and remove Phaser

**Files:**
- Modify: `packages/client/src/App.tsx` (render `TableScreen` instead of `GameCanvas`)
- Modify: `packages/client/src/App.test.tsx` (update expectation if it referenced the canvas)
- Delete: `packages/client/src/GameCanvas.tsx`, `packages/client/src/ActionBar.tsx`, `packages/client/src/SpectatorControls.tsx`, `packages/client/src/SpectatorControls.test.tsx`, `packages/client/src/game/TableScene.ts`, `packages/client/src/game/bridge.ts`, `packages/client/src/game/createGame.ts`
- Modify: `packages/client/package.json` (drop `phaser`)

**Interfaces:**
- Consumes: `TableScreen` (Task 12).

- [ ] **Step 1: Point App at TableScreen**

In `packages/client/src/App.tsx`, replace the import and the `atTable` branch:

```typescript
import { TableScreen } from './table/TableScreen';
```

```typescript
  if (atTable) {
    return <TableScreen socket={socketRef.current!} identity={status.identity} />;
  }
```

Remove the now-unused `import { GameCanvas } from './GameCanvas';`.

- [ ] **Step 2: Check the App test still describes reality**

Run: `npm run test --workspace=packages/client -- src/App.test.tsx`
Expected: PASS. If it fails because it asserted Phaser/canvas specifics, update those assertions to target the lobby/`TableScreen` text instead (e.g. the lobby renders on mount; the table renders after `joined_table`). Keep the test focused on routing, not rendering internals.

- [ ] **Step 3: Delete the Phaser renderer and old controls**

```bash
git rm packages/client/src/GameCanvas.tsx packages/client/src/ActionBar.tsx \
  packages/client/src/SpectatorControls.tsx packages/client/src/SpectatorControls.test.tsx \
  packages/client/src/game/TableScene.ts packages/client/src/game/bridge.ts packages/client/src/game/createGame.ts
```

- [ ] **Step 4: Drop the Phaser dependency**

Remove the `"phaser": "^3.88.2",` line from `packages/client/package.json` `dependencies`, then reinstall to update the lockfile:

Run: `npm install`
Expected: completes; `phaser` removed from `node_modules` / lockfile.

- [ ] **Step 5: Verify no stale references remain**

Run: `npm run test --workspace=packages/client && npm run build --workspace=packages/client`
Expected: PASS — type-check finds no remaining imports of the deleted files; all client tests green. (If the build reports an unused/empty `src/game/` directory, remove it.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): mount React TableScreen; remove Phaser renderer"
```

---

### Task 14: Update documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md` (client rendering section)
- Modify: `CLAUDE.md` (client layout line + conventions)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update ARCHITECTURE.md**

In `docs/ARCHITECTURE.md`, update the client/table description to state that the table is rendered as **React + Tailwind DOM** (Phaser removed), list the `table/` component folder (`TableScreen`, `TableHeader`, `Felt`/`CenterCluster`, `Seat`, `CommunityCards`→`CenterCluster`, `HeroHud`, `TableActionBar`, `SeatLayout`, `Card`, `useHandName`), and note the two supporting changes: `GamePlayer.lastAction` and the hand-evaluator living in `@poker/shared`. Add one line that showdown reveal uses the server's existing `viewFor()` card exposure, and that reveal-all-at-hand-end is a future phase.

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`:
- Change the client layout block (line ~28–32) from `React + Phaser 3` and `GameCanvas.tsx, game/` to: `React + Tailwind (the Activity iframe)` and add the `table/{TableScreen, TableHeader, CenterCluster, Seat, HeroHud, TableActionBar, Card, SeatLayout, useHandName}` folder; remove `GameCanvas.tsx` and `game/` from the tree.
- Update the "What this is" line "the table is a 2D cartoon canvas" → "the table is a 2D cartoon **DOM** scene (React + Tailwind)".
- Add a one-line convention note: "**Table view** — rendered as React/Tailwind DOM (no Phaser); seat geometry from `table/SeatLayout.ts`; the hero hand name is named client-side via the shared `describeBestHand`; `GamePlayer.lastAction` drives the per-seat action pill."

- [ ] **Step 3: Verify the whole suite and build**

Run: `npm test && npm run build`
Expected: PASS — server + client suites green; all three packages build.

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md CLAUDE.md
git commit -m "docs: table view is React/DOM (Phaser removed)"
```

---

## Self-Review

**1. Spec coverage**

- Renderer replacement (Phaser→DOM) → Tasks 12–13. ✓
- Reuse lobby `UserPopout` (+ seat actions) → Task 10; `PlayerProfileModal`/`useStats`/`StatTile` reused → Task 12. ✓
- Spectator eye + list → Task 11. ✓
- Seats evenly split, Discord avatars, hero bottom-center → Tasks 3, 6, 12. ✓
- Hole cards fan + showdown reveal → Tasks 5, 6 (reveal flag from Task 12); reveal-all deferred (noted). ✓
- Dealer/SB/BB badges → Task 6 (`roleFor` in Task 12). ✓
- Chips + action under seat → Task 6. ✓
- Community cards deal to position → Tasks 4, 7. ✓
- Pot + side pots → Task 7. ✓
- Bottom HUD (cards, table chips, bank, timer) → Task 8. ✓
- Action bar (quick raise, slider, actions) → Task 9. ✓
- Other players' turn timer ring → Tasks 6, 12 (`timerPct`). ✓
- `lastAction` server field → Task 1. ✓
- Shared hand-evaluator → Task 2. ✓
- Animations + reduced-motion → Task 4. ✓
- Docs → Task 14. ✓

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code and exact commands.

**3. Type consistency checks:**
- `SeatPos` fields (`leftPct/topPct/betLeftPct/betTopPct`) defined in Task 3, consumed identically in Tasks 6 & 12. ✓
- `arrangeSeats` returns `{ hero, opponents }`; `seatPositions(opponents.length + 1)` indexed `[i+1]` for opponents in Task 12 (slot 0 reserved for hero). ✓
- `SeatActions` shape defined in Task 10, constructed identically in Task 12. ✓
- `describeBestHand(cards): { name, category } | null` defined in Task 2, consumed in Task 5 (`useHandName`). ✓
- `GamePlayer.lastAction?: ActionType | null` defined in Task 1, consumed in Task 6 `actionPill`. ✓
- `PlayingCard` props (`card/size/rotate/reveal`) defined in Task 5, used consistently in Tasks 6–8. ✓
- `TableActionBar` / `HeroHud` / `TableHeader` / `CenterCluster` / `Seat` / `TableScreen` signatures match their consumers. ✓

No gaps found.
