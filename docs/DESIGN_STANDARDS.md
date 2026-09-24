# Design standards: the back room

Ratbag Poker Night looks like the rat's card club from the logo: a walnut room,
baize felt, card-stock paper and brass fittings. Surfaces read as materials
(wood grain, cloth, paper) rather than glossy gradients. The one bold element is
the felt, printed with the Ratbag crest like club baize. Motion is kept for game
events and for responses to the player.

This page is the reference for building UI in `packages/client`. Tokens live in
one place, `packages/client/src/index.css` (`@theme`); primitives live in
`src/ui/`; cosmetic renderers live in `src/cosmetics/`.

## Rules

1. **Tokens only.** Every colour, font, shadow and animation in a component
   comes from a token (`bg-walnut-800`, `text-brass`, `shadow-edge-chip`). Write
   no hex values in components. Cosmetic colours (felts, card backs, frames,
   celebrations) come from the shared catalog in `packages/shared/src/shop.ts`
   through `cosmetics/catalog.ts`. The one exception is the monochrome mask
   inside `RatbagCrest`.
2. **Build from `src/ui/` first.** Reach for a primitive before writing a new
   styled element; extend the primitive when it falls short.
3. **Sentence case, plain words** (see [Copy](#copy)).
4. **Accessible by default**: 4.5:1 text contrast, visible focus, full keyboard
   use, reduced motion respected (see [Accessibility](#accessibility)).

## Tokens

### Colour

| Token | Hex | Use |
|---|---|---|
| `walnut-950` | `#120c09` | Deepest wells, input backgrounds, hard shadows |
| `walnut-900` | `#1b130f` | Page background (`body`) |
| `walnut-800` | `#2a1d17` | Default panels (`Surface tone="walnut"`), sidebar |
| `walnut-700` | `#3a2920` | Raised chrome, danger button body |
| `walnut-600` | `#4e382b` | Panel rings, input borders, avatar fallback |
| `walnut-500` | `#6b4f3d` | Scrollbars, dividers |
| `walnut-400` | `#8d6d57` | Placeholders (decorative only, not body text) |
| `baize` | `#1f5b3f` | Felt, game surfaces |
| `baize-light` | `#2b7150` | Felt highlights |
| `baize-deep` | `#0f3526` | Felt shadow, wells on felt |
| `chip` | `#c22328` | Primary action, danger, counts. Card stock on it is 4.76:1. |
| `chip-light` | `#de4046` | Primary hover, timer's last quarter |
| `chip-dark` | `#8a171c` | Chip edge shadow, alert strips |
| `stock` | `#f3e6c8` | Text on dark, paper surfaces |
| `stock-dim` | `#dccca8` | Secondary text on dark |
| `stock-edge` | `#c9b68f` | Paper edges and rings |
| `ink` | `#2b1d15` | Text on paper and on brass buttons |
| `ink-soft` | `#6a5443` | Secondary text on paper |
| `brass` | `#d9a441` | Chips, highlights, placards, secondary buttons |
| `brass-light` | `#efc877` | Brass hover, links on dark, focus |
| `brass-dark` | `#94691f` | Brass edge shadow, screws |
| `ink-brass` | `#4d3829` | Engraved text on brass (4.88:1) |
| `bronze` | `#805a1a` | Third-place plate (5:1 with card stock) |
| `positive` | `#6fc48a` | Wins, gains |
| `negative` | `#ef6a5f` | Losses, errors, invalid inputs |
| `muted` | `#b09a80` | Quiet text on dark |
| `focus` | `#efc877` | Focus outline |
| `suit-red` | `#b8232a` | Hearts and diamonds on card stock |
| `suit-black` | `#1d1612` | Clubs and spades on card stock |

Pairings that pass 4.5:1 and are the defaults: `stock` on any walnut or baize,
`ink` on `stock` and on `brass`, `ink-brass` on `brass`, `stock` on `chip` and
`bronze`. Sign carries meaning twice: winnings get `+` and `positive`, losses
`-` and `negative` (`ChipAmount signed`).

### Type

| Token | Face | Use |
|---|---|---|
| `font-display` | Alfa Slab One | `h1`–`h3`, pot and stack numbers, big chip amounts (`ChipAmount size="lg"/"xl"`), level numbers |
| `font-ui` | Barlow 400–700 | Everything else (body default) |
| `font-condensed` | Barlow Condensed 600–700 | Tight labels: seat plates, badges, initials, tags |

Fonts are self-hosted through `@fontsource` (imported in `main.tsx`); Discord's
Activity CSP blocks external font origins. Numbers that line up use the
`.tabular` class (`ChipAmount` does this for you).

Scale in use (px): 11 (fine print, seat tags), 12 (meta, captions), 13 (small
buttons, secondary text), 14 (`text-sm`), 15 (body and default buttons), 16–17
(large buttons, emphasis), 18 (`text-lg`, panel headings), 20 (`text-xl`),
24 (`text-2xl`, screen titles), 30 (`text-3xl`, hero numbers). The body is 15px
with 1.45 line height; headings are 1.1.

### Shadows, radii, textures

| Token | Use |
|---|---|
| `shadow-edge-chip`, `shadow-edge-brass`, `shadow-edge-walnut` | The hard 3px bottom edge under raised buttons, read as a clay chip's thickness; removed on press |
| `shadow-panel` | Walnut panels |
| `shadow-inset-well` | Recessed wells, inputs, slider track |
| `shadow-felt` | Inner shade on felt |
| `shadow-placard` | Brass plates |
| `shadow-card` | Playing cards, paper surfaces |
| `shadow-lift` | Floating layers (menus, dialogs) |
| `rounded-chip` | Fully round (chips, pills) |
| `tex-wood`, `tex-grain` | SVG noise that makes walnut read as wood and felt/paper read as cloth/paper |
| `lamp-glow` | Warm light pool over the table area |

### Breakpoints and variants

| Name | Where | Use |
|---|---|---|
| `xs` | ≥ 30rem (480px) | Small phone to large phone tweaks |
| `sm` | ≥ 640px | Nav becomes a side rail (bottom tab bar below) |
| `lg` | ≥ 1024px | Room sidebar shown (a drawer below) |
| `xl` | ≥ 1280px | Wider sidebar |
| `short:` | height ≤ 520px | Compact vertical spacing, smaller art (the 640×360 Activity window) |

Feature screens also use container queries (`@container` on `main`).

## Components (`src/ui/`)

Store-free and prop-driven; import from `../ui`.

| Component | Use it for |
|---|---|
| `Button` | Every text button. `primary` (chip red) for the one main action in a view; `brass` for secondary emphasis; `ghost` for neutral alternatives; `danger` for destructive actions; `quiet` for low-priority text actions. Sizes `sm`/`md`/`lg`. `loading` keeps the width and disables it. |
| `IconButton` | Icon-only actions; `label` is required and becomes the accessible name. |
| `Surface` | Any box with a material: `walnut` (default panel), `well` (recessed list or input area), `baize` (game areas), `paper` (card stock with ink text). |
| `Panel` | A `Surface` with a heading row and actions (sidebar blocks, sections). |
| `Modal` | Dialogs. Portal, focus trap, Esc and backdrop close, focus returns to the opener, bottom sheet on narrow screens, body scrolls on short ones. `tone="paper"` for printed things (profile card). `footer` for the action row. |
| `Drawer` | Side sheets (room panel on small screens, table chat). Same focus rules as `Modal`. |
| `Tabs` + `tabPanelProps` | Switching views of one thing (room: chat / people / activity). WAI-ARIA tabs with arrow keys, Home, End. |
| `Segmented` | Picking one value from a few (leaderboard period, blind level). A radio group drawn as chips. |
| `Field`, `TextInput` | Label, control, hint and error wired together by ids. Inputs sit in a walnut well (`.input`). |
| `AmountInput`, `Slider` | Chip amounts: slider plus typed number, clamped and snapped, with optional presets (buy-in, top-up, raise). |
| `ChipAmount`, `ChipGlyph` | Any chip count. `short` for tight spaces (12.3k), `signed` for results. The full amount is always in the accessible label. |
| `Avatar` | Player picture inside their frame cosmetic, initials fallback, optional presence dot. Decorative: put the name next to it. |
| `LevelBadge` | Level as a clay chip; with `progress` the edge becomes an XP ring. |
| `Placard`, `PlacardRow` | Brass sign for table limits and similar fixed facts. |
| `CountBadge` | Chip-red count for unread or unclaimed items; renders nothing at 0. |
| `ToastStack` | Card-stock toasts, top-right under the header (full width on phones). Good and info stay 5 s, bad 8 s; hovering holds one for up to 10 s more. Driven by `app/Toaster`. |
| `EmptyState` | "Nothing here yet". Always say what to do next, usually with one button. |
| `Spinner` | Loading; its `label` is announced. |
| `icons` | 24px-grid stroke icons that inherit `currentColor`, decorative by default. Table-only icons are in `table/icons.tsx`. |

Feature screens sit in `features/common/Screen` (heading row plus content) and
use `Loading` / `LoadError` for first loads and failures.

## Cosmetics (`src/cosmetics/`)

Renderers draw shop items from the shared catalog, sized by props, with a safe
fallback to the free default item when an id is unknown.

| Renderer | Draws |
|---|---|
| `Felt` | The table felt (oval or rectangle) in the item's base, deep, line and rail colours, with the printed crest and racetrack line |
| `CardBack`, `CardBackPattern` | Face-down cards in the owner's pattern; the pattern alone fills the profile card's art window |
| `PlayingCard` | Face-up cards on card stock (`xs` 28px to `xl` 96px); readable at 28px; `highlight` for the winning five, `dim` for the rest |
| `AvatarFrame` | Frame styles (brass, chip, cheese, crown, flames) as SVG in a 100×100 box, 20px to 160px |
| `TitleTag` | A player's title as a small brass name plate |
| `fireCelebration`, `CelebrationPreview` | Win celebrations through canvas-confetti (off under reduced motion), and a static preview for the shop |
| `ItemPreview` | Any item in a square box (shop tiles, pickers) |
| `RatbagCrest` | The crest as a single-colour print for felt, card backs and the favicon |

Other players always see your cosmetics as the catalog draws them: frame on your
avatar, card back on your face-down cards, title under your name, celebration
when you win. The table's felt is the host's pick.

## Copy

- **Sentence case** for everything: headings, buttons, tabs, menu items, toasts
  ("Take a seat", "Leave table", "Top up").
- Buttons say what happens, as a verb: "Buy in for 2,000", "Claim reward".
- Errors say what went wrong and what to do, in one or two sentences, without
  blame or codes: "You don't have enough chips for that buy-in."
- Server ack errors are shown as they arrive, so write them to the same rules.
- Chip amounts use `formatChips` (12,345); tight spaces use `formatChipsShort`
  (12.3k); results use `formatSigned` (+1,200).
- Use "you" for the player. Names are joined as "Alice, Bob and Cara".
- The club voice (cheese, rats, the back room) lives in item names and
  descriptions and the odd empty state. Keep controls and errors plain.

## Motion

- Movement is for game events: dealing, chips moving to the pot and back,
  reveals, wins, emotes and throwables, and small responses to input (a button
  pressing down, a dialog rising).
- UI animations use the tokens `animate-rise`, `animate-fade`,
  `animate-slide-in` under `motion-safe`. Table animations (`tbl-deal`,
  `tbl-board`, `tbl-reveal`, `tbl-pop`, `tbl-emote`, `tbl-splat`,
  `tbl-yourturn`) are defined in `table/table.css` inside
  `prefers-reduced-motion: no-preference`.
- **Reduced motion**: a global rule in `index.css` shortens all animations and
  transitions to effectively zero; nothing flies across the felt (`FxLayer`),
  emotes and splats still appear briefly, and celebrations don't fire. Every
  state must read correctly without its animation.
- Sounds follow the same events and respect the mute and volume settings.

## Accessibility

- **Contrast**: text meets 4.5:1 against its background (large display numbers
  at least 3:1). Check new pairings; the pairings listed under
  [Colour](#colour) already pass. Placeholder brown (`walnut-400`) is only for
  placeholders.
- **Focus**: every interactive element shows the 2px `focus` outline on
  `:focus-visible` (offset 2px). Dialogs and drawers trap focus, close on Esc
  and return focus to the opener. After an action that removes the focused
  element (for example buying an item), move focus somewhere sensible.
- **Keyboard**: everything works without a pointer. Pickers (the felt picker,
  `Segmented`) move with arrow keys; `Tabs` add Home and End; amount inputs step
  with Up and Down; the profit chart's readout follows Left and Right; the
  action bar has
  F (fold), C (check or call), R (raise), Enter to confirm and Esc to cancel,
  ignored while typing in a field or when a dialog is open.
- **Names and roles**: icon buttons have labels; seats have a spoken summary
  (name, stack, status, whose turn); cards have spoken names ("Queen of
  hearts"); chip amounts carry the exact amount; sliders have labels and value
  text.
- **Live updates**: new chat messages, the action bar's state, connection
  problems and form errors use `aria-live` / `role="status"` / `role="alert"`.
- **Colour never alone**: signs, icons or words back up colour (results, turn
  timer, presence).
- **Touch**: controls are at least 32px (`Button sm`), 40px by default.

## Responsive targets

Design and test at these sizes; the table layout tests cover them.

| Target | Size | Notes |
|---|---|---|
| Discord Activity window | 640×360 | The tightest case: `short:` variant, compact table layout, nav rail, room panel in a drawer |
| Phone portrait | 390×844 | Bottom tab bar, the oval stands on end, dialogs as bottom sheets |
| Desktop | 1280×800 and up | Nav rail, room sidebar, full-size table |

The table layout engine (`table/layout.ts`) must report no conflicts for 2 to 9
seats at 1280×800, 640×360, 390×844, 1000×640, 800×450, 360×640 and
1920×1080 (`layout.test.ts`). Other screens scroll inside `main`; the page itself
never scrolls sideways.

## New screen checklist

1. Wrap it in `Screen` and lazy-load it like the other feature screens if it's
   a new section.
2. Build it from `ui/` primitives on a `Surface`; colours and type from tokens.
3. Write the copy in sentence case; errors say what to do next.
4. Give it a loading state, an error state with retry, and an empty state.
5. Check keyboard use, focus order, contrast and reduced motion.
6. Check it at 640×360, 390×844 and desktop.
7. Add React Testing Library tests next to it.
