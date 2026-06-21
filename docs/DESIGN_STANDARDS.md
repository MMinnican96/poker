# Design Standards — Ratbag Poker Night

This document is the single reference for visual style in the Discord Poker client.
All new pages and components must follow it. Tokens live in
[`packages/client/src/index.css`](../packages/client/src/index.css); never hardcode
hex values in component files.

---

## Foundations

### Felt background

The root canvas of every page uses the `.felt-bg` component class:

```css
.felt-bg {
  background: radial-gradient(120% 90% at 50% -10%, #1d6044 0%, #134632 42%, #0b2c1f 100%);
}
```

Apply it to the outermost container (usually the element that fills the viewport).

### Fonts

| Role | Family | Tailwind utility | Use for |
|---|---|---|---|
| Display | Fredoka 400–700 | `font-display` | Headings, labels, chip counts, numbers, tab names |
| Body | Nunito 400–900 | `font-body` | Prose, descriptions, helper text |

`font-body` is set on `<body>` in the base layer, so it is inherited everywhere.
Switch to `font-display` explicitly on any element that is a heading, large number,
or label.

### Color tokens

All tokens are declared in `@theme` inside `packages/client/src/index.css` and map
directly to Tailwind utilities (`bg-*`, `text-*`, `border-*`).

#### Felt + panels

| Token name | Hex | Tailwind utilities |
|---|---|---|
| `felt-900` | `#0b2c1f` | `bg-felt-900` / `text-felt-900` |
| `felt-800` | `#0e3325` | `bg-felt-800` |
| `felt-700` | `#134632` | `bg-felt-700` |
| `felt-600` | `#163f2e` | `bg-felt-600` |
| `felt-500` | `#1c4836` | `bg-felt-500` |
| `felt-400` | `#1d6044` | `bg-felt-400` |
| `felt-300` | `#2c5d48` | `bg-felt-300` |
| `ink` | `#0c2418` | `bg-ink` / `text-ink` / `border-ink` |

Use `felt-900` for the deepest backgrounds (modals, popout backdrops). Use
`felt-500`/`felt-600` for panel interiors. `ink` is the hard-shadow and border
accent color.

#### Gold

| Token name | Hex | Tailwind utilities |
|---|---|---|
| `gold` | `#ffc63d` | `bg-gold` / `text-gold` |
| `gold-border` | `#c8920d` | `border-gold-border` |
| `gold-shadow` | `#ad7a04` | (used directly in shadow tokens) |
| `gold-soft` | `#ffd882` | `text-gold-soft` |

Primary accent color — active tab highlights, primary CTAs, chip counts, host badge.

#### Accents

| Token name | Hex | Tailwind utilities |
|---|---|---|
| `mint` | `#44e0a3` | `bg-mint` / `text-mint` |
| `mint-bright` | `#7df0c4` | `text-mint-bright` |
| `mint-border` | `#1e9e6e` | `border-mint-border` |
| `blue` | `#5bb8ff` | `bg-blue` / `text-blue` |
| `blue-border` | `#2e86c8` | `border-blue-border` |
| `red` | `#ff6b6b` | `bg-red` / `text-red` |
| `red-border` | `#d63d3d` | `border-red-border` |
| `red-shadow` | `#b32e2e` | (used directly in shadow tokens) |
| `purple` | `#b07bff` | `bg-purple` / `text-purple` |

Semantic: `mint` = ready / success; `blue` = in-game / info; `red` = cancel / danger;
`gold` = host / active.

#### Text

| Token name | Hex | Tailwind utilities |
|---|---|---|
| `cream` | `#f4f1e8` | `text-cream` |
| `sage` | `#7fb89c` | `text-sage` |
| `sage-light` | `#9ed7bd` | `text-sage-light` |
| `sage-muted` | `#8fbfa8` | `text-sage-muted` |

`cream` for primary content text on dark backgrounds. `sage` / `sage-muted` for
secondary labels and helper text.

