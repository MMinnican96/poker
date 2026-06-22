# Sound Effects & Showdown Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add table sound effects (chips, knock, deal, fold, escalating suspense, win), player audio controls, and a clear, celebrated showdown (longer pause, winner banner, per-player hand labels, gold confetti from the winner).

**Architecture:** The server enriches the hand-end `GameState` with a per-viewer-safe `showdown` block and holds the reveal longer via a new `showdownMs` delay. The client gains a small Web Audio sound layer driven by diffing successive `game_state_update`s, an audio settings store backing the previously-stubbed Settings tab, and showdown UI (banner, seat hand labels, winner highlight, `canvas-confetti`).

**Tech Stack:** TypeScript monorepo (`@poker/shared`, `@poker/server`, `@poker/client`); Socket.io; React + Tailwind v4; Vitest + React Testing Library (jsdom); Web Audio API; `canvas-confetti`.

## Global Constraints

- Server is the authoritative source of truth; clients render received state and send intents. Opponents' hole cards stay nulled until reveal (`viewFor`).
- `@poker/shared` is ESM (NodeNext), built to `dist/`; the server consumes the **built** package. Keep `shared/src` to `.ts` only. After editing shared, it must be rebuilt (`npm run build` or the dev `build shared` step) before the server type-checks against it.
- Tests live next to source as `*.test.ts` / `*.test.tsx` (excluded from `tsc` builds). Run the whole suite with `npm test` from repo root; build with `npm run build`.
- Never hardcode hex values in client component files — use named Tailwind tokens from `packages/client/src/index.css` (`@theme`). Confetti colors (passed to a JS library, not Tailwind classes) are the one allowed exception and must be literal gold hex values.
- Web Audio and `canvas-confetti` do not exist in jsdom — all tests must mock or no-op them; production code must degrade gracefully when `AudioContext` is absent.
- Commit messages end with the repo trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

**Create:**
- `packages/client/public/audio/{bet,check,muck-deal,fold,suspense,win}.mp3` — served assets
- `packages/client/public/audio/CREDITS.md` — attribution for sourced CC0 files
- `packages/client/src/table/sound/soundStore.ts` — module-singleton audio settings (mute/volume) + `useSoundSettings`
- `packages/client/src/table/sound/SoundManager.ts` — Web Audio wrapper + `createSoundManager`
- `packages/client/src/table/sound/useTableSounds.ts` — state-diff → sound trigger hook + `rateForRaiseStep`
- `packages/client/src/table/showdown.ts` — pure `showdownBanner` helper
- `packages/client/src/table/ConfettiLayer.tsx` — gold confetti from winner seats
- Test files mirroring each of the above.

**Modify:**
- `packages/shared/src/types.ts` — add `ShownHand`, `ShowdownSummary`, `GameState.showdown`
- `packages/server/src/rooms/game.ts` — populate `showdown`; add `showdownMs`; `scheduleNextHand(delayMs?)`
- `packages/server/src/rooms/index.ts` — pass `gameTiming.showdownMs`
- `packages/server/src/rooms/game.test.ts` — showdown-block + timing tests
- `packages/client/src/lobby/UserPopout.tsx` — replace Settings "Coming Soon" with audio controls
- `packages/client/src/table/CenterCluster.tsx` — render winner banner
- `packages/client/src/table/Seat.tsx` — per-seat hand label + winner highlight + `data-seat-id`
- `packages/client/src/table/HeroToken.tsx` — winner highlight + `data-seat-id`
- `packages/client/src/table/TableScreen.tsx` — wire sound manager, settings sync, banner, labels, confetti
- `packages/client/package.json` — add `canvas-confetti` deps

---

## Task 1: Server showdown block + longer showdown delay

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/server/src/rooms/game.ts`
- Modify: `packages/server/src/rooms/index.ts`
- Test: `packages/server/src/rooms/game.test.ts`

**Interfaces:**
- Consumes: existing `resolveShowdown`/`settleHand` result (`ShowdownResult { awards, winningsByPlayer, hands: Record<string, HandRank> }`); `WonHandCategory` (already in shared).
- Produces:
  - `ShownHand { category: WonHandCategory; label: string }`
  - `ShowdownSummary { winnerIds: string[]; hands: Record<string, ShownHand> }`
  - `GameState.showdown?: ShowdownSummary | null`
  - `GameTiming.showdownMs?: number` (default 6500)

- [ ] **Step 1: Add the showdown types to shared**

In `packages/shared/src/types.ts`, immediately after the `GameState` interface (after line 102), add:

```ts
/** One player's revealed hand at showdown (shown players only). */
export interface ShownHand {
  category: WonHandCategory;
  label: string;
}

/** Showdown outcome attached to the hand-end state for the reveal UI. */
export interface ShowdownSummary {
  winnerIds: string[];
  /** Keyed by player id; contested/shown players only. Folded/uncontested absent. */
  hands: Record<string, ShownHand>;
}
```

Then add this field inside the `GameState` interface, just before its closing brace (after the `viewerBankroll` field, line 101):

```ts
  /** Present only at hand end (showdown / fold-out); drives the reveal UI. */
  showdown?: ShowdownSummary | null;
