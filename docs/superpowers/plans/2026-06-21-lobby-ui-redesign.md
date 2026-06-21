# Lobby UI Redesign (Ratbag Poker Night) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client lobby with the "Ratbag Poker Night" design — a Tailwind-styled, multi-panel lobby (header nav, players list, table settings, user popout, player modal, Coming-Soon tabs) wired to existing backend state, plus a host-configurable turn timer and a design-standards doc.

**Architecture:** A new `packages/client/src/lobby/` folder decomposes the screen into focused components driven by `LobbyScreen` (which owns the socket subscription and UI state). Styling moves to Tailwind v4 with a design-token `@theme`. The only backend change is adding `turnSeconds` to `TableConfig` and threading it into the game's turn timer.

**Tech Stack:** React 18, TypeScript, Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`), Socket.io, Vitest + React Testing Library (new for the client), Node/Express server.

## Global Constraints

- **Server is authoritative.** The client only renders lobby state and emits intents; never trust client-side identity or invent state. (CLAUDE.md)
- **`@poker/shared` is ESM (NodeNext)**; the client consumes it via the Vite alias to `../shared/src/index.ts`. Keep shared types in `.ts` only.
- **Mock-mode detection** must match `discord.ts`: `import.meta.env.DEV && (URL has ?mock OR VITE_MOCK_DISCORD === '1')`.
- **Host gating for config edits:** allowed only when `isHost && lobby.status === 'waiting' && readyCount === 0` (mirrors `lobby.ts#updateConfig`).
- **Turn timer:** `turnSeconds` default `30`, valid range `10–120`, step `5`; non-multiples-of-5 rejected by `sanitizeConfig`.
- **Blinds preset ladder:** `[[10,20],[25,50],[25,100],[50,100],[100,200],[200,400]]`; default index is `[25,50]` (matches `DEFAULT_TABLE_CONFIG`).
- **Avatars** use the Discord `avatarUrl` (`<img>`), never initials.
- **Fonts:** display = Fredoka, body = Nunito.
- **Verification gate:** `npm test` and `npm run build` (from repo root) must both pass before the feature is complete.
- **Commits:** frequent, one per task step group; we are on branch `feat/lobby-ui-redesign`.

---

## File Structure

**Create:**
- `packages/client/src/index.css` — Tailwind import + `@theme` tokens + keyframes + base/scrollbar.
- `packages/client/vitest.config.ts` — jsdom test config.
- `packages/client/src/test-setup.ts` — jest-dom matchers.
- `packages/client/src/lobby/LobbyScreen.tsx` — top-level container.
- `packages/client/src/lobby/Header.tsx`
- `packages/client/src/lobby/PlayersPanel.tsx`
- `packages/client/src/lobby/PlayerRow.tsx` (exports `playerStatus`, `STATUS_STYLE`)
- `packages/client/src/lobby/TableSettings.tsx` (exports `BLIND_LADDER`, `currentBlindIndex`)
- `packages/client/src/lobby/ComingSoon.tsx`
- `packages/client/src/lobby/RecentActivity.tsx`
- `packages/client/src/lobby/UserPopout.tsx`
- `packages/client/src/lobby/PlayerProfileModal.tsx`
- `packages/client/src/lobby/StatTile.tsx`
- `packages/client/src/lobby/useStats.ts` (exports `useStats`, `sampleStats`, `fetchStats`)
- `packages/client/src/lobby/*.test.tsx` / `.test.ts` for tested units.
- `docs/DESIGN_STANDARDS.md`

**Modify:**
- `packages/shared/src/types.ts` — add `turnSeconds` to `TableConfig` + default.
- `packages/server/src/rooms/lobby.ts` — `sanitizeConfig` accepts `turnSeconds`.
- `packages/server/src/rooms/index.ts` — thread `turnSeconds` into `GameRoom` timing.
- `packages/server/src/rooms/lobby.test.ts` — `turnSeconds` cases.
- `packages/client/package.json` — Tailwind + test deps + `test` script.
- `packages/client/vite.config.ts` — add `@tailwindcss/vite` plugin.
- `packages/client/index.html` — Google Fonts links.
- `packages/client/src/main.tsx` — `import './index.css'`.
- `packages/client/src/App.tsx` — render `<LobbyScreen>`.
- `package.json` (root) — `test` runs server + client.
- `CLAUDE.md`, `docs/ARCHITECTURE.md` — document the redesign.

**Delete:**
- `packages/client/src/Lobby.tsx`

---

## Task 1: Tailwind v4 setup + design tokens

**Files:**
- Modify: `packages/client/package.json`
- Modify: `packages/client/vite.config.ts`
- Modify: `packages/client/index.html`
- Create: `packages/client/src/index.css`
- Modify: `packages/client/src/main.tsx`

**Interfaces:**
- Produces: Tailwind utilities `bg-felt-{900..300}`, `bg-ink`, `text-gold`/`bg-gold`/`border-gold-border`, `text-mint`/`bg-mint`/`border-mint-border`, `text-blue`/`bg-blue`, `text-red`/`bg-red`/`border-red-border`, `text-cream`, `text-sage`/`text-sage-light`/`text-sage-muted`, `font-display`, `font-body`, `shadow-hard-ink`/`shadow-hard-ink-sm`/`shadow-hard-gold`/`shadow-hard-gold-lg`/`shadow-hard-red`/`shadow-pill`/`shadow-panel`/`shadow-card`/`shadow-tablecard`/`shadow-modal`/`shadow-popout`, `rounded-pill`, `animate-pop`/`animate-fade`, the `rail:` breakpoint variant, and the `.felt-bg` component class.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install -w @poker/client tailwindcss@^4 @tailwindcss/vite@^4
```
Expected: packages added to `packages/client/package.json` dependencies.

- [ ] **Step 2: Add the Tailwind Vite plugin**

In `packages/client/vite.config.ts`, add the import and plugin:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@poker/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true, changeOrigin: true },
    },
    allowedHosts: ['.trycloudflare.com'],
  },
});
```

- [ ] **Step 3: Add Google Fonts to `index.html`**

In `packages/client/index.html`, add inside `<head>` (after the viewport meta):
```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800;900&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 4: Create `packages/client/src/index.css`**

```css
@import "tailwindcss";

@theme {
  /* Fonts */
  --font-display: "Fredoka", system-ui, sans-serif;
  --font-body: "Nunito", system-ui, sans-serif;

  /* Felt + panels */
  --color-felt-900: #0b2c1f;
  --color-felt-800: #0e3325;
  --color-felt-700: #134632;
  --color-felt-600: #163f2e;
  --color-felt-500: #1c4836;
  --color-felt-400: #1d6044;
  --color-felt-300: #2c5d48;
  --color-ink: #0c2418;

  /* Gold */
  --color-gold: #ffc63d;
  --color-gold-border: #c8920d;
  --color-gold-shadow: #ad7a04;
  --color-gold-soft: #ffd882;

  /* Accents */
  --color-mint: #44e0a3;
  --color-mint-bright: #7df0c4;
  --color-mint-border: #1e9e6e;
  --color-blue: #5bb8ff;
  --color-blue-border: #2e86c8;
  --color-red: #ff6b6b;
  --color-red-border: #d63d3d;
  --color-red-shadow: #b32e2e;
  --color-purple: #b07bff;

  /* Text */
  --color-cream: #f4f1e8;
  --color-sage: #7fb89c;
  --color-sage-light: #9ed7bd;
  --color-sage-muted: #8fbfa8;

  /* Radii */
  --radius-pill: 999px;

  /* Shadows */
  --shadow-hard-ink: 0 4px 0 #0c2418;
  --shadow-hard-ink-sm: 0 3px 0 #0c2418;
  --shadow-hard-gold: 0 4px 0 #ad7a04;
  --shadow-hard-gold-lg: 0 6px 0 #ad7a04;
  --shadow-hard-red: 0 4px 0 #b32e2e;
  --shadow-pill: 0 5px 0 #061710;
  --shadow-panel: 0 16px 36px rgba(0, 0, 0, 0.35), inset 0 2px 0 rgba(255, 255, 255, 0.04);
  --shadow-card: 0 6px 0 rgba(0, 0, 0, 0.22);
  --shadow-tablecard: 0 20px 44px rgba(0, 0, 0, 0.42), inset 0 2px 0 rgba(255, 255, 255, 0.06);
  --shadow-modal: 0 26px 60px rgba(0, 0, 0, 0.55), inset 0 2px 0 rgba(255, 255, 255, 0.06);
  --shadow-popout: 0 22px 50px rgba(0, 0, 0, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.06);

  /* Breakpoint that hides the right rail (matches mock @1080px) */
  --breakpoint-rail: 1080px;

  /* Animations */
  --animate-pop: rpn-pop 0.18s cubic-bezier(0.2, 1.2, 0.4, 1);
  --animate-fade: rpn-fade 0.15s ease;
}