---

## Elevation & shadows

All shadows are design tokens in `@theme`. Never write a raw `box-shadow` value in
a component.

### Hard-offset button shadows

The "chunky" look uses a flat, coloured offset with no blur — like a physical
offset stamp. These are for interactive elements (buttons, pills, badges).

| Token | Value | Tailwind utility | Use for |
|---|---|---|---|
| `shadow-hard-ink` | `0 4px 0 #0c2418` | `shadow-hard-ink` | Default interactive elements |
| `shadow-hard-ink-sm` | `0 3px 0 #0c2418` | `shadow-hard-ink-sm` | Smaller controls (stepper buttons) |
| `shadow-hard-gold` | `0 4px 0 #ad7a04` | `shadow-hard-gold` | Gold/primary CTAs |
| `shadow-hard-gold-lg` | `0 6px 0 #ad7a04` | `shadow-hard-gold-lg` | Large primary CTAs |
| `shadow-hard-red` | `0 4px 0 #b32e2e` | `shadow-hard-red` | Destructive/cancel buttons |
| `shadow-pill` | `0 5px 0 #061710` | `shadow-pill` | Status pills and straddled labels |

### Panel & container shadows

These use diffuse outer glow plus an inner top-edge highlight to give depth.

| Token | Value | Tailwind utility | Use for |
|---|---|---|---|
| `shadow-card` | `0 6px 0 rgba(0,0,0,.22)` | `shadow-card` | Compact cards (player rows, aside items) |
| `shadow-panel` | `0 16px 36px rgba(0,0,0,.35), inset 0 2px 0 rgba(255,255,255,.04)` | `shadow-panel` | Side panels, rail asides |
| `shadow-tablecard` | `0 20px 44px rgba(0,0,0,.42), inset 0 2px 0 rgba(255,255,255,.06)` | `shadow-tablecard` | The center content card (Table Settings) |
| `shadow-modal` | `0 26px 60px rgba(0,0,0,.55), inset 0 2px 0 rgba(255,255,255,.06)` | `shadow-modal` | Full modals |
| `shadow-popout` | `0 22px 50px rgba(0,0,0,.5), inset 0 2px 0 rgba(255,255,255,.06)` | `shadow-popout` | Popout menus anchored to a trigger |

---

## Radii & shape

Use rounded classes from the Tailwind scale plus the custom `rounded-pill` token.

| Class | Radius | Use for |
|---|---|---|
| `rounded-xl` | 12px | Small controls, avatar image borders |
| `rounded-2xl` | 16px | Stepper rows, stat tiles, player row buttons, nav tabs |
| `rounded-3xl` | 24px | Aside panels |
| `rounded-[26px]` | 26px | Modal container |
| `rounded-[28px]` | 28px | Large content card (Table Settings) |
| `rounded-pill` | 999px | Status badges, pills, scrollbar thumbs — anything that should be fully rounded |

---

## Components

### Chunky button

The primary interaction element: solid fill, hard offset shadow, presses down on
`:active`.

```html
<!-- Gold primary CTA -->
<button class="rounded-2xl border-[3px] border-gold-border bg-gold
               px-6 py-[18px] font-display text-[21px] font-semibold
               text-[#2a1c00] shadow-hard-gold-lg
               transition-transform hover:-translate-y-px active:translate-y-1
               disabled:cursor-not-allowed disabled:opacity-50">
  Start Game
</button>

<!-- Red destructive button -->
<button class="rounded-2xl border-[2.5px] border-red-border bg-red
               px-6 py-[15px] font-display text-base font-semibold
               text-white shadow-hard-red active:translate-y-[3px]">
  Cancel
</button>

<!-- Ink (neutral) button -->
<button class="rounded-xl border-[2.5px] border-ink bg-felt-300
               font-display text-2xl leading-none text-cream
               shadow-hard-ink-sm active:translate-y-0.5">
  −
</button>
```