```

(`WonHandCategory` is already declared later in this same file; forward reference within a module is fine for types.)

- [ ] **Step 2: Rebuild shared so the server sees the new types**

Run: `npm run build --workspace @poker/shared`
Expected: builds with no errors; `packages/shared/dist/types.d.ts` now contains `ShowdownSummary`.

- [ ] **Step 3: Write the failing server tests**

In `packages/server/src/rooms/game.test.ts`, add these tests inside the top-level `describe('GameRoom', ...)` block (after the existing first test):

```ts
  it('attaches a showdown summary with winner ids and hand labels', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    const room = makeRoom(io, chips.service);
    await room.start();

    const result = io.waitFor('hand_result');
    room.handleAction('a', { type: 'all-in' });
    room.handleAction('b', { type: 'all-in' });
    const rec = await result;
    const { finalState } = rec.args[0] as { finalState: GameState };

    expect(finalState.showdown).toBeTruthy();
    expect(finalState.showdown!.winnerIds.length).toBeGreaterThanOrEqual(1);
    // Both players reached showdown, so both have a labelled hand.
    expect(Object.keys(finalState.showdown!.hands)).toHaveLength(2);
    for (const shown of Object.values(finalState.showdown!.hands)) {
      expect(typeof shown.label).toBe('string');
      expect(shown.label.length).toBeGreaterThan(0);
    }
  });

  it('attaches a fold-out showdown (winner, no shown hands) and uses showdownMs for the next deal', async () => {
    const io = makeFakeIo();
    const chips = makeFakeChips();
    // showdownMs tiny so the next hand deals quickly; handDelayMs stays huge.
    const room = makeRoom(io, chips.service, { showdownMs: 25 });
    await room.start();

    const firstResult = io.waitFor('hand_result');
    room.handleAction('a', { type: 'fold' }); // heads-up button folds → b wins blinds
    const rec = await firstResult;
    const { finalState } = rec.args[0] as { finalState: GameState };

    expect(finalState.showdown).toBeTruthy();
    expect(finalState.showdown!.winnerIds).toEqual(['b']);
    expect(Object.keys(finalState.showdown!.hands)).toHaveLength(0);

    // Nobody busted on a fold-out, so a second hand must deal — driven by the
    // 25ms showdownMs, NOT the 1e9 handDelayMs.
    await new Promise((r) => setTimeout(r, 90));
    const dealtHand2 = io.records.some(
      (r) =>
        r.event === 'game_state_update' &&
        (r.args[0] as GameState).handNumber === 2 &&
        (r.args[0] as GameState).phase !== 'waiting',
    );
    expect(dealtHand2).toBe(true);

    room.stop();
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test --workspace @poker/server -- game.test.ts`
Expected: FAIL — `finalState.showdown` is `undefined`, and the second hand does not deal (still using the huge `handDelayMs`).

- [ ] **Step 5: Implement the server changes**

In `packages/server/src/rooms/game.ts`:

(a) Extend the type import (the `@poker/shared` import block, lines 2-13) to include `ShowdownSummary` and `WonHandCategory`:

```ts
import type {
  ActiveGameSummary,
  ClientToServerEvents,
  GameState,
  InterServerEvents,
  PlayerAction,
  PlayerHandStat,
  ServerToClientEvents,
  ShowdownSummary,
  SocketData,
  TableConfig,
  TableMember,
  WonHandCategory,
} from '@poker/shared';
```

(b) Add `showdownMs` to `GameTiming` (after the `handDelayMs` field, line 72):

```ts
  /** Pause AFTER a settled hand so the reveal/celebration is readable. */
  showdownMs?: number;
```

(c) Add the field + default. Add a field declaration next to `handDelayMs` (after line 130):

```ts
  private readonly showdownMs: number;
```

and in the constructor after the `handDelayMs` assignment (after line 163):

```ts
    this.showdownMs = opts.timing?.showdownMs ?? 6_500;
```

(d) Build and attach the showdown summary in `concludeHand`. Replace the `hand_result` emit block (lines 396-404) with:

```ts
    const potAmount = result.awards.reduce((sum, a) => sum + a.amount, 0);
    const winnerIds = [...new Set(result.awards.flatMap((a) => a.winnerIds))];
    const handName = result.hands[winnerIds[0]]?.name;
    const showdown: ShowdownSummary = {
      winnerIds,
      hands: Object.fromEntries(
        Object.entries(result.hands).map(([id, r]) => [
          id,
          { category: r.category as WonHandCategory, label: r.name },
        ]),
      ),
    };
    this.io.to(this.instanceId).emit('hand_result', {
      winnerIds,
      potAmount,
      handName,
      finalState: { ...viewFor(state, null), showdown },
    });
```

(e) Use `showdownMs` for the post-hand schedule. At the end of `concludeHand` (line 420), change:

```ts
    this.scheduleNextHand();
```

to:

```ts
    this.scheduleNextHand(this.showdownMs);
```

(f) Make `scheduleNextHand` accept an optional delay. Change its signature (line 423) and the final `setTimeout` (line 439):

```ts
  private scheduleNextHand(delayMs: number = this.handDelayMs): void {
```

```ts
    this.nextHandTimeout = setTimeout(() => this.startHand(), delayMs);
```

- [ ] **Step 6: Wire showdownMs in production**

In `packages/server/src/rooms/index.ts`, the `timing` passed to `new GameRoom` (line 62) currently is:

```ts
        timing: { ...options.gameTiming, turnMs: options.gameTiming?.turnMs ?? config.turnSeconds * 1000 },
```

Leave this line as-is — it already spreads `options.gameTiming`, so `showdownMs` flows through when provided. No change needed here; the default (6500) applies because `registerSocketHandlers(io, { chips, stats })` in `index.ts` (server entry) passes no `gameTiming`. Confirm by reading the line; make no edit.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace @poker/server -- game.test.ts`
Expected: PASS (all GameRoom tests, including the two new ones).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types.ts packages/server/src/rooms/game.ts packages/server/src/rooms/game.test.ts
git commit -m "feat(server): attach showdown summary and longer showdown delay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Audio assets

**Files:**
- Create: `packages/client/public/audio/bet.mp3`, `check.mp3`, `muck-deal.mp3`, `fold.mp3`, `suspense.mp3`, `win.mp3`
- Create: `packages/client/public/audio/CREDITS.md`

**Interfaces:**
- Produces: six MP3 files at stable web paths `/audio/<name>.mp3`, consumed by `SoundManager` (Task 4).

- [ ] **Step 1: Move and rename the existing clips into the client public dir**

```bash
mkdir -p packages/client/public/audio
cp "audio/bet.mp3" packages/client/public/audio/bet.mp3
cp "audio/check.mp3" packages/client/public/audio/check.mp3
cp "audio/Muck Cards Deal.mp3" packages/client/public/audio/muck-deal.mp3
```

(Keep the originals in repo-root `audio/` as the source of truth; the client serves copies from `public/`.)

- [ ] **Step 2: Source the three new CC0 clips**

Obtain short royalty-free / CC0 clips and save them as:
- `packages/client/public/audio/fold.mp3` — a soft card-slide / muck (distinct from the deal sound).
- `packages/client/public/audio/suspense.mp3` — a short tense sting (≈0.5–1.5s) that sounds natural when pitch-shifted upward.
- `packages/client/public/audio/win.mp3` — a brief celebratory chime/fanfare (≈1–2s).

Use a known CC0 source (e.g. freesound.org CC0 filter, mixkit free SFX, or kenney.nl audio packs). Keep each file small (< ~60KB) to match the existing clips. Verify each plays and is mono/stereo MP3.

- [ ] **Step 3: Record attribution**

Create `packages/client/public/audio/CREDITS.md`:

```markdown
# Audio Credits

| File | Description | Source / License |
|---|---|---|
| bet.mp3 | Chips bet/raise | Project-supplied |
| check.mp3 | Knock (check) | Project-supplied |
| muck-deal.mp3 | Community cards deal | Project-supplied |
| fold.mp3 | Card muck (fold) | <source URL> — CC0 |
| suspense.mp3 | Tension sting (consecutive raise) | <source URL> — CC0 |
| win.mp3 | Win fanfare | <source URL> — CC0 |

All sourced clips are CC0 / public domain or otherwise license-free for redistribution.
```

Replace `<source URL>` with the actual URLs used.

- [ ] **Step 4: Verify the files are in place**

Run: `ls -1 packages/client/public/audio`
Expected: `CREDITS.md`, `bet.mp3`, `check.mp3`, `fold.mp3`, `muck-deal.mp3`, `suspense.mp3`, `win.mp3`.

- [ ] **Step 5: Commit**

```bash
git add packages/client/public/audio
git commit -m "feat(client): add table sound effect assets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Audio settings store (mute + volume)

**Files:**
- Create: `packages/client/src/table/sound/soundStore.ts`
- Test: `packages/client/src/table/sound/soundStore.test.ts`

**Interfaces:**
- Produces:
  - `interface SoundSettings { muted: boolean; volume: number }`
  - `const DEFAULT_SOUND_SETTINGS: SoundSettings` (`{ muted: false, volume: 0.7 }`)
  - `function getSoundSettings(): SoundSettings`
  - `function setMuted(muted: boolean): void`
  - `function setVolume(volume: number): void` (clamps to [0, 1])
  - `function subscribeSoundSettings(cb: () => void): () => void`
  - `function useSoundSettings(): SoundSettings & { setMuted: (m: boolean) => void; setVolume: (v: number) => void }`
- Consumed by: `UserPopout` (Task 6) and `TableScreen` (Task 10).

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/table/sound/soundStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  DEFAULT_SOUND_SETTINGS,
  getSoundSettings,
  setMuted,
  setVolume,
  useSoundSettings,
} from './soundStore';

beforeEach(() => {
  localStorage.clear();
  // Reset to defaults between tests.
  setMuted(DEFAULT_SOUND_SETTINGS.muted);
  setVolume(DEFAULT_SOUND_SETTINGS.volume);
});

describe('soundStore', () => {
  it('defaults to unmuted at 0.7 volume', () => {
    localStorage.clear();
    expect(getSoundSettings().muted).toBe(false);
    expect(getSoundSettings().volume).toBeCloseTo(0.7);
  });

  it('persists mute + volume to localStorage and clamps volume to [0,1]', () => {
    setMuted(true);
    setVolume(1.5);
    expect(getSoundSettings().muted).toBe(true);
    expect(getSoundSettings().volume).toBe(1);
    setVolume(-3);
    expect(getSoundSettings().volume).toBe(0);
    const raw = JSON.parse(localStorage.getItem('poker.sound')!);
    expect(raw.muted).toBe(true);
    expect(raw.volume).toBe(0);
  });

  it('useSoundSettings re-renders subscribers on change', () => {
    const { result } = renderHook(() => useSoundSettings());
    expect(result.current.muted).toBe(false);
    act(() => result.current.setMuted(true));
    expect(result.current.muted).toBe(true);
    act(() => result.current.setVolume(0.3));
    expect(result.current.volume).toBeCloseTo(0.3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @poker/client -- soundStore`
Expected: FAIL — module `./soundStore` not found.

- [ ] **Step 3: Implement the store**

Create `packages/client/src/table/sound/soundStore.ts`:

```ts
import { useSyncExternalStore } from 'react';

export interface SoundSettings {
  muted: boolean;
  volume: number; // 0..1
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { muted: false, volume: 0.7 };

const KEY = 'poker.sound';

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function load(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SOUND_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SOUND_SETTINGS.muted,
      volume: typeof parsed.volume === 'number' ? clamp01(parsed.volume) : DEFAULT_SOUND_SETTINGS.volume,
    };
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
}

let current: SoundSettings = load();
const listeners = new Set<() => void>();

function persistAndNotify(next: SoundSettings): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore quota / unavailable storage */
  }
  for (const cb of listeners) cb();
}

export function getSoundSettings(): SoundSettings {
  return current;
}

export function setMuted(muted: boolean): void {
  persistAndNotify({ ...current, muted });
}

export function setVolume(volume: number): void {
  persistAndNotify({ ...current, volume: clamp01(volume) });
}

export function subscribeSoundSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSoundSettings() {
  const settings = useSyncExternalStore(subscribeSoundSettings, getSoundSettings, getSoundSettings);
  return { ...settings, setMuted, setVolume };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @poker/client -- soundStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/sound/soundStore.ts packages/client/src/table/sound/soundStore.test.ts
git commit -m "feat(client): add persistent audio settings store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: SoundManager (Web Audio wrapper)

**Files:**
- Create: `packages/client/src/table/sound/SoundManager.ts`
- Test: `packages/client/src/table/sound/SoundManager.test.ts`

**Interfaces:**
- Consumes: `SoundSettings` from `./soundStore`.
- Produces:
  - `type SoundName = 'bet' | 'check' | 'deal' | 'fold' | 'suspense' | 'win'`
  - `interface SoundManager { unlock(): void; setSettings(s: SoundSettings): void; play(name: SoundName, opts?: { rate?: number }): void }`
  - `function createSoundManager(): SoundManager`
- Consumed by: `useTableSounds` (Task 5), `TableScreen` (Task 10).

Note: This is a thin imperative wrapper over the Web Audio API, which jsdom lacks. Production code must no-op safely when `AudioContext` is unavailable. Tests cover the jsdom-safe behavior only; real playback is verified manually in a browser.

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/table/sound/SoundManager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSoundManager } from './SoundManager';

describe('SoundManager (jsdom, no AudioContext)', () => {
  it('constructs and no-ops without throwing when Web Audio is unavailable', () => {
    const m = createSoundManager();
    m.setSettings({ muted: false, volume: 0.5 });
    expect(() => m.unlock()).not.toThrow();
    expect(() => m.play('bet')).not.toThrow();
    expect(() => m.play('suspense', { rate: 1.2 })).not.toThrow();
  });

  it('does not throw when muted', () => {
    const m = createSoundManager();
    m.setSettings({ muted: true, volume: 0.5 });
    expect(() => m.play('win')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @poker/client -- SoundManager`
Expected: FAIL — module `./SoundManager` not found.

- [ ] **Step 3: Implement the manager**

Create `packages/client/src/table/sound/SoundManager.ts`:

```ts
import type { SoundSettings } from './soundStore';
import { DEFAULT_SOUND_SETTINGS } from './soundStore';

export type SoundName = 'bet' | 'check' | 'deal' | 'fold' | 'suspense' | 'win';

const FILES: Record<SoundName, string> = {
  bet: '/audio/bet.mp3',
  check: '/audio/check.mp3',
  deal: '/audio/muck-deal.mp3',
  fold: '/audio/fold.mp3',
  suspense: '/audio/suspense.mp3',
  win: '/audio/win.mp3',
};

export interface SoundManager {
  /** Resume the AudioContext after a user gesture (browser autoplay policy). */
  unlock(): void;
  setSettings(s: SoundSettings): void;
  play(name: SoundName, opts?: { rate?: number }): void;
}

type Ctx = AudioContext;

function getAudioContextCtor(): (new () => Ctx) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createSoundManager(): SoundManager {
  let ctx: Ctx | null = null;
  let settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };
  const buffers = new Map<SoundName, AudioBuffer>();
  const loading = new Map<SoundName, Promise<AudioBuffer | null>>();

  function ensureCtx(): Ctx | null {
    if (ctx) return ctx;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  async function loadBuffer(name: SoundName): Promise<AudioBuffer | null> {
    const c = ensureCtx();
    if (!c) return null;
    if (buffers.has(name)) return buffers.get(name)!;
    if (loading.has(name)) return loading.get(name)!;
    const p = (async () => {
      try {
        const res = await fetch(FILES[name]);
        const arr = await res.arrayBuffer();
        const buf = await c.decodeAudioData(arr);
        buffers.set(name, buf);
        return buf;
      } catch {
        return null;
      } finally {
        loading.delete(name);
      }
    })();
    loading.set(name, p);
    return p;
  }

  return {
    unlock() {
      const c = ensureCtx();
      if (c && c.state === 'suspended') void c.resume();
    },
    setSettings(s: SoundSettings) {
      settings = s;
    },
    play(name: SoundName, opts?: { rate?: number }) {
      if (settings.muted || settings.volume <= 0) return;
      const c = ensureCtx();
      if (!c) return;
      void loadBuffer(name).then((buf) => {
        if (!buf) return;
        const source = c.createBufferSource();
        source.buffer = buf;
        if (opts?.rate && opts.rate > 0) source.playbackRate.value = opts.rate;
        const gain = c.createGain();
        gain.gain.value = settings.volume;
        source.connect(gain).connect(c.destination);
        source.start();
      });
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @poker/client -- SoundManager`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/sound/SoundManager.ts packages/client/src/table/sound/SoundManager.test.ts
git commit -m "feat(client): add Web Audio sound manager

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: useTableSounds (state-diff sound triggers)

**Files:**
- Create: `packages/client/src/table/sound/useTableSounds.ts`
- Test: `packages/client/src/table/sound/useTableSounds.test.ts`

**Interfaces:**
- Consumes: `GameState` from `@poker/shared`; `SoundManager`, `SoundName` from `./SoundManager`.
- Produces:
  - `function rateForRaiseStep(step: number): number` (step 1 → 1.0; +0.07/step; capped 1.6)
  - `function useTableSounds(view: GameState | null, manager: SoundManager): void`
- Consumed by: `TableScreen` (Task 10).

Trigger rules (diff current vs previous view):
- First view or `handNumber` change → reset raise counter, no sounds.
- `view.showdown` newly present (prev had none) → play `win`, then return (skip deal/action diffing to avoid the cardless-waiting→reveal rebroadcast replaying deal/bet sounds).
- `communityCards.length` increased → play `deal`.
- A player's `lastAction` changed to a truthy value:
  - `raise` / `all-in` → `bet` + `suspense` at `rateForRaiseStep(++step)`.
  - `call` → `bet`, reset step to 0.
  - `check` → `check`, reset step to 0.
  - `fold` → `fold` (step unchanged).

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/table/sound/useTableSounds.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { GameState, ActionType } from '@poker/shared';
import { rateForRaiseStep, useTableSounds } from './useTableSounds';
import type { SoundManager, SoundName } from './SoundManager';

function fakeManager() {
  const calls: { name: SoundName; rate?: number }[] = [];
  const manager: SoundManager = {
    unlock: vi.fn(),
    setSettings: vi.fn(),
    play: (name, opts) => calls.push({ name, rate: opts?.rate }),
  };
  return { manager, calls };
}

function base(): GameState {
  return {
    gameId: 'g', instanceId: 'i', phase: 'pre-flop',
    players: [
      { discordUserId: 'a', displayName: 'A', avatarUrl: '', seatIndex: 0, chipStack: 3000, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false, lastAction: null },
      { discordUserId: 'b', displayName: 'B', avatarUrl: '', seatIndex: 1, chipStack: 3000, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false, lastAction: null },
    ],
    communityCards: [],
    pots: [{ amount: 0, eligiblePlayerIds: ['a', 'b'] }],
    currentPlayerIndex: 0, dealerIndex: 0, smallBlindIndex: 0, bigBlindIndex: 1,
    callAmount: 0, minRaise: 50, handNumber: 1,
    config: { buyIn: 3000, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 },
  };
}

function withAction(s: GameState, id: string, action: ActionType): GameState {
  return {
    ...s,
    players: s.players.map((p) => (p.discordUserId === id ? { ...p, lastAction: action } : p)),
  };
}

describe('rateForRaiseStep', () => {
  it('starts at 1.0 and climbs, capped at 1.6', () => {
    expect(rateForRaiseStep(1)).toBeCloseTo(1.0);
    expect(rateForRaiseStep(2)).toBeCloseTo(1.07);
    expect(rateForRaiseStep(3)).toBeCloseTo(1.14);
    expect(rateForRaiseStep(50)).toBe(1.6);
  });
});

describe('useTableSounds', () => {
  let fm: ReturnType<typeof fakeManager>;
  beforeEach(() => { fm = fakeManager(); });

  function run(views: (GameState | null)[]) {
    const { rerender } = renderHook(({ v }) => useTableSounds(v, fm.manager), {
      initialProps: { v: views[0] },
    });
    for (const v of views.slice(1)) rerender({ v });
  }

  it('plays no sound for the first view', () => {
    run([base()]);
    expect(fm.calls).toHaveLength(0);
  });

  it('plays the deal sound when community cards appear', () => {
    const flop = { ...base(), phase: 'flop' as const, communityCards: [
      { rank: '2', suit: 'clubs' as const }, { rank: '7', suit: 'hearts' as const }, { rank: 'K', suit: 'spades' as const },
    ] };
    run([base(), flop]);
    expect(fm.calls.map((c) => c.name)).toContain('deal');
  });

  it('escalates suspense pitch on consecutive raises and resets on call', () => {
    const s0 = base();
    const s1 = withAction(s0, 'a', 'raise');
    const s2 = withAction(s1, 'b', 'raise');
    const s3 = withAction(s2, 'a', 'call'); // resets
    const s4 = withAction({ ...s3, players: s3.players.map((p) => ({ ...p, lastAction: null })) }, 'b', 'raise');
    run([s0, s1, s2, s3, s4]);

    const suspense = fm.calls.filter((c) => c.name === 'suspense');
    expect(suspense.length).toBe(3);
    expect(suspense[0].rate).toBeCloseTo(1.0); // first raise
    expect(suspense[1].rate).toBeCloseTo(1.07); // second consecutive raise
    expect(suspense[2].rate).toBeCloseTo(1.0); // after a call → reset
    expect(fm.calls.filter((c) => c.name === 'bet').length).toBe(3); // 2 raises + 1 call
  });

  it('plays check and fold sounds', () => {
    const s0 = base();
    run([s0, withAction(s0, 'a', 'check')]);
    expect(fm.calls.map((c) => c.name)).toContain('check');
    fm.calls.length = 0;
    run([s0, withAction(s0, 'b', 'fold')]);
    expect(fm.calls.map((c) => c.name)).toContain('fold');
  });

  it('plays the win sound once when showdown appears, without replaying deal/bet', () => {
    const river = { ...base(), phase: 'river' as const, communityCards: [
      { rank: '2', suit: 'clubs' as const }, { rank: '7', suit: 'hearts' as const }, { rank: 'K', suit: 'spades' as const },
      { rank: '9', suit: 'diamonds' as const }, { rank: 'J', suit: 'clubs' as const },
    ], players: base().players.map((p) => ({ ...p, lastAction: 'check' as const })) };
    // Cardless waiting rebroadcast, then the revealed showdown finalState.
    const waiting = { ...base(), phase: 'waiting' as const, communityCards: [], players: base().players.map((p) => ({ ...p, lastAction: null })) };
    const final = { ...river, phase: 'hand-complete' as const, showdown: { winnerIds: ['a'], hands: { a: { category: 'pair' as const, label: 'Pair' } } } };
    run([river, waiting, final]);
    expect(fm.calls.filter((c) => c.name === 'win')).toHaveLength(1);
    expect(fm.calls.map((c) => c.name)).not.toContain('deal');
  });

  it('resets the raise counter on a new hand', () => {
    const s0 = base();
    const s1 = withAction(s0, 'a', 'raise');
    const hand2 = { ...base(), handNumber: 2 };
    const s2 = withAction(hand2, 'a', 'raise');
    run([s0, s1, hand2, s2]);
    const suspense = fm.calls.filter((c) => c.name === 'suspense');
    expect(suspense[suspense.length - 1].rate).toBeCloseTo(1.0); // fresh hand → base pitch
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @poker/client -- useTableSounds`
Expected: FAIL — module `./useTableSounds` not found.

- [ ] **Step 3: Implement the hook**

Create `packages/client/src/table/sound/useTableSounds.ts`:

```ts
import { useEffect, useRef } from 'react';
import type { GameState, ActionType } from '@poker/shared';
import type { SoundManager } from './SoundManager';

const STEP = 0.07;
const MAX_RATE = 1.6;

/** Playback rate for the Nth consecutive raise (step 1 = base pitch). */
export function rateForRaiseStep(step: number): number {
  if (step <= 1) return 1.0;
  return Math.min(1.0 + (step - 1) * STEP, MAX_RATE);
}

function lastActionOf(view: GameState, id: string): ActionType | null | undefined {
  return view.players.find((p) => p.discordUserId === id)?.lastAction;
}

export function useTableSounds(view: GameState | null, manager: SoundManager): void {
  const prevRef = useRef<GameState | null>(null);
  const raiseStep = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = view;
    if (!view) return;

    // First view or a brand-new hand: reset, stay silent.
    if (!prev || view.handNumber !== prev.handNumber) {
      raiseStep.current = 0;
      return;
    }

    // Showdown just resolved: celebrate, and skip diffing so the cardless
    // waiting→reveal rebroadcast doesn't replay deal/bet sounds.
    if (view.showdown && !prev.showdown) {
      manager.play('win');
      return;
    }

    // Community cards revealed (flop/turn/river).
    if (view.communityCards.length > prev.communityCards.length) {
      manager.play('deal');
    }

    // A single player's action this diff (one engine action = one broadcast).
    for (const p of view.players) {
      const before = lastActionOf(prev, p.discordUserId);
      const now = p.lastAction;
      if (!now || now === before) continue;
      switch (now) {
        case 'raise':
        case 'all-in':
          manager.play('bet');
          raiseStep.current += 1;
          manager.play('suspense', { rate: rateForRaiseStep(raiseStep.current) });
          break;
        case 'call':
          manager.play('bet');
          raiseStep.current = 0;
          break;
        case 'check':
          manager.play('check');
          raiseStep.current = 0;
          break;
        case 'fold':
          manager.play('fold');
          break;
      }
    }
  }, [view, manager]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @poker/client -- useTableSounds`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/table/sound/useTableSounds.ts packages/client/src/table/sound/useTableSounds.test.ts
git commit -m "feat(client): trigger table sounds from game state diffs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Audio controls in the Settings tab

**Files:**
- Modify: `packages/client/src/lobby/UserPopout.tsx:86-93`
- Test: `packages/client/src/lobby/UserPopout.test.tsx`

**Interfaces:**
- Consumes: `useSoundSettings` from `../table/sound/soundStore`.
- Produces: no new exported API — the Settings tab now renders a mute toggle + volume slider that drive the shared store. No prop changes to `UserPopout` (it reads the store directly), so existing call sites in `LobbyScreen` and `TableScreen` are unaffected.

- [ ] **Step 1: Write the failing test**

Add to `packages/client/src/lobby/UserPopout.test.tsx` (append a new test; keep existing imports, add `fireEvent` if not present and the store import). At the top, ensure these imports exist:

```ts
import { render, screen, fireEvent } from '@testing-library/react';
import { getSoundSettings, setMuted, setVolume, DEFAULT_SOUND_SETTINGS } from '../table/sound/soundStore';
```

Then add:

```ts
describe('UserPopout — audio settings', () => {
  beforeEach(() => {
    localStorage.clear();
    setMuted(DEFAULT_SOUND_SETTINGS.muted);
    setVolume(DEFAULT_SOUND_SETTINGS.volume);
  });

  const identity = { discordUserId: 'u', displayName: 'U', avatarUrl: '', chipBalance: 100 };

  it('renders volume + mute controls in Settings and updates the store', () => {
    render(<UserPopout identity={identity} stats={null} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    const slider = screen.getByLabelText(/volume/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.4' } });
    expect(getSoundSettings().volume).toBeCloseTo(0.4);

    const mute = screen.getByRole('button', { name: /mute/i });
    fireEvent.click(mute);
    expect(getSoundSettings().muted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @poker/client -- UserPopout`
Expected: FAIL — Settings tab still shows "COMING SOON"; no volume control / mute button.

- [ ] **Step 3: Implement the Settings panel**

In `packages/client/src/lobby/UserPopout.tsx`:

(a) Add the import near the top (after line 2):

```ts
import { useSoundSettings } from '../table/sound/soundStore';
```

(b) Inside the component, after `const [tab, setTab] = useState<UserTab>('profile');` (line 35), add:

```ts
  const sound = useSoundSettings();
```

(c) Replace the entire `settings` tab block (lines 86-93) with:

```tsx
          {tab === 'settings' && (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold tracking-[0.12em] text-sage">SOUND VOLUME</span>
                  <span className="font-display text-sm font-bold text-gold-soft">{Math.round(sound.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={sound.volume}
                  aria-label="Sound volume"
                  onChange={(e) => sound.setVolume(Number(e.target.value))}
                  className="w-full accent-gold"
                />
              </div>
              <button
                onClick={() => sound.setMuted(!sound.muted)}
                aria-label={sound.muted ? 'Unmute sound' : 'Mute sound'}
                className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3.5 py-3 text-left font-display text-base font-semibold ${sound.muted ? 'border-red/40 bg-red/15 text-white' : 'border-black/30 bg-felt-600 text-white hover:bg-felt-700'}`}
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] border-2 border-black/30 bg-black/15 text-[17px]">
                  {sound.muted ? '🔇' : '🔊'}
                </span>
                <span className="flex flex-col leading-tight">
                  <span>{sound.muted ? 'Sound muted' : 'Sound on'}</span>
                  <span className="text-xs font-bold text-sage-muted">Tap to {sound.muted ? 'unmute' : 'mute'} table sounds</span>
                </span>
              </button>
            </div>
          )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace @poker/client -- UserPopout`
Expected: PASS (existing UserPopout tests still pass too).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lobby/UserPopout.tsx packages/client/src/lobby/UserPopout.test.tsx
git commit -m "feat(client): add audio controls to the Settings tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Showdown winner banner

**Files:**
- Create: `packages/client/src/table/showdown.ts`
- Create: `packages/client/src/table/showdown.test.ts`
- Modify: `packages/client/src/table/CenterCluster.tsx`
- Test: `packages/client/src/table/CenterCluster.test.tsx`

**Interfaces:**
- Consumes: `ShowdownSummary` from `@poker/shared`; `GamePlayer` from `@poker/shared`.
- Produces:
  - `function showdownBanner(showdown: ShowdownSummary | null | undefined, players: GamePlayer[]): string | null`
  - `CenterCluster` gains an optional prop `banner?: string | null`.

- [ ] **Step 1: Write the failing helper test**

Create `packages/client/src/table/showdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GamePlayer, ShowdownSummary } from '@poker/shared';
import { showdownBanner } from './showdown';

function player(id: string, name: string): GamePlayer {
  return { discordUserId: id, displayName: name, avatarUrl: '', seatIndex: 0, chipStack: 0, betThisRound: 0, totalBetThisHand: 0, holeCards: null, status: 'active', hasActed: false, lastAction: null };
}
const players = [player('a', 'Alice'), player('b', 'Bob')];

describe('showdownBanner', () => {
  it('returns null without a showdown', () => {
    expect(showdownBanner(null, players)).toBeNull();
    expect(showdownBanner(undefined, players)).toBeNull();
  });

  it('names a single winner with their hand label', () => {
    const sd: ShowdownSummary = { winnerIds: ['a'], hands: { a: { category: 'flush', label: 'Flush' }, b: { category: 'pair', label: 'Pair' } } };
    expect(showdownBanner(sd, players)).toBe('Alice wins with a Flush');
  });

  it('names a fold-out winner without a hand label', () => {
    const sd: ShowdownSummary = { winnerIds: ['b'], hands: {} };
    expect(showdownBanner(sd, players)).toBe('Bob wins the pot');
  });

  it('describes a split pot', () => {
    const sd: ShowdownSummary = { winnerIds: ['a', 'b'], hands: { a: { category: 'straight', label: 'Straight' }, b: { category: 'straight', label: 'Straight' } } };
    expect(showdownBanner(sd, players)).toBe('Split pot — Alice & Bob · Straight');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @poker/client -- showdown`
Expected: FAIL — module `./showdown` not found.

- [ ] **Step 3: Implement the helper**

Create `packages/client/src/table/showdown.ts`:

```ts
import type { GamePlayer, ShowdownSummary } from '@poker/shared';

/** Human-readable showdown banner, or null when there is no showdown. */
export function showdownBanner(
  showdown: ShowdownSummary | null | undefined,
  players: GamePlayer[],
): string | null {
  if (!showdown || showdown.winnerIds.length === 0) return null;
  const nameOf = (id: string) => players.find((p) => p.discordUserId === id)?.displayName ?? 'Player';
  const names = showdown.winnerIds.map(nameOf);
  const label = showdown.hands[showdown.winnerIds[0]]?.label ?? null;

  if (names.length === 1) {
    return label ? `${names[0]} wins with a ${label}` : `${names[0]} wins the pot`;
  }
  const joined = names.join(' & ');
  return label ? `Split pot — ${joined} · ${label}` : `Split pot — ${joined}`;
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `npm test --workspace @poker/client -- showdown`
Expected: PASS.

- [ ] **Step 5: Write the failing CenterCluster test**

Add to `packages/client/src/table/CenterCluster.test.tsx`:

```ts
  it('renders a winner banner when provided', () => {
    render(<CenterCluster phase="hand-complete" community={board} pots={[{ amount: 100, eligiblePlayerIds: ['a'] }]} banner="Alice wins with a Flush" />);
    expect(screen.getByText('Alice wins with a Flush')).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test --workspace @poker/client -- CenterCluster`
Expected: FAIL — `banner` is not a prop; text not rendered.

- [ ] **Step 7: Add the banner to CenterCluster**

In `packages/client/src/table/CenterCluster.tsx`:

(a) Extend `Props` (lines 9-13):

```tsx
interface Props {
  phase: GamePhase;
  community: Card[];
  pots: Pot[];
  banner?: string | null;
}
```

(b) Update the signature (line 15):

```tsx
export function CenterCluster({ phase, community, pots, banner }: Props) {
```

(c) Render the banner. Immediately after the phase-label pill `</div>` (after line 23), add:

```tsx
      {banner && (
        <div className="inline-flex items-center gap-2 rounded-pill border-[2.5px] border-gold-border bg-felt-900/85 px-4 py-1.5 font-display text-sm font-bold tracking-[0.04em] text-gold-soft shadow-hard-gold animate-pop">
          🏆 {banner}
        </div>
      )}
```

- [ ] **Step 8: Run the CenterCluster test to verify it passes**

Run: `npm test --workspace @poker/client -- CenterCluster`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/table/showdown.ts packages/client/src/table/showdown.test.ts packages/client/src/table/CenterCluster.tsx packages/client/src/table/CenterCluster.test.tsx
git commit -m "feat(client): show a winner banner at showdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Per-seat hand labels + winner highlight

**Files:**
- Modify: `packages/client/src/table/Seat.tsx`
- Modify: `packages/client/src/table/HeroToken.tsx`
- Test: `packages/client/src/table/Seat.test.tsx`

**Interfaces:**
- Produces:
  - `Seat` gains optional props `handLabel?: string | null` and `isWinner?: boolean`, and a `data-seat-id` attribute on its root.
  - `HeroToken` gains optional prop `isWinner?: boolean` and a `data-seat-id` attribute.
- Consumed by: `TableScreen` (Task 10), `ConfettiLayer` (Task 9, via `data-seat-id`).

First read `packages/client/src/table/HeroToken.tsx` to find its root element and the prop it already receives for the hero's id (it receives `player`); add `data-seat-id={player?.discordUserId}` to its outermost element and an `isWinner` prop.

- [ ] **Step 1: Write the failing Seat test**

Add to `packages/client/src/table/Seat.test.tsx` (reuse the file's existing `player`/`pos` test fixtures; if none, define inline as below):

```ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Seat } from './Seat';
import type { GamePlayer } from '@poker/shared';

const pos = { leftPct: 50, topPct: 10, betLeftPct: 50, betTopPct: 30 };
function p(over: Partial<GamePlayer> = {}): GamePlayer {
  return { discordUserId: 'b', displayName: 'Bandit', avatarUrl: '', seatIndex: 1, chipStack: 1000, betThisRound: 0, totalBetThisHand: 0, holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }], status: 'active', hasActed: false, lastAction: null, ...over };
}

describe('Seat — showdown', () => {
  it('shows the hand label under revealed cards', () => {
    render(<Seat player={p()} pos={pos} role={null} isActive={false} timerPct={null} reveal handLabel="Two Pair" isWinner={false} onOpen={() => {}} />);
    expect(screen.getByText('Two Pair')).toBeInTheDocument();
  });

  it('marks the root with the seat id and a winner flag', () => {
    const { container } = render(<Seat player={p()} pos={pos} role={null} isActive={false} timerPct={null} reveal handLabel={null} isWinner onOpen={() => {}} />);
    const root = container.querySelector('[data-seat-id="b"]');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('data-winner', 'true');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @poker/client -- Seat`
Expected: FAIL — `handLabel`/`isWinner` not props; no `data-seat-id`/`data-winner`.

- [ ] **Step 3: Update Seat**

In `packages/client/src/table/Seat.tsx`:

(a) Extend `Props` (lines 6-14):

```tsx
interface Props {
  player: GamePlayer;
  pos: SeatPos;
  role: 'D' | 'SB' | 'BB' | null;
  isActive: boolean;
  timerPct: number | null;
  reveal: boolean;
  handLabel?: string | null;
  isWinner?: boolean;
  onOpen: () => void;
}
```

(b) Update the signature (line 16):

```tsx
export function Seat({ player, pos, role, isActive, timerPct, reveal, handLabel, isWinner, onOpen }: Props) {
```

(c) Add `data-seat-id` + `data-winner` and a winner ring to the positioned root `<div>` (lines 25-28). Replace it with:

```tsx
      <div
        data-seat-id={player.discordUserId}
        data-winner={isWinner ? 'true' : undefined}
        className={`absolute z-[4] flex w-[106px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 ${isWinner ? 'rounded-2xl ring-4 ring-gold animate-pulse' : ''}`}
        style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%`, opacity: folded ? 0.45 : 1 }}
      >
```

(d) Render the hand label. Immediately after the action-pill block (after line 68, the `{pill && (...)}`), add:

```tsx
        {reveal && handLabel && (
          <span className="rounded-pill border-2 border-gold-border bg-felt-900/85 px-2.5 py-0.5 text-[11px] font-extrabold text-gold-soft">{handLabel}</span>
        )}
```

- [ ] **Step 4: Update HeroToken**

In `packages/client/src/table/HeroToken.tsx`, add an `isWinner?: boolean` prop to its `Props` interface and destructure it in the signature, then add `data-seat-id={player?.discordUserId}`, `data-winner={isWinner ? 'true' : undefined}`, and (when `isWinner`) the `ring-4 ring-gold animate-pulse` classes to its outermost element — mirroring the Seat change above. (Read the file first to match its exact root element and existing className.)

- [ ] **Step 5: Run the Seat test to verify it passes**

Run: `npm test --workspace @poker/client -- Seat`
Expected: PASS (existing Seat/HeroToken tests still pass).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/table/Seat.tsx packages/client/src/table/HeroToken.tsx packages/client/src/table/Seat.test.tsx
git commit -m "feat(client): label revealed hands and highlight the winner seat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Confetti celebration layer

**Files:**
- Modify: `packages/client/package.json`
- Create: `packages/client/src/table/ConfettiLayer.tsx`
- Test: `packages/client/src/table/ConfettiLayer.test.tsx`

**Interfaces:**
- Consumes: `canvas-confetti` (mocked in tests); DOM `[data-seat-id]` elements rendered by Seat/HeroToken (Task 8).
- Produces: `ConfettiLayer({ winnerIds }: { winnerIds: string[] })` — a fixed, pointer-events-none layer that fires a gold burst from each winner's seat element when `winnerIds` changes.
- Consumed by: `TableScreen` (Task 10).

- [ ] **Step 1: Add the dependency**

Run: `npm install canvas-confetti --workspace @poker/client && npm install -D @types/canvas-confetti --workspace @poker/client`
Expected: `canvas-confetti` appears in `packages/client/package.json` dependencies and `@types/canvas-confetti` in devDependencies.

- [ ] **Step 2: Write the failing test**

Create `packages/client/src/table/ConfettiLayer.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConfettiLayer } from './ConfettiLayer';

const confettiMock = vi.fn();
vi.mock('canvas-confetti', () => ({ default: (...args: unknown[]) => confettiMock(...args) }));

describe('ConfettiLayer', () => {
  beforeEach(() => confettiMock.mockClear());

  it('fires a gold burst for each winner when winnerIds change', () => {
    // A winner seat element must exist in the DOM for origin lookup.
    const seat = document.createElement('div');
    seat.setAttribute('data-seat-id', 'a');
    document.body.appendChild(seat);

    const { rerender } = render(<ConfettiLayer winnerIds={[]} />);
    expect(confettiMock).not.toHaveBeenCalled();

    rerender(<ConfettiLayer winnerIds={['a']} />);
    expect(confettiMock).toHaveBeenCalledTimes(1);
    const opts = confettiMock.mock.calls[0][0];
    expect(opts).toHaveProperty('origin');
    expect(Array.isArray(opts.colors)).toBe(true);

    document.body.removeChild(seat);
  });

  it('does not re-fire for the same winnerIds', () => {
    const { rerender } = render(<ConfettiLayer winnerIds={['a']} />);
    const count = confettiMock.mock.calls.length;
    rerender(<ConfettiLayer winnerIds={['a']} />);
    expect(confettiMock.mock.calls.length).toBe(count);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --workspace @poker/client -- ConfettiLayer`
Expected: FAIL — module `./ConfettiLayer` not found.

- [ ] **Step 4: Implement the layer**

Create `packages/client/src/table/ConfettiLayer.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';

const GOLD = ['#ffc63d', '#ffd56b', '#e0a200', '#fff1c2'];

interface Props {
  winnerIds: string[];
}

/** Fires a gold confetti burst from each winner's seat element on win. */
export function ConfettiLayer({ winnerIds }: Props) {
  const lastKey = useRef<string>('');

  useEffect(() => {
    const key = winnerIds.join(',');
    if (!key || key === lastKey.current) return;
    lastKey.current = key;

    for (const id of winnerIds) {
      const el = document.querySelector(`[data-seat-id="${id}"]`);
      let origin = { x: 0.5, y: 0.5 };
      if (el) {
        const r = el.getBoundingClientRect();
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        origin = { x: (r.left + r.width / 2) / w, y: (r.top + r.height / 2) / h };
      }
      confetti({
        particleCount: 90,
        spread: 70,
        startVelocity: 38,
        gravity: 0.9,
        scalar: 0.9,
        colors: GOLD,
        origin,
      });
    }
  }, [winnerIds]);

  return <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden />;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace @poker/client -- ConfettiLayer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/package.json package-lock.json packages/client/src/table/ConfettiLayer.tsx packages/client/src/table/ConfettiLayer.test.tsx
git commit -m "feat(client): gold confetti burst from the winner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Wire it all into TableScreen

**Files:**
- Modify: `packages/client/src/table/TableScreen.tsx`
- Test: `packages/client/src/table/TableScreen.test.tsx`

**Interfaces:**
- Consumes: `createSoundManager` (Task 4), `useSoundSettings` (Task 3), `useTableSounds` (Task 5), `showdownBanner` (Task 7), `ConfettiLayer` (Task 9); `Seat`/`HeroToken` new props (Task 8).
- Produces: a fully wired table — sounds play on action diffs, the AudioContext unlocks on the first action, settings drive volume/mute, the winner banner + seat labels + confetti show at showdown.

- [ ] **Step 1: Write the failing integration test**

Add to `packages/client/src/table/TableScreen.test.tsx`. At the top, mock `canvas-confetti` so jsdom is safe:

```ts
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
```

Then add a test that drives a showdown via `hand_result`:

```ts
  it('shows the winner banner and opponent hand label at showdown', () => {
    const socket = fakeSocket();
    render(<TableScreen socket={socket as any} identity={identity} />);
    act(() => { socket.__ee.emit('game_state_update', state()); });

    const final: GameState = {
      ...state(),
      phase: 'hand-complete',
      players: state().players.map((p) =>
        p.discordUserId === 'b'
          ? { ...p, holeCards: [{ rank: 'Q', suit: 'hearts' }, { rank: 'Q', suit: 'clubs' }] }
          : p,
      ),
      showdown: {
        winnerIds: ['b'],
        hands: {
          b: { category: 'pair', label: 'Pair' },
          me: { category: 'high-card', label: 'High Card' },
        },
      },
    };
    act(() => { socket.__ee.emit('hand_result', { winnerIds: ['b'], potAmount: 1450, finalState: final }); });

    expect(screen.getByText(/Bandit wins with a Pair/)).toBeInTheDocument();
    expect(screen.getByText('Pair')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @poker/client -- TableScreen`
Expected: FAIL — no banner / no hand label rendered.

- [ ] **Step 3: Wire TableScreen**

In `packages/client/src/table/TableScreen.tsx`:

(a) Add imports (after line 13):

```ts
import { createSoundManager } from './sound/SoundManager';
import { useSoundSettings } from './sound/soundStore';
import { useTableSounds } from './sound/useTableSounds';
import { showdownBanner } from './showdown';
import { ConfettiLayer } from './ConfettiLayer';
```

(b) Inside the component, after the existing `useState` declarations (after line 27), set up the sound manager + settings:

```ts
  const managerRef = useRef(createSoundManager());
  const soundSettings = useSoundSettings();
  useEffect(() => {
    managerRef.current.setSettings({ muted: soundSettings.muted, volume: soundSettings.volume });
  }, [soundSettings.muted, soundSettings.volume]);
  useTableSounds(view, managerRef.current);
```

Add `useRef` to the React import on line 1:

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
```

(c) Unlock audio on the first action. Change `act` (line 46) to:

```ts
  const act = (a: PlayerAction) => {
    managerRef.current.unlock();
    socket.emit('player_action', a);
  };
```

(d) Compute the banner. After `const reveal = ...` (line 76), add:

```ts
  const banner = showdownBanner(view.showdown, view.players);
  const winnerIds = view.showdown?.winnerIds ?? [];
```

(e) Pass `banner` to `CenterCluster` (line 121):

```tsx
            <CenterCluster phase={view.phase} community={view.communityCards} pots={view.pots} banner={banner} />
```

(f) Pass `handLabel` + `isWinner` to each opponent `Seat` (lines 124-135). Update the `<Seat ... />` props to include:

```tsx
              handLabel={view.showdown?.hands[p.discordUserId]?.label ?? null}
              isWinner={winnerIds.includes(p.discordUserId)}
```

(g) Pass `isWinner` to `HeroToken` (lines 138-144), adding:

```tsx
              isWinner={winnerIds.includes(viewerId)}
```

(h) Mount `ConfettiLayer`. Just before the final closing `</div>` of the component's returned tree (after the `PlayerProfileModal` block, around line 170), add:

```tsx
      <ConfettiLayer winnerIds={winnerIds} />
```

- [ ] **Step 4: Run the TableScreen test to verify it passes**

Run: `npm test --workspace @poker/client -- TableScreen`
Expected: PASS.

- [ ] **Step 5: Run the full client suite**

Run: `npm test --workspace @poker/client`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/table/TableScreen.tsx packages/client/src/table/TableScreen.test.tsx
git commit -m "feat(client): wire sounds, winner banner, labels and confetti into the table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (Status + table-view conventions)
- Modify: `docs/ARCHITECTURE.md` (showdown reveal + client sound layer) — read it first to place the additions correctly.

- [ ] **Step 1: Run the entire suite and the build**

Run: `npm test`
Expected: PASS — server + client.

Run: `npm run build`
Expected: all three packages type-check and build with no errors.

- [ ] **Step 2: Manual smoke (dev mock mode)**

Run: `npm run dev`, open `http://localhost:5173/?mock=1&name=Alice` and `...&name=Bob` in two tabs. Verify: chip sound on bet/call/raise/all-in; knock on check; deal sound on flop/turn/river; fold sound on fold; suspense pitch rising across consecutive raises and resetting after a call/check; ~6.5s showdown with winner banner, opponent hand labels, and gold confetti from the winner; mute + volume in the Settings tab persist across reload. (Browsers require a first click to unlock audio — the first action does this.)

- [ ] **Step 3: Update documentation**

In `CLAUDE.md`:
- Under **Status**, append a sentence noting the table now has a sound-effects layer, audio settings (first live Settings feature), and a celebrated showdown (longer reveal, winner banner, per-player hand labels, gold confetti).
- Under the **Table view** convention bullet, add: sounds live in `table/sound/` (`SoundManager`, `useTableSounds`, `soundStore`); the showdown reveal is driven by `GameState.showdown` (set in `GameRoom.concludeHand`) and held for `GameTiming.showdownMs` (~6.5s); confetti via `ConfettiLayer` using `canvas-confetti`.

In `docs/ARCHITECTURE.md`, add a short subsection describing the `showdown` block on `GameState`, the `showdownMs` delay, and the client sound layer (state-diff triggers, escalation, settings store).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs: document sound effects and showdown polish

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** §1 assets → Task 2; §2 sound engine → Tasks 4 (manager) + 5 (triggers/escalation); §3 settings → Tasks 3 (store) + 6 (UI); §4 showdown clarity (data) → Task 1; §5 timing → Task 1 (`showdownMs`); §6 showdown UI → Tasks 7 (banner) + 8 (labels/highlight); §7 confetti → Task 9; §8 testing → woven through each task + Task 11. Chip-on-call and full fold-out celebration decisions are encoded in Task 5 (call plays `bet`) and Tasks 1/9 (fold-out gets a `showdown` block with a winner → banner + confetti).
- **Type consistency:** `ShowdownSummary`/`ShownHand`/`GameState.showdown` defined in Task 1 and consumed unchanged in Tasks 5, 7, 10. `SoundName` defined in Task 4, used in Tasks 4/5. `SoundSettings` defined in Task 3, used in Tasks 4/6/10. `data-seat-id` produced in Task 8, consumed in Task 9. `showdownBanner` signature defined in Task 7, called in Task 10.
- **Escalation:** `rateForRaiseStep` step 1 → 1.0, +0.07/step, capped 1.6 — consistent between the helper (Task 5 impl) and its test.
- **No placeholders:** every code step contains complete code; CC0 source URLs in Task 2 are the only intentional fill-ins (the actual files/URLs depend on what's sourced at implementation time).