@keyframes rpn-pop {
  0% { transform: scale(0.92) translateY(6px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}
@keyframes rpn-fade {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

@layer base {
  html, body, #root { margin: 0; height: 100%; }
  body { font-family: var(--font-body); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.28);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  ::-webkit-scrollbar-track { background: transparent; }
}

@layer components {
  .felt-bg {
    background: radial-gradient(120% 90% at 50% -10%, #1d6044 0%, #134632 42%, #0b2c1f 100%);
  }
}
```

- [ ] **Step 5: Import the stylesheet in `main.tsx`**

In `packages/client/src/main.tsx`, add as the first import:
```ts
import './index.css';
```

- [ ] **Step 6: Verify the build compiles**

Run:
```bash
npm run build -w @poker/client
```
Expected: PASS (tsc + vite build succeed; Tailwind compiles `index.css`). Note: the existing `Lobby.tsx`/`App.tsx` are untouched and still build.

- [ ] **Step 7: Commit**

```bash
git add packages/client/package.json packages/client/vite.config.ts packages/client/index.html packages/client/src/index.css packages/client/src/main.tsx package-lock.json
git commit -m "build(client): add Tailwind v4 + design tokens and fonts"
```

---

## Task 2: Backend — host-configurable turn timer

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/server/src/rooms/lobby.ts:224-235` (`sanitizeConfig`)
- Modify: `packages/server/src/rooms/index.ts:46-68` (GameRoom construction)
- Test: `packages/server/src/rooms/lobby.test.ts`

**Interfaces:**
- Produces: `TableConfig.turnSeconds: number`; `DEFAULT_TABLE_CONFIG.turnSeconds = 30`; `sanitizeConfig` passes through valid `turnSeconds`.

- [ ] **Step 1: Add `turnSeconds` to the shared type + default**

In `packages/shared/src/types.ts`, update `TableConfig` and `DEFAULT_TABLE_CONFIG`:
```ts
export interface TableConfig {
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  maxPlayers: number;
  /** Seconds a player has to act before auto-fold/check. Host-configurable. */
  turnSeconds: number;
}

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  buyIn: 3000,
  smallBlind: 25,
  bigBlind: 50,
  maxPlayers: 9,
  turnSeconds: 30,
};
```

- [ ] **Step 2: Write the failing test for `sanitizeConfig` via `updateConfig`**

`sanitizeConfig` is module-private, so test it through `LobbyRoom.updateConfig` + `toState().config`. Add to `packages/server/src/rooms/lobby.test.ts` (follow the existing test setup/helpers in that file for creating a room with a fake io and adding a host socket):
```ts
it('accepts a valid turnSeconds from the host', () => {
  const { room, hostSocketId } = makeRoomWithHost(); // existing helper pattern
  room.updateConfig(hostSocketId, { turnSeconds: 45 });
  expect(room.toState().config.turnSeconds).toBe(45);
});

it('rejects out-of-range or non-step turnSeconds', () => {
  const { room, hostSocketId } = makeRoomWithHost();
  room.updateConfig(hostSocketId, { turnSeconds: 5 });    // below min
  room.updateConfig(hostSocketId, { turnSeconds: 200 });  // above max
  room.updateConfig(hostSocketId, { turnSeconds: 33 });   // not a multiple of 5
  expect(room.toState().config.turnSeconds).toBe(30);     // unchanged default
});
```
If `lobby.test.ts` has no reusable host-room helper, construct the room inline the same way the existing tests do (create `new LobbyRoom(...)` with the file's fake io, `addPlayer` a host identity, capture its socket id).

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
npm run test -w @poker/server -- lobby
```
Expected: FAIL — `turnSeconds` is currently dropped by `sanitizeConfig` (stays 30 in the accept case).

- [ ] **Step 4: Implement `sanitizeConfig` support**

In `packages/server/src/rooms/lobby.ts`, extend `sanitizeConfig`:
```ts
function sanitizeConfig(patch: Partial<TableConfig>): Partial<TableConfig> {
  const out: Partial<TableConfig> = {};
  if (isPositiveInt(patch.buyIn)) out.buyIn = patch.buyIn;
  if (isPositiveInt(patch.smallBlind)) out.smallBlind = patch.smallBlind;
  if (isPositiveInt(patch.bigBlind)) out.bigBlind = patch.bigBlind;
  if (isPositiveInt(patch.maxPlayers)) out.maxPlayers = Math.min(patch.maxPlayers, 9);
  if (isValidTurnSeconds(patch.turnSeconds)) out.turnSeconds = patch.turnSeconds;
  return out;
}

function isValidTurnSeconds(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= 10 &&
    n <= 120 &&
    n % 5 === 0
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
npm run test -w @poker/server -- lobby
```
Expected: PASS.

- [ ] **Step 6: Thread `turnSeconds` into the GameRoom timer**

In `packages/server/src/rooms/index.ts`, change the `GameRoom` construction in `onGameStart` so the configured value drives the turn timer while still letting tests inject timing:
```ts
const config = room.toState().config;
const game = new GameRoom({
  io,
  gameId,
  instanceId: room.instanceId,
  config,
  players: players.map((p) => ({
    discordUserId: p.discordUserId,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    socketId: p.socketId,
  })),
  chips: options.chips,
  stats: options.stats,
  timing: { ...options.gameTiming, turnMs: options.gameTiming?.turnMs ?? config.turnSeconds * 1000 },
  onEnd: (id) => {
    if (games.get(room.instanceId)?.gameId === id) games.delete(room.instanceId);
  },
});
```

- [ ] **Step 7: Run the full server suite + build**

Run:
```bash
npm run test -w @poker/server && npm run build -w @poker/shared && npm run build -w @poker/server
```
Expected: PASS. (Builds confirm no other `TableConfig` literal omits `turnSeconds`; if `engine` or tests construct a `TableConfig` literal, add `turnSeconds`. `DEFAULT_TABLE_CONFIG` spreads cover most.)

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types.ts packages/server/src/rooms/lobby.ts packages/server/src/rooms/index.ts packages/server/src/rooms/lobby.test.ts
git commit -m "feat(lobby): add host-configurable turnSeconds to TableConfig"
```

---

## Task 3: Client test tooling + `StatTile` + `useStats`

**Files:**
- Modify: `packages/client/package.json`
- Create: `packages/client/vitest.config.ts`
- Create: `packages/client/src/test-setup.ts`
- Modify: `package.json` (root `test` script)
- Create: `packages/client/src/lobby/StatTile.tsx`
- Create: `packages/client/src/lobby/StatTile.test.tsx`
- Create: `packages/client/src/lobby/useStats.ts`
- Create: `packages/client/src/lobby/useStats.test.ts`

**Interfaces:**
- Produces:
  - `StatTile(props: { label: string; value: string | null; accent?: string })` → renders `—` when `value` is null.
  - `sampleStats(playerId: string): PlayerStatsSummary` — deterministic.
  - `fetchStats(playerId: string): Promise<PlayerStatsSummary | null>` — null on non-OK/empty/throw.
  - `useStats(playerId: string | null): { stats: PlayerStatsSummary | null; loading: boolean }`.

- [ ] **Step 1: Install client test deps**

Run:
```bash
npm install -w @poker/client -D vitest@^3 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/dom@^10 jsdom@^25
```

- [ ] **Step 2: Add the Vitest config + setup file**

Create `packages/client/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@poker/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
```

Create `packages/client/src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Add the client `test` script + wire root `test`**

In `packages/client/package.json` `scripts`, add:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```
In root `package.json`, change `test` to run both:
```json
    "test": "npm run test --workspace=packages/server && npm run test --workspace=packages/client",
```

- [ ] **Step 4: Write the failing `StatTile` test**

Create `packages/client/src/lobby/StatTile.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { StatTile } from './StatTile';

describe('StatTile', () => {
  it('renders the value and label', () => {
    render(<StatTile label="WIN RATE" value="58%" />);
    expect(screen.getByText('58%')).toBeInTheDocument();
    expect(screen.getByText('WIN RATE')).toBeInTheDocument();
  });

  it('renders an em-dash when value is null', () => {
    render(<StatTile label="HANDS WON" value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run:
```bash
npm run test -w @poker/client -- StatTile
```
Expected: FAIL — `StatTile` not found.

- [ ] **Step 6: Implement `StatTile`**

Create `packages/client/src/lobby/StatTile.tsx`:
```tsx
export interface StatTileProps {
  label: string;
  value: string | null;
  accent?: string;
}

export function StatTile({ label, value, accent }: StatTileProps) {
  return (
    <div className="rounded-2xl border-2 border-black/30 bg-felt-600 p-4">
      <div
        className="font-display text-2xl font-bold text-cream"
        style={accent ? { color: accent } : undefined}
      >
        {value ?? '—'}
      </div>
      <div className="mt-1 text-[11px] font-extrabold tracking-[0.08em] text-sage">{label}</div>
    </div>
  );
}
```

- [ ] **Step 7: Run StatTile test to confirm pass**

Run:
```bash
npm run test -w @poker/client -- StatTile
```
Expected: PASS.

- [ ] **Step 8: Write the failing `useStats` tests**

Create `packages/client/src/lobby/useStats.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStats, sampleStats } from './useStats';

afterEach(() => vi.restoreAllMocks());

describe('sampleStats', () => {
  it('is deterministic for a given playerId', () => {
    expect(sampleStats('alice')).toEqual(sampleStats('alice'));
  });
  it('differs across playerIds', () => {
    expect(sampleStats('alice').handsWon).not.toBe(sampleStats('bob').handsWon);
  });
  it('produces a coherent summary', () => {
    const s = sampleStats('alice');
    expect(s.handsWon).toBeLessThanOrEqual(s.handsPlayed);
    expect(s.winRate).toBeGreaterThanOrEqual(0);
    expect(s.winRate).toBeLessThanOrEqual(1);
  });
});

describe('fetchStats', () => {
  it('returns parsed data on a 200', async () => {
    const body = { playerId: 'x', handsWon: 5 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));
    expect(await fetchStats('x')).toEqual(body);
  });
  it('returns null on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(null) }));
    expect(await fetchStats('x')).toBeNull();
  });
  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await fetchStats('x')).toBeNull();
  });
});
```

- [ ] **Step 9: Run it to confirm it fails**

Run:
```bash
npm run test -w @poker/client -- useStats
```
Expected: FAIL — module not found.

- [ ] **Step 10: Implement `useStats`**

Create `packages/client/src/lobby/useStats.ts`:
```ts
import { useEffect, useState } from 'react';
import type { PlayerStatsSummary } from '@poker/shared';