Key recipe: `border-[color]` + matching `bg` + `shadow-hard-*` + `active:translate-y-*`.
The translation on `:active` simulates the shadow collapsing.

### Panel / aside card

Side panels use a semi-transparent background with the panel shadow and a
strong border:

```html
<aside class="rounded-3xl border-[2.5px] border-black/30 bg-felt-900/55 shadow-panel">
  ...
</aside>
```

The center content card uses a slightly higher-elevation treatment:

```html
<div class="rounded-[28px] border-[2.5px] border-black/30 bg-felt-500 shadow-tablecard">
  ...
</div>
```

### Pill / badge

Status labels and straddled headings:

```html
<!-- Status pill (mint = Ready, gold = In Lobby, blue = In-Game) -->
<span class="inline-flex items-center gap-1.5 rounded-pill
             px-2.5 py-1 text-[11px] font-extrabold
             bg-mint/15 text-mint-bright">
  <span class="h-2 w-2 rounded-pill bg-mint" />
  Ready
</span>

<!-- Straddled label pill (sits at the top of the card) -->
<div class="absolute left-1/2 top-0.5 z-[4]
            -translate-x-1/2 flex items-center gap-2.5
            rounded-pill border-[2.5px] border-ink bg-felt-800
            py-2 pl-[18px] pr-2.5 shadow-pill">
  <span class="font-display text-[13px] font-semibold tracking-[0.12em] text-[#cfeadd]">
    READY STATUS
  </span>
  ...
</div>
```

### Stepper row

A labeled row containing − / value / + controls:

```html
<div class="flex items-center justify-between gap-3.5
            rounded-2xl border-2 border-black/30 bg-felt-600
            py-[15px] pl-[22px] pr-4">
  <div class="flex flex-col leading-tight">
    <span class="text-xs font-extrabold tracking-[0.12em] text-sage">BUY-IN</span>
    <span class="mt-[3px] font-display text-[15px] font-semibold text-sage-light">
      Chips to sit down
    </span>
  </div>
  <div class="flex items-center gap-3">
    <button aria-label="Decrease buy-in" ...>−</button>
    <span class="min-w-[78px] text-center font-display text-[26px] font-bold text-gold">
      3,000
    </span>
    <button aria-label="Increase buy-in" ...>+</button>
  </div>
</div>
```

Always provide `aria-label` on the − and + buttons — tests match on them.
When `canEditConfig` is false, replace the stepper controls with the plain value span.

### Stat tile

`StatTile` from `packages/client/src/lobby/StatTile.tsx`:

```tsx
<StatTile label="WIN RATE" value="58%" />
<StatTile label="HANDS WON" value={null} />  {/* renders — */}
<StatTile label="BIGGEST POT" value="12,500" accent="#ffc63d" />
```

Structure:

```html
<div class="rounded-2xl border-2 border-black/30 bg-felt-600 p-4">
  <div class="font-display text-2xl font-bold text-cream">58%</div>
  <div class="mt-1 text-[11px] font-extrabold tracking-[0.08em] text-sage">WIN RATE</div>
</div>
```

Always pass `null` (never `undefined`) when data is unavailable; the component
renders `—` (em-dash, U+2014).

### Modal

Full overlay modal, animated with `animate-pop`:

```html
<!-- Backdrop -->
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
     onClick={onClose}>
  <!-- Card — stop propagation so clicks inside don't dismiss -->
  <div class="animate-pop relative w-full max-w-sm rounded-[26px]
              border-[2.5px] border-black/30 bg-felt-800 p-7 shadow-modal"
       onClick={e => e.stopPropagation()}>
    ...
  </div>
</div>
```

The `animate-pop` animation (`rpn-pop` keyframe: scale 0.92→1, translateY 6px→0,
opacity 0→1, 0.18s with overshoot easing) is defined in `index.css` and used for
all modals and popouts that appear on user interaction.

### Popout

Anchored panel, animated with `animate-fade`:

```html
<div class="animate-fade absolute right-4 top-full z-40 mt-2
            w-[340px] rounded-[26px] border-[2.5px] border-black/30
            bg-felt-800 shadow-popout overflow-hidden">
  ...
</div>
```

`animate-fade` (`rpn-fade`: opacity 0→1, 0.15s ease) is subtler than `animate-pop`
and suits anchored panels that don't need an entry bounce.

---

## Interaction conventions

| State | Class recipe |
|---|---|
| Hover lift (buttons, rows) | `transition-transform hover:-translate-y-px` |
| Hover slide (player rows) | `transition-transform hover:translate-x-0.5 hover:bg-white/10` |
| Active press (button shadow collapse) | `active:translate-y-[3px]` (large) or `active:translate-y-0.5` (small) |
| Disabled | `disabled:opacity-50 disabled:cursor-not-allowed` |
| Focus ring | Inherited browser default; do not remove `outline` without an equivalent |

The lift and press amounts are intentionally asymmetric (lift 1px, press 3px for
large CTAs) to make the animation feel snappy rather than mechanical.

---

## Layout

### 3-column lobby grid

The lobby uses a `flex` row at the page level with three regions:

```
┌──────────────────────────────────────────────────────┐
│  Header (flex-none, full-width)                      │
├─────────────┬─────────────────────┬──────────────────┤
│ PlayersPanel│  Center (main)      │  RecentActivity  │
│ (left aside)│  flex-1, scrollable │  (right rail)    │
│  ~270px     │                     │  hidden < 1080px │
└─────────────┴─────────────────────┴──────────────────┘
```

Skeleton:

```html
<div class="flex h-full flex-col felt-bg font-body text-cream overflow-hidden">
  <Header ... />
  <main class="flex min-h-0 flex-1 gap-5 overflow-hidden px-5 pb-5">
    <PlayersPanel ... />
    <div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <!-- Tab content -->
    </div>
    <RecentActivity class="hidden rail:flex" />
  </main>
</div>
```

### `rail:` breakpoint

The custom breakpoint `--breakpoint-rail: 1080px` generates the `rail:` variant
prefix in Tailwind v4. Use `hidden rail:flex` (or `hidden rail:block`) to hide the
right rail at narrow widths:

```html
<aside class="hidden rail:flex ...">
  <!-- RecentActivity -->
</aside>
```

Do not use `xl:` for this purpose — `xl:` is 1280px, not 1080px.

---

## Building a new page — checklist

1. **Root element** — apply `felt-bg font-body text-cream` to the outermost container;
   ensure it fills its height (`h-full` or `min-h-screen`).
2. **Compose from existing components** — prefer `StatTile`, `PlayerRow`, stepper,
   pill patterns above before writing bespoke markup.
3. **Colors** — pull every color from a token (`text-gold`, `bg-felt-600`, etc.).
   Never add a raw hex literal to a component class or inline style. If a new color
   is genuinely required, add it to `@theme` in `index.css` first.
4. **Shadows** — use a named shadow token (`shadow-panel`, `shadow-hard-ink`, etc.).
   Never write a raw `box-shadow` value in a component.
5. **Radii** — use the family above (`rounded-2xl`, `rounded-pill`, etc.). Match the
   surrounding context (panels use `rounded-3xl`; interactive rows use `rounded-2xl`).
6. **Host-only controls** — gate config-editing controls behind `canEditConfig` (or
   equivalent); read-only users see the value but not the steppers.
7. **Missing data** — always pass `null` to `StatTile` when a value is unavailable;
   never pass `undefined` or an empty string.
8. **Animations** — use `animate-pop` for modals/overlays; `animate-fade` for
   anchored panels and tooltips.
9. **Responsive** — hide right-rail content below 1080px using `hidden rail:flex`.
10. **Tests** — add a Vitest + RTL test for any component that contains logic (status
    mapping, stepper arithmetic, conditional rendering). Pure presentational
    components that render only tokens/text do not require tests.