function isMockMode(): boolean {
  if (!import.meta.env.DEV) return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('mock') || import.meta.env.VITE_MOCK_DISCORD === '1';
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic, plausible stats for local mock mode (no DB/session). */
export function sampleStats(playerId: string): PlayerStatsSummary {
  const h = hash(playerId);
  const handsPlayed = 200 + (h % 4600);
  const winRate = 0.35 + ((h >> 3) % 30) / 100; // 0.35–0.65
  const handsWon = Math.round(handsPlayed * winRate);
  const handsLost = handsPlayed - handsWon;
  const biggestPotWon = 2000 + (h % 30) * 1000;
  const chipsWon = handsWon * (300 + (h % 200));
  const chipsLost = handsLost * (200 + ((h >> 5) % 200));
  const showdownsSeen = Math.round(handsPlayed * 0.4);
  const showdownsWon = Math.round(showdownsSeen * winRate);
  const aggressiveActions = handsPlayed * 2 + (h % 100);
  const passiveActions = handsPlayed + ((h >> 7) % 100);
  return {
    playerId,
    handsPlayed,
    handsWon,
    handsLost,
    chipsBet: chipsWon + chipsLost,
    chipsWon,
    chipsLost,
    netProfit: chipsWon - chipsLost,
    biggestPotWon,
    showdownsWon,
    showdownsSeen,
    vpipCount: Math.round(handsPlayed * 0.45),
    pfrCount: Math.round(handsPlayed * 0.22),
    aggressiveActions,
    passiveActions,
    categoryCounts: {},
    totalPlayMs: handsPlayed * 45_000,
    gamesPlayed: 1 + (h % 40),
    winRate,
    vpip: 0.45,
    pfr: 0.22,
    aggressionFactor: aggressiveActions / Math.max(1, passiveActions),
    showdownWinRate: showdownsSeen ? showdownsWon / showdownsSeen : 0,
  };
}

/** Fetch real stats; null on any non-OK/empty/error. */
export async function fetchStats(playerId: string): Promise<PlayerStatsSummary | null> {
  try {
    const res = await fetch(`/api/stats/${encodeURIComponent(playerId)}`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? (data as PlayerStatsSummary) : null;
  } catch {
    return null;
  }
}

export function useStats(playerId: string | null): {
  stats: PlayerStatsSummary | null;
  loading: boolean;
} {
  const [stats, setStats] = useState<PlayerStatsSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!playerId) {
      setStats(null);
      return;
    }
    if (isMockMode()) {
      setStats(sampleStats(playerId));
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchStats(playerId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  return { stats, loading };
}
```

- [ ] **Step 11: Run useStats tests + full client suite**

Run:
```bash
npm run test -w @poker/client
```
Expected: PASS (StatTile + useStats).

- [ ] **Step 12: Commit**

```bash
git add packages/client/package.json packages/client/vitest.config.ts packages/client/src/test-setup.ts package.json package-lock.json packages/client/src/lobby/StatTile.tsx packages/client/src/lobby/StatTile.test.tsx packages/client/src/lobby/useStats.ts packages/client/src/lobby/useStats.test.ts
git commit -m "feat(client): add test tooling, StatTile, and useStats hook"
```

---

## Task 4: `Header`

**Files:**
- Create: `packages/client/src/lobby/Header.tsx`

**Interfaces:**
- Consumes: `DiscordIdentity` from `@poker/shared`.
- Produces:
  - `type LobbyTab = 'home' | 'leaderboard' | 'stats' | 'shop'`
  - `Header(props: { activeTab: LobbyTab; onTabChange: (t: LobbyTab) => void; identity: DiscordIdentity; onOpenUser: () => void })`

- [ ] **Step 1: Implement `Header`**

Create `packages/client/src/lobby/Header.tsx`:
```tsx
import type { DiscordIdentity } from '@poker/shared';

export type LobbyTab = 'home' | 'leaderboard' | 'stats' | 'shop';

const TABS: { id: LobbyTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'stats', label: 'Stats' },
  { id: 'shop', label: 'Shop' },
];

export interface HeaderProps {
  activeTab: LobbyTab;
  onTabChange: (tab: LobbyTab) => void;
  identity: DiscordIdentity;
  onOpenUser: () => void;
}

export function Header({ activeTab, onTabChange, identity, onOpenUser }: HeaderProps) {
  return (
    <header className="flex flex-none items-center gap-5 px-6 py-4">
      <div className="flex flex-none items-center gap-3">
        <div className="flex h-12 w-12 -rotate-3 items-center justify-center rounded-2xl border-[2.5px] border-gold-border bg-gold text-2xl text-[#2a1c00] shadow-hard-gold">
          ♠
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-display text-lg font-bold text-white">RATBAG</span>
          <span className="mt-[3px] text-[11px] font-extrabold tracking-[0.22em] text-sage">
            POKER NIGHT
          </span>
        </div>
      </div>

      <nav className="mx-auto flex gap-2">
        {TABS.map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={[
                'font-display text-base font-semibold rounded-2xl px-5 py-2.5 transition-transform hover:-translate-y-px border-[2.5px]',
                active
                  ? 'border-gold-border bg-gold text-[#2a1c00] shadow-hard-gold'
                  : 'border-transparent bg-white/5 text-sage-light',
              ].join(' ')}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <button
        onClick={onOpenUser}
        className="flex flex-none items-center gap-2.5 rounded-2xl border-[2.5px] border-black/30 bg-white/5 py-1.5 pl-1.5 pr-3.5 shadow-hard-ink transition-transform hover:-translate-y-px"
      >
        <img
          src={identity.avatarUrl}
          alt=""
          className="h-10 w-10 rounded-xl border-[2.5px] border-gold-border object-cover"
        />
        <span className="flex flex-col items-start leading-tight">
          <span className="font-display text-sm font-semibold text-white">
            {identity.displayName}
          </span>
          <span className="text-xs font-extrabold text-gold-soft">
            ● {identity.chipBalance.toLocaleString()}
          </span>
        </span>
        <span className="ml-0.5 text-xs text-sage">▼</span>
      </button>
    </header>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npm run build -w @poker/client
```
Expected: PASS. (Header isn't imported yet; this only type-checks the file once it's referenced — to type-check now, temporarily it's fine to rely on Task 10's build. If you want an isolated check, run `npx tsc --noEmit -p packages/client/tsconfig.json` after Task 10 wires it in.)

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/lobby/Header.tsx
git commit -m "feat(client): add lobby Header with nav tabs and user button"
```

---

## Task 5: `PlayerRow` (+ status mapping) and `PlayersPanel`

**Files:**
- Create: `packages/client/src/lobby/PlayerRow.tsx`
- Create: `packages/client/src/lobby/PlayerRow.test.tsx`
- Create: `packages/client/src/lobby/PlayersPanel.tsx`

**Interfaces:**
- Consumes: `LobbyPlayer`, `LobbyStatus` from `@poker/shared`.
- Produces:
  - `type PlayerStatusLabel = 'Ready' | 'In Lobby' | 'In-Game'`
  - `playerStatus(player: LobbyPlayer, lobbyStatus: LobbyStatus): PlayerStatusLabel`
  - `STATUS_STYLE: Record<PlayerStatusLabel, { dot: string; text: string; bg: string }>`
  - `PlayerRow(props: { player: LobbyPlayer; status: PlayerStatusLabel; onSelect: () => void })`
  - `PlayersPanel(props: { players: LobbyPlayer[]; lobbyStatus: LobbyStatus; maxPlayers: number; onSelectPlayer: (id: string) => void })`

- [ ] **Step 1: Write the failing `playerStatus` test**

Create `packages/client/src/lobby/PlayerRow.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import type { LobbyPlayer } from '@poker/shared';
import { PlayerRow, playerStatus } from './PlayerRow';

const base: LobbyPlayer = {
  discordUserId: 'u1',
  displayName: 'Alice',
  avatarUrl: 'http://x/a.png',
  chipBalance: 5000,
  isReady: false,
  socketId: 's1',
};

describe('playerStatus', () => {
  it('maps not-ready to In Lobby', () => {
    expect(playerStatus(base, 'waiting')).toBe('In Lobby');
  });
  it('maps ready to Ready', () => {
    expect(playerStatus({ ...base, isReady: true }, 'waiting')).toBe('Ready');
  });
  it('maps in-game lobby status to In-Game regardless of ready', () => {
    expect(playerStatus(base, 'in-game')).toBe('In-Game');
  });
});

describe('PlayerRow', () => {
  it('renders the name and status and fires onSelect', async () => {
    const onSelect = vi.fn();
    render(<PlayerRow player={base} status="Ready" onSelect={onSelect} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    screen.getByRole('button').click();
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run:
```bash
npm run test -w @poker/client -- PlayerRow
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlayerRow`**

Create `packages/client/src/lobby/PlayerRow.tsx`:
```tsx
import type { LobbyPlayer, LobbyStatus } from '@poker/shared';

export type PlayerStatusLabel = 'Ready' | 'In Lobby' | 'In-Game';

export function playerStatus(player: LobbyPlayer, lobbyStatus: LobbyStatus): PlayerStatusLabel {
  if (lobbyStatus === 'in-game') return 'In-Game';
  return player.isReady ? 'Ready' : 'In Lobby';
}

export const STATUS_STYLE: Record<PlayerStatusLabel, { dot: string; text: string; bg: string }> = {
  Ready: { dot: 'bg-mint', text: 'text-mint-bright', bg: 'bg-mint/15' },
  'In Lobby': { dot: 'bg-[#ffcb52]', text: 'text-gold-soft', bg: 'bg-gold/15' },
  'In-Game': { dot: 'bg-blue', text: 'text-[#9ad4ff]', bg: 'bg-blue/15' },
};

export interface PlayerRowProps {
  player: LobbyPlayer;
  status: PlayerStatusLabel;
  onSelect: () => void;
}

export function PlayerRow({ player, status, onSelect }: PlayerRowProps) {
  const s = STATUS_STYLE[status];
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-2xl border-2 border-black/20 bg-white/5 px-3 py-2.5 text-left transition-transform hover:translate-x-0.5 hover:bg-white/10"
    >
      <img
        src={player.avatarUrl}
        alt=""
        className="h-[42px] w-[42px] flex-none rounded-xl border-[2.5px] border-ink object-cover"
      />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-display text-[15px] font-semibold text-white">
          {player.displayName}
        </span>
        <span className="truncate text-xs font-bold text-[#79a892]">
          {player.chipBalance.toLocaleString()} chips
        </span>
      </span>
      <span
        className={`inline-flex flex-none items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-extrabold ${s.bg} ${s.text}`}
      >
        <span className={`h-2 w-2 rounded-pill ${s.dot}`} />
        {status}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run:
```bash
npm run test -w @poker/client -- PlayerRow
```
Expected: PASS.

- [ ] **Step 5: Implement `PlayersPanel`**

Create `packages/client/src/lobby/PlayersPanel.tsx`:
```tsx
import type { LobbyPlayer, LobbyStatus } from '@poker/shared';
import { PlayerRow, playerStatus } from './PlayerRow';

export interface PlayersPanelProps {
  players: LobbyPlayer[];
  lobbyStatus: LobbyStatus;
  maxPlayers: number;
  onSelectPlayer: (id: string) => void;
}

export function PlayersPanel({ players, lobbyStatus, maxPlayers, onSelectPlayer }: PlayersPanelProps) {
  return (
    <aside className="flex min-w-[212px] flex-[0_1_270px] flex-col overflow-hidden rounded-3xl border-[2.5px] border-black/30 bg-felt-900/55 shadow-panel">
      <div className="flex items-center justify-between px-5 pb-3.5 pt-[18px]">
        <span className="font-display text-lg font-semibold text-white">Players</span>
        <span className="rounded-pill border-2 border-gold-border bg-gold px-2.5 py-[3px] font-display text-[13px] font-semibold text-[#2a1c00]">
          {players.length} / {maxPlayers}
        </span>
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto overflow-x-hidden px-3 pb-3.5">
        {players.map((p) => (
          <PlayerRow
            key={p.discordUserId}
            player={p}
            status={playerStatus(p, lobbyStatus)}
            onSelect={() => onSelectPlayer(p.discordUserId)}
          />
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/lobby/PlayerRow.tsx packages/client/src/lobby/PlayerRow.test.tsx packages/client/src/lobby/PlayersPanel.tsx
git commit -m "feat(client): add PlayersPanel and PlayerRow with status mapping"
```

---

## Task 6: `TableSettings` (Home tab)

**Files:**
- Create: `packages/client/src/lobby/TableSettings.tsx`
- Create: `packages/client/src/lobby/TableSettings.test.tsx`

**Interfaces:**
- Consumes: `TableConfig`, `LobbyStatus` from `@poker/shared`.
- Produces:
  - `BLIND_LADDER: [number, number][]`
  - `currentBlindIndex(smallBlind: number, bigBlind: number): number`
  - `TableSettings(props: TableSettingsProps)` where:
    ```ts
    interface TableSettingsProps {
      config: TableConfig;
      canEditConfig: boolean;
      isHost: boolean;
      status: LobbyStatus;
      readyCount: number;
      playerCount: number;
      secondsLeft: number;
      meIsReady: boolean;
      insufficientChips: boolean;
      onUpdateConfig: (patch: Partial<TableConfig>) => void;
      onReadyToggle: () => void;
      onStartCountdown: () => void;
      onCancelCountdown: () => void;
      onLeave: () => void;
    }
    ```

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/lobby/TableSettings.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import type { TableConfig } from '@poker/shared';
import { TableSettings, currentBlindIndex, BLIND_LADDER } from './TableSettings';

const config: TableConfig = {
  buyIn: 3000,
  smallBlind: 25,
  bigBlind: 50,
  maxPlayers: 9,
  turnSeconds: 30,
};

function props(overrides: Partial<React.ComponentProps<typeof TableSettings>> = {}) {
  return {
    config,
    canEditConfig: true,
    isHost: true,
    status: 'waiting' as const,
    readyCount: 0,
    playerCount: 3,
    secondsLeft: 0,
    meIsReady: false,
    insufficientChips: false,
    onUpdateConfig: vi.fn(),
    onReadyToggle: vi.fn(),
    onStartCountdown: vi.fn(),
    onCancelCountdown: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
}

describe('currentBlindIndex', () => {
  it('finds the matching ladder entry', () => {
    expect(currentBlindIndex(25, 50)).toBe(1);
  });
  it('defaults to the [25,50] entry when no match', () => {
    expect(currentBlindIndex(7, 9)).toBe(1);
  });
});

describe('TableSettings', () => {
  it('emits a buy-in increase when host clicks +', () => {
    const p = props();
    render(<TableSettings {...p} />);
    screen.getByRole('button', { name: 'Increase buy-in' }).click();
    expect(p.onUpdateConfig).toHaveBeenCalledWith({ buyIn: 3500 });
  });

  it('emits both blinds when stepping the ladder up', () => {
    const p = props();
    render(<TableSettings {...p} />);
    screen.getByRole('button', { name: 'Increase blinds' }).click();
    expect(p.onUpdateConfig).toHaveBeenCalledWith({
      smallBlind: BLIND_LADDER[2][0],
      bigBlind: BLIND_LADDER[2][1],
    });
  });

  it('emits a clamped turn timer increase', () => {
    const p = props();
    render(<TableSettings {...p} />);
    screen.getByRole('button', { name: 'Increase turn timer' }).click();
    expect(p.onUpdateConfig).toHaveBeenCalledWith({ turnSeconds: 35 });
  });

  it('hides steppers for a non-host (read-only)', () => {
    const p = props({ canEditConfig: false, isHost: false });
    render(<TableSettings {...p} />);
    expect(screen.queryByRole('button', { name: 'Increase buy-in' })).toBeNull();
  });

  it('fires onStartCountdown for the host when idle', () => {
    const p = props();
    render(<TableSettings {...p} />);
    screen.getByRole('button', { name: /start game/i }).click();
    expect(p.onStartCountdown).toHaveBeenCalledOnce();
  });

  it('shows the insufficient-chips notice', () => {
    const p = props({ insufficientChips: true });
    render(<TableSettings {...p} />);
    expect(screen.getByText(/need .* chips/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run:
```bash
npm run test -w @poker/client -- TableSettings
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `TableSettings`**

Create `packages/client/src/lobby/TableSettings.tsx`:
```tsx
import type { LobbyStatus, TableConfig } from '@poker/shared';

export const BLIND_LADDER: [number, number][] = [
  [10, 20],
  [25, 50],
  [25, 100],
  [50, 100],
  [100, 200],
  [200, 400],
];

const DEFAULT_BLIND_INDEX = 1; // [25, 50]

export function currentBlindIndex(smallBlind: number, bigBlind: number): number {
  const i = BLIND_LADDER.findIndex(([s, b]) => s === smallBlind && b === bigBlind);
  return i === -1 ? DEFAULT_BLIND_INDEX : i;
}

export interface TableSettingsProps {
  config: TableConfig;
  canEditConfig: boolean;
  isHost: boolean;
  status: LobbyStatus;
  readyCount: number;
  playerCount: number;
  secondsLeft: number;
  meIsReady: boolean;
  insufficientChips: boolean;
  onUpdateConfig: (patch: Partial<TableConfig>) => void;
  onReadyToggle: () => void;
  onStartCountdown: () => void;
  onCancelCountdown: () => void;
  onLeave: () => void;
}

function Stepper({
  label,
  hint,
  value,
  editable,
  onDown,
  onUp,
  decLabel,
  incLabel,
}: {
  label: string;
  hint: string;
  value: string;
  editable: boolean;
  onDown: () => void;
  onUp: () => void;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3.5 rounded-2xl border-2 border-black/30 bg-felt-600 py-[15px] pl-[22px] pr-4">
      <div className="flex flex-col leading-tight">
        <span className="text-xs font-extrabold tracking-[0.12em] text-sage">{label}</span>
        <span className="mt-[3px] font-display text-[15px] font-semibold text-sage-light">{hint}</span>
      </div>
      {editable ? (
        <div className="flex items-center gap-3">
          <button
            aria-label={decLabel}
            onClick={onDown}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border-[2.5px] border-ink bg-felt-300 font-display text-2xl leading-none text-cream shadow-hard-ink-sm active:translate-y-0.5"
          >
            −
          </button>
          <span className="min-w-[78px] text-center font-display text-[26px] font-bold text-gold">
            {value}
          </span>
          <button
            aria-label={incLabel}
            onClick={onUp}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border-[2.5px] border-ink bg-felt-300 font-display text-2xl leading-none text-cream shadow-hard-ink-sm active:translate-y-0.5"
          >
            +
          </button>
        </div>
      ) : (
        <span className="font-display text-[26px] font-bold text-gold">{value}</span>
      )}
    </div>
  );
}

export function TableSettings(props: TableSettingsProps) {
  const {
    config,
    canEditConfig,
    isHost,
    status,
    readyCount,
    playerCount,
    secondsLeft,
    meIsReady,
    insufficientChips,
    onUpdateConfig,
    onReadyToggle,
    onStartCountdown,
    onCancelCountdown,
    onLeave,
  } = props;

  const blindIdx = currentBlindIndex(config.smallBlind, config.bigBlind);
  const cdRunning = status === 'countdown';

  const buyInUp = () => onUpdateConfig({ buyIn: config.buyIn + 500 });
  const buyInDown = () => onUpdateConfig({ buyIn: Math.max(500, config.buyIn - 500) });
  const blindsUp = () => {
    const i = Math.min(BLIND_LADDER.length - 1, blindIdx + 1);
    onUpdateConfig({ smallBlind: BLIND_LADDER[i][0], bigBlind: BLIND_LADDER[i][1] });
  };
  const blindsDown = () => {
    const i = Math.max(0, blindIdx - 1);
    onUpdateConfig({ smallBlind: BLIND_LADDER[i][0], bigBlind: BLIND_LADDER[i][1] });
  };
  const timerUp = () => onUpdateConfig({ turnSeconds: Math.min(120, config.turnSeconds + 5) });
  const timerDown = () => onUpdateConfig({ turnSeconds: Math.max(10, config.turnSeconds - 5) });

  const statusText = cdRunning
    ? secondsLeft === 0
      ? 'Dealing in…'
      : `Starting in ${secondsLeft}s`
    : 'Waiting to start';

  return (
    <div className="relative mx-auto w-full max-w-[740px] py-7">
      {/* top straddle pill: READY STATUS */}
      <div className="absolute left-1/2 top-0.5 z-[4] flex -translate-x-1/2 items-center gap-2.5 rounded-pill border-[2.5px] border-ink bg-felt-800 py-2 pl-[18px] pr-2.5 shadow-pill">
        <span className="font-display text-[13px] font-semibold tracking-[0.12em] text-[#cfeadd]">
          READY STATUS
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-pill border-2 border-mint-border bg-mint px-3 py-1 font-display text-[13px] font-bold text-felt-900">
          <span className="h-2 w-2 rounded-pill bg-felt-900" />
          {readyCount} / {playerCount} READY
        </span>
      </div>

      {/* card */}
      <div className="rounded-[28px] border-[2.5px] border-black/30 bg-felt-500 px-9 pb-14 pt-[54px] shadow-tablecard">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-extrabold tracking-[0.22em] text-sage">THE TABLE</span>
            <span className="whitespace-nowrap font-display text-[28px] font-semibold leading-tight text-white">
              Table Settings
            </span>
          </div>
          <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-pill border-2 border-gold/35 bg-gold/15 px-3 py-1.5 text-xs font-extrabold text-gold-soft">
            ♠ Hold&apos;em
          </span>
        </div>

        <p className="mb-[22px] mt-1 text-sm font-bold text-sage-muted">
          {isHost
            ? 'You’re the host — tweak the table, then deal everyone in.'
            : 'Only the host can change these. Sit tight!'}
        </p>

        <div className="flex flex-col gap-3">
          <Stepper
            label="BUY-IN"
            hint="Chips to sit down"
            value={config.buyIn.toLocaleString()}
            editable={canEditConfig}
            onDown={buyInDown}
            onUp={buyInUp}
            decLabel="Decrease buy-in"
            incLabel="Increase buy-in"
          />
          <Stepper
            label="BLINDS"
            hint="Small / Big"
            value={`${config.smallBlind} / ${config.bigBlind}`}
            editable={canEditConfig}
            onDown={blindsDown}
            onUp={blindsUp}
            decLabel="Decrease blinds"
            incLabel="Increase blinds"
          />
          <Stepper
            label="TURN TIMER"
            hint="Seconds to act"
            value={`${config.turnSeconds}s`}
            editable={canEditConfig}
            onDown={timerDown}
            onUp={timerUp}
            decLabel="Decrease turn timer"
            incLabel="Increase turn timer"
          />
        </div>

        {insufficientChips && (
          <p className="mt-4 text-sm font-bold text-red">
            You need {config.buyIn.toLocaleString()} chips to join this table.
          </p>
        )}

        <div className="my-6 h-0.5 rounded bg-black/25" />

        {/* ACTION */}
        {cdRunning ? (
          <div className="flex items-center gap-4">
            <div className="flex flex-1 items-center gap-4 rounded-2xl border-[2.5px] border-mint-border bg-felt-800 px-[22px] py-3.5">
              <span className="min-w-[54px] text-center font-display text-[44px] font-bold leading-none text-mint">
                {secondsLeft}
              </span>
              <div className="flex flex-col leading-tight">
                <span className="font-display text-lg font-semibold text-white">Game starting…</span>
                <span className="text-[13px] font-bold text-sage-muted">
                  Take your seat — cards are coming out.
                </span>
              </div>
            </div>
            {meIsReady && (
              <button
                onClick={onCancelCountdown}
                className="rounded-2xl border-[2.5px] border-red-border bg-red px-6 py-[15px] font-display text-base font-semibold text-white shadow-hard-red active:translate-y-[3px]"
              >
                Cancel
              </button>
            )}
          </div>
        ) : isHost ? (
          <button
            onClick={onStartCountdown}
            disabled={readyCount < 2 || status !== 'waiting'}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border-[3px] border-gold-border bg-gold p-[18px] font-display text-[21px] font-semibold text-[#2a1c00] shadow-hard-gold-lg transition-transform hover:-translate-y-px active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ♠ START GAME
          </button>
        ) : (
          <div className="flex items-center justify-between gap-3.5">
            <button
              onClick={onReadyToggle}
              disabled={insufficientChips}
              className="flex flex-1 items-center gap-3 rounded-2xl border-[2.5px] border-dashed border-gold/40 bg-gold/10 px-[22px] py-4 font-display text-[17px] font-semibold text-gold-soft disabled:opacity-50"
            >
              <span className="h-2.5 w-2.5 rounded-pill bg-gold" />
              {meIsReady ? 'Ready — waiting for host…' : 'Tap to ready up'}
            </button>
            <button
              onClick={onLeave}
              className="rounded-2xl border-[2.5px] border-red-border bg-red px-6 py-4 font-display text-base font-semibold text-white shadow-hard-red active:translate-y-[3px]"
            >
              Leave
            </button>
          </div>
        )}
      </div>

      {/* bottom straddle pill: TABLE STATUS */}
      <div className="absolute bottom-0.5 left-1/2 z-[4] flex -translate-x-1/2 items-center gap-2.5 rounded-pill border-[2.5px] border-ink bg-felt-800 px-[18px] py-2 shadow-pill">
        <span className="font-display text-[13px] font-semibold tracking-[0.12em] text-[#cfeadd]">
          TABLE STATUS
        </span>
        <span className={`h-[7px] w-[7px] rounded-pill ${cdRunning ? 'bg-mint' : 'bg-[#ffcb52]'}`} />
        <span className={`font-display text-[13px] font-semibold ${cdRunning ? 'text-mint' : 'text-sage-muted'}`}>
          {statusText}
        </span>
      </div>
    </div>
  );
}
```

Note for the host Ready flow: in this design the host's primary action is START GAME; the host readies implicitly by starting. The non-host branch exposes Ready/Leave. `onReadyToggle` is wired so a future host-also-readies refinement is trivial.

- [ ] **Step 4: Run the tests to confirm they pass**

Run:
```bash
npm run test -w @poker/client -- TableSettings
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lobby/TableSettings.tsx packages/client/src/lobby/TableSettings.test.tsx
git commit -m "feat(client): add TableSettings home tab with steppers and actions"
```

---

## Task 7: `ComingSoon` and `RecentActivity`

**Files:**
- Create: `packages/client/src/lobby/ComingSoon.tsx`
- Create: `packages/client/src/lobby/RecentActivity.tsx`
- Create: `packages/client/src/lobby/ComingSoon.test.tsx`

**Interfaces:**
- Produces:
  - `ComingSoon(props: { title: string; blurb?: string; icon?: string })`
  - `RecentActivity()` — no props; scaffold with empty state.

- [ ] **Step 1: Write the failing `ComingSoon` test**

Create `packages/client/src/lobby/ComingSoon.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { ComingSoon } from './ComingSoon';

it('renders the title and a coming-soon badge', () => {
  render(<ComingSoon title="Leaderboard" />);
  expect(screen.getByText('Leaderboard')).toBeInTheDocument();
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run:
```bash
npm run test -w @poker/client -- ComingSoon
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ComingSoon`**

Create `packages/client/src/lobby/ComingSoon.tsx`:
```tsx
export interface ComingSoonProps {
  title: string;
  blurb?: string;
  icon?: string;
}

export function ComingSoon({ title, blurb, icon = '♠' }: ComingSoonProps) {
  return (
    <div className="mx-auto flex w-full max-w-[740px] flex-col items-center justify-center py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border-[2.5px] border-gold-border bg-gold text-3xl text-[#2a1c00] shadow-hard-gold">
        {icon}
      </div>
      <h2 className="font-display text-[26px] font-semibold text-white">{title}</h2>
      <span className="mt-3 rounded-pill border-2 border-gold-border bg-gold px-3 py-1 text-xs font-extrabold text-[#2a1c00]">
        COMING SOON
      </span>
      <p className="mt-4 max-w-sm text-sm font-bold text-sage-muted">
        {blurb ?? 'This page is on the way. Check back soon!'}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Implement `RecentActivity`**

Create `packages/client/src/lobby/RecentActivity.tsx`:
```tsx
export function RecentActivity() {
  return (
    <aside className="hidden min-w-[236px] flex-[0_1_300px] flex-col overflow-hidden rounded-3xl border-[2.5px] border-black/30 bg-felt-900/55 shadow-panel rail:flex">
      <div className="flex items-center gap-2.5 px-5 pb-3.5 pt-[18px]">
        <span className="font-display text-lg font-semibold text-white">Recent Activity</span>
        <span className="mt-0.5 h-2 w-2 rounded-pill bg-mint" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-6 text-center">
        <p className="text-sm font-bold text-sage-muted">No recent activity yet.</p>
        <p className="mt-1 text-xs font-semibold text-sage">
          Hands, joins, and chip moves will show up here.
        </p>
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Run the ComingSoon test to confirm pass**

Run:
```bash
npm run test -w @poker/client -- ComingSoon
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/lobby/ComingSoon.tsx packages/client/src/lobby/ComingSoon.test.tsx packages/client/src/lobby/RecentActivity.tsx
git commit -m "feat(client): add ComingSoon and RecentActivity scaffolds"
```

---

## Task 8: `UserPopout`

**Files:**
- Create: `packages/client/src/lobby/UserPopout.tsx`
- Create: `packages/client/src/lobby/UserPopout.test.tsx`

**Interfaces:**
- Consumes: `DiscordIdentity`, `PlayerStatsSummary`; `StatTile`.
- Produces: `UserPopout(props: { identity: DiscordIdentity; stats: PlayerStatsSummary | null; onClose: () => void })`

- [ ] **Step 1: Write the failing test (sub-tab switching)**

Create `packages/client/src/lobby/UserPopout.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import type { DiscordIdentity } from '@poker/shared';
import { UserPopout } from './UserPopout';

const identity: DiscordIdentity = {
  discordUserId: 'u1',
  displayName: 'You',
  avatarUrl: 'http://x/a.png',
  chipBalance: 42500,
};

it('shows Profile stats by default and switches to a Coming Soon Settings tab', () => {
  render(<UserPopout identity={identity} stats={null} onClose={vi.fn()} />);
  expect(screen.getByText('WIN RATE')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Settings' }).click();
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run:
```bash
npm run test -w @poker/client -- UserPopout
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `UserPopout`**

Create `packages/client/src/lobby/UserPopout.tsx`:
```tsx
import { useState } from 'react';
import type { DiscordIdentity, PlayerStatsSummary } from '@poker/shared';
import { StatTile } from './StatTile';

type UserTab = 'profile' | 'settings' | 'howto';

function pct(n: number | undefined): string | null {
  return n == null ? null : `${Math.round(n * 100)}%`;
}
function num(n: number | undefined): string | null {
  return n == null ? null : n.toLocaleString();
}

export interface UserPopoutProps {
  identity: DiscordIdentity;
  stats: PlayerStatsSummary | null;
  onClose: () => void;
}

export function UserPopout({ identity, stats, onClose }: UserPopoutProps) {
  const [tab, setTab] = useState<UserTab>('profile');

  const tabBtn = (id: UserTab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={[
        'flex-1 rounded-t-xl px-1 py-2.5 font-display text-[13px] font-semibold',
        tab === id ? 'bg-felt-600 text-white border-b-[3px] border-gold' : 'text-sage-muted',
      ].join(' ')}
    >
      {label}
    </button>
  );

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 animate-fade bg-[rgba(4,18,12,0.35)]" />
      <div className="fixed right-6 top-[78px] z-[41] w-[330px] origin-top-right animate-pop overflow-hidden rounded-3xl border-[2.5px] border-black/40 bg-felt-500 shadow-popout">
        <div className="flex items-center gap-3 bg-gradient-to-b from-gold/15 to-transparent px-[18px] pb-4 pt-[18px]">
          <img
            src={identity.avatarUrl}
            alt=""
            className="h-13 w-13 flex-none rounded-2xl border-[2.5px] border-gold-border object-cover"
            style={{ width: 52, height: 52 }}
          />
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="font-display text-lg font-semibold text-white">{identity.displayName}</span>
            <span className="text-[13px] font-bold text-sage-muted">Poker night regular</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-pill border-2 border-gold-border bg-gold px-2.5 py-1 font-display text-sm font-bold text-[#2a1c00]">
            <span className="h-[7px] w-[7px] rounded-pill bg-[#2a1c00]" />
            {identity.chipBalance.toLocaleString()}
          </span>
        </div>

        <div className="flex gap-1.5 px-3.5 pt-1">
          {tabBtn('profile', 'Profile')}
          {tabBtn('settings', 'Settings')}
          {tabBtn('howto', 'How to Play')}
        </div>
        <div className="mx-3.5 h-0.5 bg-black/20" />

        <div className="px-[18px] pb-[18px] pt-4">
          {tab === 'profile' && (
            <div className="grid grid-cols-2 gap-2.5">
              <StatTile label="HANDS WON" value={num(stats?.handsWon)} />
              <StatTile label="WIN RATE" value={pct(stats?.winRate)} />
              <StatTile label="BIGGEST POT" value={num(stats?.biggestPotWon)} />
              <StatTile label="NET PROFIT" value={num(stats?.netProfit)} />
            </div>
          )}

          {tab === 'settings' && (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="rounded-pill border-2 border-gold-border bg-gold px-3 py-1 text-xs font-extrabold text-[#2a1c00]">
                COMING SOON
              </span>
              <p className="text-sm font-bold text-sage-muted">Settings are on the way.</p>
            </div>
          )}

          {tab === 'howto' && (
            <div className="flex flex-col gap-2.5">
              {[
                ['1', '#44e0a3', 'Everyone buys in for the same chip stack and grabs a seat.'],
                ['2', '#ffc63d', 'Blinds force the action — bet, call, raise or fold each round.'],
                ['3', '#5bb8ff', 'Best five-card hand at showdown scoops the pot.'],
              ].map(([n, color, text]) => (
                <div key={n} className="flex items-start gap-3">
                  <span
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-lg border-2 border-ink font-display text-[13px] font-bold text-[#0b2c1f]"
                    style={{ background: color }}
                  >
                    {n}
                  </span>
                  <p className="text-sm font-bold leading-snug text-[#dfeee6]">{text}</p>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={onClose}
            className="mt-3.5 w-full rounded-xl border-2 border-red/30 bg-red/10 py-2.5 font-display text-sm font-semibold text-[#ff9b9b] hover:bg-red/20"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run:
```bash
npm run test -w @poker/client -- UserPopout
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lobby/UserPopout.tsx packages/client/src/lobby/UserPopout.test.tsx
git commit -m "feat(client): add UserPopout (profile / settings / how-to-play)"
```

---

## Task 9: `PlayerProfileModal`

**Files:**
- Create: `packages/client/src/lobby/PlayerProfileModal.tsx`
- Create: `packages/client/src/lobby/PlayerProfileModal.test.tsx`

**Interfaces:**
- Consumes: `LobbyPlayer`, `LobbyStatus`; `StatTile`, `useStats`, `playerStatus`, `STATUS_STYLE`.
- Produces: `PlayerProfileModal(props: { player: LobbyPlayer; lobbyStatus: LobbyStatus; onClose: () => void })` — fetches stats internally via `useStats(player.discordUserId)`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/lobby/PlayerProfileModal.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import type { LobbyPlayer } from '@poker/shared';
import { PlayerProfileModal } from './PlayerProfileModal';

const player: LobbyPlayer = {
  discordUserId: 'u1',
  displayName: 'Maverick',
  avatarUrl: 'http://x/a.png',
  chipBalance: 88200,
  isReady: true,
  socketId: 's1',
};

it('shows the player name, chips, and stat labels', () => {
  render(<PlayerProfileModal player={player} lobbyStatus="waiting" onClose={vi.fn()} />);
  expect(screen.getByText('Maverick')).toBeInTheDocument();
  expect(screen.getByText('88,200')).toBeInTheDocument();
  expect(screen.getByText('WIN RATE')).toBeInTheDocument();
  expect(screen.getByText('HANDS WON')).toBeInTheDocument();
});

it('calls onClose when the close button is clicked', () => {
  const onClose = vi.fn();
  render(<PlayerProfileModal player={player} lobbyStatus="waiting" onClose={onClose} />);
  screen.getByRole('button', { name: /close/i }).click();
  expect(onClose).toHaveBeenCalled();
});
```

Note: in the jsdom test, `useStats` runs in non-mock mode (no `?mock`), so `stats` is null and tiles render `—`; the test only asserts labels + chips (chips come from `player`, not stats).

- [ ] **Step 2: Run it to confirm it fails**

Run:
```bash
npm run test -w @poker/client -- PlayerProfileModal
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PlayerProfileModal`**

Create `packages/client/src/lobby/PlayerProfileModal.tsx`:
```tsx
import type { LobbyPlayer, LobbyStatus } from '@poker/shared';
import { StatTile } from './StatTile';
import { useStats } from './useStats';
import { playerStatus, STATUS_STYLE } from './PlayerRow';

export interface PlayerProfileModalProps {
  player: LobbyPlayer;
  lobbyStatus: LobbyStatus;
  onClose: () => void;
}

function pct(n: number | undefined): string | null {
  return n == null ? null : `${Math.round(n * 100)}%`;
}
function num(n: number | undefined): string | null {
  return n == null ? null : n.toLocaleString();
}

export function PlayerProfileModal({ player, lobbyStatus, onClose }: PlayerProfileModalProps) {
  const { stats } = useStats(player.discordUserId);
  const status = playerStatus(player, lobbyStatus);
  const s = STATUS_STYLE[status];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-[rgba(4,18,12,0.6)] p-6 backdrop-blur-[3px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-w-full animate-pop overflow-hidden rounded-[26px] border-[3px] border-black/40 bg-felt-500 shadow-modal"
      >
        <div className="relative bg-gradient-to-b from-mint/15 to-transparent px-6 pb-5 pt-6">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border-2 border-black/30 bg-black/20 text-[#cfeadd] hover:bg-black/40"
          >
            ✕
          </button>
          <div className="flex items-center gap-4">
            <img
              src={player.avatarUrl}
              alt=""
              className="h-[72px] w-[72px] flex-none rounded-[20px] border-[3px] border-ink object-cover shadow-hard-ink"
            />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="font-display text-[25px] font-semibold text-white">{player.displayName}</span>
              <span
                className={`mt-2 inline-flex items-center gap-1.5 self-start rounded-pill px-3 py-1 text-xs font-extrabold ${s.bg} ${s.text}`}
              >
                <span className={`h-2 w-2 rounded-pill ${s.dot}`} />
                {status}
              </span>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 pt-2">
          <div className="grid grid-cols-2 gap-2.5">
            <StatTile label="CHIPS" value={player.chipBalance.toLocaleString()} accent="#ffd882" />
            <StatTile label="WIN RATE" value={pct(stats?.winRate)} />
            <StatTile label="HANDS WON" value={num(stats?.handsWon)} />
            <StatTile label="BIGGEST POT" value={num(stats?.biggestPotWon)} />
          </div>
          <button
            disabled
            className="mt-4 w-full cursor-not-allowed rounded-2xl border-[2.5px] border-ink bg-felt-300 py-3 font-display text-[15px] font-semibold text-white opacity-60"
          >
            View Profile (coming soon)
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run:
```bash
npm run test -w @poker/client -- PlayerProfileModal
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/lobby/PlayerProfileModal.tsx packages/client/src/lobby/PlayerProfileModal.test.tsx
git commit -m "feat(client): add PlayerProfileModal quick-view"
```

---

## Task 10: `LobbyScreen` assembly + `App` wiring + delete old `Lobby`

**Files:**
- Create: `packages/client/src/lobby/LobbyScreen.tsx`
- Modify: `packages/client/src/App.tsx`
- Delete: `packages/client/src/Lobby.tsx`

**Interfaces:**
- Consumes: all lobby components; `ClientSocket`; `DiscordIdentity`.
- Produces: `LobbyScreen(props: { socket: ClientSocket; identity: DiscordIdentity; instanceId: string; onGameStart: (gameId: string) => void })`.

- [ ] **Step 1: Implement `LobbyScreen`**

Create `packages/client/src/lobby/LobbyScreen.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import type { DiscordIdentity, LobbyState, TableConfig } from '@poker/shared';
import type { ClientSocket } from '../socket';
import { Header, type LobbyTab } from './Header';
import { PlayersPanel } from './PlayersPanel';
import { TableSettings } from './TableSettings';
import { ComingSoon } from './ComingSoon';
import { RecentActivity } from './RecentActivity';
import { UserPopout } from './UserPopout';
import { PlayerProfileModal } from './PlayerProfileModal';
import { useStats } from './useStats';

export interface LobbyScreenProps {
  socket: ClientSocket;
  identity: DiscordIdentity;
  instanceId: string;
  onGameStart: (gameId: string) => void;
}

export function LobbyScreen({ socket, identity, instanceId, onGameStart }: LobbyScreenProps) {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<LobbyTab>('home');
  const [userOpen, setUserOpen] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const { stats: myStats } = useStats(userOpen ? identity.discordUserId : null);

  useEffect(() => {
    socket.emit('join_lobby', { instanceId, identity });
    socket.on('lobby_state_update', setLobby);
    socket.on('game_start', ({ gameId }) => onGameStart(gameId));
    return () => {
      socket.off('lobby_state_update', setLobby);
      socket.off('game_start');
    };
  }, [socket, instanceId, identity, onGameStart]);

  useEffect(() => {
    if (lobby?.status !== 'countdown') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [lobby?.status]);

  const me = useMemo(
    () => lobby?.players.find((p) => p.discordUserId === identity.discordUserId),
    [lobby, identity.discordUserId],
  );

  if (!lobby) {
    return (
      <main className="felt-bg flex h-screen items-center justify-center font-body text-cream">
        Joining lobby…
      </main>
    );
  }

  const isHost = lobby.players[0]?.discordUserId === identity.discordUserId;
  const readyCount = lobby.players.filter((p) => p.isReady).length;
  const canEditConfig = isHost && lobby.status === 'waiting' && readyCount === 0;
  const insufficientChips = identity.chipBalance < lobby.config.buyIn;
  const secondsLeft =
    lobby.countdownEndsAt != null ? Math.max(0, Math.ceil((lobby.countdownEndsAt - now) / 1000)) : 0;

  const selectedPlayer = selectedPlayerId
    ? lobby.players.find((p) => p.discordUserId === selectedPlayerId) ?? null
    : null;

  const updateConfig = (patch: Partial<TableConfig>) => socket.emit('update_config', patch);

  return (
    <div className="felt-bg flex h-screen w-full flex-col overflow-hidden font-body text-cream">
      <Header
        activeTab={tab}
        onTabChange={setTab}
        identity={identity}
        onOpenUser={() => setUserOpen(true)}
      />

      <main className="flex min-h-0 flex-1 gap-3.5 px-[18px] pb-[22px] pt-1.5">
        <PlayersPanel
          players={lobby.players}
          lobbyStatus={lobby.status}
          maxPlayers={lobby.config.maxPlayers}
          onSelectPlayer={setSelectedPlayerId}
        />

        <section className="min-w-[336px] flex-1 overflow-y-auto overflow-x-hidden p-1">
          {tab === 'home' && (
            <TableSettings
              config={lobby.config}
              canEditConfig={canEditConfig}
              isHost={isHost}
              status={lobby.status}
              readyCount={readyCount}
              playerCount={lobby.players.length}
              secondsLeft={secondsLeft}
              meIsReady={me?.isReady ?? false}
              insufficientChips={insufficientChips}
              onUpdateConfig={updateConfig}
              onReadyToggle={() => socket.emit(me?.isReady ? 'player_unready' : 'player_ready')}
              onStartCountdown={() => socket.emit('start_countdown')}
              onCancelCountdown={() => socket.emit('cancel_countdown')}
              onLeave={() => socket.emit('leave_table')}
            />
          )}
          {tab === 'leaderboard' && <ComingSoon title="Leaderboard" />}
          {tab === 'stats' && <ComingSoon title="Stats" />}
          {tab === 'shop' && <ComingSoon title="Shop" />}
        </section>

        <RecentActivity />
      </main>

      {userOpen && (
        <UserPopout identity={identity} stats={myStats} onClose={() => setUserOpen(false)} />
      )}
      {selectedPlayer && (
        <PlayerProfileModal
          player={selectedPlayer}
          lobbyStatus={lobby.status}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `App.tsx` to `LobbyScreen`**

In `packages/client/src/App.tsx`, replace the `Lobby` import and usage:
```tsx
import { LobbyScreen } from './lobby/LobbyScreen';
```
and the returned element:
```tsx
  return (
    <LobbyScreen
      socket={socketRef.current!}
      identity={status.identity}
      instanceId={status.instanceId}
      onGameStart={setGameId}
    />
  );
```
(Leave the `Centered` connecting/error screens as-is.)

- [ ] **Step 3: Delete the old lobby**

Run:
```bash
git rm packages/client/src/Lobby.tsx
```

- [ ] **Step 4: Full build + full test suite**

Run:
```bash
npm run build && npm test
```
Expected: PASS — shared + server + client build; server + client tests green. Fix any type errors surfaced by the new imports (e.g. a stray `TableConfig` literal missing `turnSeconds`).

- [ ] **Step 5: Manual smoke (mock mode)**

Run `npm run dev`, open `http://localhost:5173/?mock=1&name=Alice` and a second tab `?mock=1&name=Bob&room=dev-room`. Verify: both players appear in the left panel with status; host (first joiner) sees steppers and START GAME; non-host sees Ready/Leave; clicking a player opens the modal with sample stats; the user button opens the popout with sample stats; nav tabs switch Home ↔ Coming Soon. (Document anything off; not a blocker for commit if tests/build pass.)

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/lobby/LobbyScreen.tsx packages/client/src/App.tsx
git commit -m "feat(client): assemble LobbyScreen and replace old Lobby"
```

---

## Task 11: Design standards doc + project docs

**Files:**
- Create: `docs/DESIGN_STANDARDS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write `docs/DESIGN_STANDARDS.md`**

Create `docs/DESIGN_STANDARDS.md` with these sections (use the exact token values from `packages/client/src/index.css`, Task 1 Step 4):
  - **Foundations** — the felt-background gradient, font roles (`font-display` Fredoka for headings/labels/numbers, `font-body` Nunito for prose), and the full color token table (name → hex → Tailwind utility).
  - **Elevation & shadows** — the "hard offset" shadow language (`shadow-hard-*`), panel/card/modal/popout shadows, and when to use each.
  - **Radii & shape** — rounded family (`rounded-xl/2xl/3xl`, `rounded-[26px]/[28px]`, `rounded-pill`).
  - **Components** — documented patterns with class recipes: chunky button (border + hard shadow + `active:translate-y` press), panel/aside card, pill/badge, stepper row, stat tile, modal & popout (with `animate-pop`/`animate-fade`).
  - **Interaction conventions** — hover lift (`hover:-translate-y-px`), active press, disabled (`opacity-50 cursor-not-allowed`).
  - **Layout** — the 3-column lobby grid and the `rail:` (1080px) breakpoint that hides the right rail.
  - **Building a new page** — checklist: use `felt-bg` + `font-body` root, compose from existing components, pull colors/shadows from tokens (never hardcode new hex), gate host-only controls, show `—` for missing data, add a Vitest test for any logic.

- [ ] **Step 2: Update `CLAUDE.md`**

Add to the client description / conventions:
  - The client now uses **Tailwind v4** (`@tailwindcss/vite`, tokens in `src/index.css`); see `docs/DESIGN_STANDARDS.md`.
  - The lobby lives in `packages/client/src/lobby/` (`LobbyScreen` + focused components); `Lobby.tsx` is gone.
  - `TableConfig` now has **`turnSeconds`** (host-configurable turn timer, 10–120 step 5; default 30), threaded into the game turn timer via `rooms/index.ts`.
  - Client tests run under **Vitest + React Testing Library**; root `npm test` runs server **and** client.

- [ ] **Step 3: Update `docs/ARCHITECTURE.md`**

In the client section, describe the new lobby component structure and the `turnSeconds` config field + its flow into `GameRoom` timing. Note deferred UI features (titles, levels, shop, leaderboard/stats data, friends, populated activity, settings toggles, view-profile page, log out).

- [ ] **Step 4: Verify nothing broke**

Run:
```bash
npm test && npm run build
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/DESIGN_STANDARDS.md CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs: add design standards and document lobby redesign"
```

---

## Self-Review

**Spec coverage:**
- Tailwind v4 + tokens → Task 1. ✓
- `turnSeconds` backend wiring → Task 2. ✓
- `useStats` (sample in mock, placeholder otherwise) + `StatTile` → Task 3. ✓
- Header/nav + Coming-Soon tabs → Tasks 4, 7, 10. ✓
- Players list + status (Ready/In Lobby/In-Game) + Discord avatars → Task 5. ✓
- Table settings (buy-in/blinds/turn-timer steppers, host gating, ready/start/cancel/leave, countdown, pills) → Task 6. ✓
- Recent Activity scaffold → Task 7. ✓
- User popout (Profile / Settings-coming-soon / How to Play) → Task 8. ✓
- Player profile modal (CHIPS/WIN RATE/HANDS WON/BIGGEST POT, no Add Friend, View-Profile disabled) → Task 9. ✓
- LobbyScreen assembly + App wiring + delete old Lobby → Task 10. ✓
- Design standards doc + CLAUDE.md + ARCHITECTURE.md → Task 11. ✓
- Deferred-feature list → captured in Task 11 Step 3 + spec. ✓
- Test tooling + `npm test`/`npm run build` gate → Tasks 3, 10. ✓

**Placeholder scan:** No TBD/TODO; all code steps include full code. Task 11 doc steps describe section content with exact token references rather than dumping the full prose doc — acceptable for a documentation task (no code interfaces depend on it).

**Type consistency:** `playerStatus`/`STATUS_STYLE` (Task 5) reused identically in Task 9; `LobbyTab` (Task 4) reused in Task 10; `TableConfig.turnSeconds` (Task 2) used by Tasks 6/10; `useStats`/`sampleStats`/`fetchStats` (Task 3) signatures match consumers in Tasks 8/9/10; `StatTile` props consistent across Tasks 3/8/9.

---

## Execution Handoff

Saved to `docs/superpowers/plans/2026-06-21-lobby-ui-redesign.md`.
