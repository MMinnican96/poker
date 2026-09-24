/**
 * Table geometry. Pure functions: given the stage size and seat count, where the
 * felt, the seats (avatar, name plate, cards), the bets, the dealer button and
 * the pot/board cluster go. Everything is in stage pixels.
 *
 * Seats sit on the rail of an oval, spaced evenly along its edge (not by angle,
 * which would bunch seats at the narrow ends). Display slot 0 is bottom-centre
 * and slots go clockwise on screen (bottom → left → top → right), which is the
 * direction the action moves.
 *
 * Every piece is modelled as a rectangle so the layout can check itself: the
 * centre cluster is placed in the free band between the seats, shown cards,
 * bets and the button are placed by searching for a spot that overlaps
 * nothing, and when a size doesn't fit the whole table is laid out again
 * smaller (and, on short screens, in a compact form). `layoutConflicts` reports
 * anything that still overlaps; the tests keep it at zero for the supported
 * screen sizes.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Slot extends Point {
  /** Eccentric angle on the seat oval (π/2 = bottom, π = left). */
  theta: number;
  /** The avatar. */
  avatar: Rect;
  /** The status pill and name plate hanging under the avatar. */
  plate: Rect;
  /** Where a player's two cards go when they're shown (or your own, for slot 0). */
  cards: Rect;
  /** The shown cards sit above the avatar rather than beside it. */
  cardsAbove: boolean;
  /** The small face-down cards peeking behind the avatar. */
  backs: Rect;
  /** Centre of the "+1,200" pill when this seat wins. */
  winPill: Point;
  /** Centre of this seat's bet. */
  bet: Point;
  /** Centre of the dealer button when it's this seat's. */
  button: Point;
}

/** Sizes that hang off the avatar size (mirrored by `Seat`). */
export interface SeatMetrics {
  /** Name plate width. */
  plateW: number;
  /** Top of the status pill, relative to the avatar centre. */
  pillTop: number;
  /** Top of the name plate (with a status pill above it), relative to the avatar centre. */
  plateTop: number;
  /** Bottom of the name plate, relative to the avatar centre. */
  plateBottom: number;
  plateTopPad: number;
  nameFont: number;
  stackFont: number;
  tagFont: number;
  statusFont: number;
  winFont: number;
}

export interface StageLayout {
  width: number;
  height: number;
  /** Tall screens stand the oval on its end. */
  portrait: boolean;
  /**
   * Short screens: one-line name plates, no hand label on the plate, a
   * one-line-per-pot result and smaller cards.
   */
  compact: boolean;
  /** The felt box including its rail. */
  felt: { x: number; y: number; w: number; h: number };
  /** Centre of the felt. */
  cx: number;
  cy: number;
  /** Radii of the oval the seats sit on (the outer rail edge). */
  rx: number;
  ry: number;
  /** Avatar diameter; every seat measurement scales from this. */
  avatar: number;
  seat: SeatMetrics;
  /** Width of a board card. */
  boardCard: number;
  /** Gap between board cards. */
  boardGap: number;
  /** Width of your own hole cards. */
  heroCard: number;
  /** Width of an opponent's face-down cards. */
  seatCard: number;
  /** Width of an opponent's cards when shown. */
  shownCard: number;
  /** Font size for the pot and the result lines. */
  potFont: number;
  /** One slot per seat, by display index. */
  slots: Slot[];
  /** The five board cards. */
  boardRow: Rect;
  /** The pot / result lines, bottom-anchored just above the board (grows upward to its top). */
  potZone: Rect;
  /** Side-pot breakdown under the board. */
  breakdown: Rect;
  /** Everything in the middle: pot zone, board and breakdown. Nothing else may sit here. */
  board: Rect;
  /** Size of a bet marker (chips + amount) and of the dealer button. */
  betSize: { w: number; h: number };
  buttonSize: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function rectAt(cx: number, cy: number, w: number, h: number): Rect {
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
}

/** Do two rectangles overlap (touching doesn't count)? `pad` grows the test on every side. */
export function intersects(a: Rect, b: Rect, pad = 0): boolean {
  return a.left < b.right + pad && b.left < a.right + pad && a.top < b.bottom + pad && b.top < a.bottom + pad;
}

function overlapArea(a: Rect, b: Rect, pad = 0): number {
  // Grow `a` by `pad` on every side, then intersect.
  const w = Math.min(a.right + pad, b.right) - Math.max(a.left - pad, b.left);
  const h = Math.min(a.bottom + pad, b.bottom) - Math.max(a.top - pad, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Area of `r` outside the stage. */
function outside(r: Rect, W: number, H: number): number {
  const w = r.right - r.left;
  const h = r.bottom - r.top;
  const iw = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0));
  const ih = Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
  return w * h - iw * ih;
}

/**
 * Where a seat is drawn: rotated so `anchorSeat` (yours when seated, else seat
 * 0) is display slot 0 at the bottom.
 */
export function displayIndex(seat: number, anchorSeat: number, maxSeats: number): number {
  return (((seat - anchorSeat) % maxSeats) + maxSeats) % maxSeats;
}

/**
 * Eccentric angles for `n` points evenly spaced by arc length around an
 * ellipse with radii (rx, ry), starting at the bottom and going clockwise on
 * screen (increasing angle with y pointing down).
 */
export function ellipseSlotAngles(n: number, rx: number, ry: number, steps = 720): number[] {
  if (n <= 0) return [];
  const start = Math.PI / 2;
  const cum: number[] = [0];
  let prev = { x: rx * Math.cos(start), y: ry * Math.sin(start) };
  for (let i = 1; i <= steps; i++) {
    const t = start + (i / steps) * 2 * Math.PI;
    const p = { x: rx * Math.cos(t), y: ry * Math.sin(t) };
    cum.push(cum[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  const total = cum[steps];
  const out: number[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (j < steps && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j];
    const frac = seg > 0 ? (target - cum[j]) / seg : 0;
    out.push(start + ((j + frac) / steps) * 2 * Math.PI);
  }
  return out;
}

/** Seat measurements for an avatar of `s` px. */
export function seatMetrics(s: number, compact: boolean): SeatMetrics {
  const nameFont = Math.max(11, Math.min(14, s * 0.29));
  const stackFont = Math.max(11, Math.min(16, s * 0.32));
  const tagFont = Math.max(10, Math.min(13, s * 0.26));
  const statusFont = Math.max(10, Math.min(13, s * 0.27));
  const winFont = Math.max(12, s * 0.3);
  const pillTop = s / 2 - Math.max(8, s * 0.2);
  const plateTop = s / 2 + Math.max(6, s * 0.16);
  const plateTopPad = Math.max(4, s * 0.1);
  // pad + name + stack (+ title / hand label) + bottom pad and ring
  const body = compact
    ? Math.max(nameFont, stackFont) * 1.3 + 3
    : nameFont * 1.25 + stackFont * 1.2 + tagFont * 1.35 + 4 + 3;
  return {
    plateW: compact ? Math.max(80, s * 2.4) : Math.max(64, s * 2.25),
    pillTop,
    plateTop,
    plateBottom: plateTop + plateTopPad + body,
    plateTopPad,
    nameFont,
    stackFont,
    tagFont,
    statusFont,
    winFont,
  };
}

interface Variant {
  compact: boolean;
  /** Scale on the natural avatar and board-card sizes. */
  k: number;
}

const LATERALS = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.4, -2.4, 3, -3, 3.6, -3.6];

const VARIANTS: Variant[] = [
  { compact: false, k: 1 },
  { compact: false, k: 0.92 },
  { compact: false, k: 0.84 },
  { compact: true, k: 1 },
  { compact: true, k: 0.92 },
  { compact: true, k: 0.84 },
  { compact: true, k: 0.76 },
  { compact: true, k: 0.68 },
];

/** Lay out the table for a stage of `width` × `height` px. */
export function stageLayout(width: number, height: number, maxSeats: number): StageLayout {
  let best: { layout: StageLayout; score: number } | null = null;
  for (const v of VARIANTS) {
    const layout = buildLayout(width, height, maxSeats, v);
    const score = layoutConflicts(layout).reduce((n, c) => n + c.area, 0);
    if (score === 0) return layout;
    if (!best || score < best.score - 0.5) best = { layout, score };
  }
  return best!.layout;
}

function buildLayout(width: number, height: number, maxSeats: number, v: Variant): StageLayout {
  const W = Math.max(200, width);
  const H = Math.max(160, height);
  const portrait = H > W * 1.15;
  const { compact, k } = v;

  const natural = portrait ? clamp(Math.min(W / 7.6, H / 12), 30, 56) : clamp(Math.min(W / 13, H / 6.8), 28, 60);
  const avatar = Math.round(Math.max(24, natural * k));
  const seat = seatMetrics(avatar, compact);
  const below = seat.plateBottom; // how far a seat reaches below its centre
  const padX = portrait ? Math.max(avatar * 1.2, seat.plateW / 2 + 4) : avatar * 1.3;
  const padTop = avatar * (portrait ? 1.0 : 0.9);
  const padBottom = Math.max(avatar * (portrait ? 1.55 : 1.6), below + 4);

  const availW = Math.max(80, W - 2 * padX);
  const availH = Math.max(60, H - padTop - padBottom);
  // Aspect (w / h) of the felt may flex inside a range to use the space well.
  const [minA, maxA] = portrait ? [0.5, 0.78] : [1.65, 2.5];
  let fw = availW;
  let fh = clamp(availH, fw / maxA, fw / minA);
  if (fh > availH) {
    fh = availH;
    fw = Math.min(availW, fh * maxA);
  }
  const fx = (W - fw) / 2;
  const fy = padTop + (availH - fh) / 2;
  const cx = fx + fw / 2;
  const cy = fy + fh / 2;
  const rx = fw / 2;
  const ry = fh / 2;
  const rail = fw * 0.035;

  const naturalBoard = portrait ? clamp(fw * 0.14, 26, 60) : clamp(Math.min(fw * 0.074, fh * 0.2), 26, 72);
  const boardCard = Math.round(Math.max(22, naturalBoard * (compact ? Math.min(k, 0.9) : k)));
  const boardGap = Math.max(3, Math.round(boardCard * 0.08));
  const heroCard = Math.round(compact ? clamp(avatar * 1.0, 30, 60) : clamp(avatar * 1.2, 36, 84));
  const seatCard = Math.round(clamp(avatar * 0.5, 16, 30));
  const shownCard = Math.round(compact ? clamp(avatar * 0.66, 20, 36) : clamp(avatar * 0.74, 22, 46));
  const potFont = Math.max(12, Math.min(18, boardCard * 0.3));

  // --- Seats: avatar, plate, the small backs --------------------------------
  const angles = ellipseSlotAngles(maxSeats, rx, ry);
  const s = avatar;
  const base = angles.map((theta) => {
    const x = cx + rx * Math.cos(theta);
    const y = cy + ry * Math.sin(theta);
    return {
      theta,
      x,
      y,
      avatar: rectAt(x, y, s, s),
      plate: { left: x - seat.plateW / 2, top: y + seat.pillTop, right: x + seat.plateW / 2, bottom: y + seat.plateBottom },
      backs: { left: x, top: y - s * 0.72, right: x + seatCard * 1.5, bottom: y - s * 0.72 + seatCard * 1.45 },
    };
  });
  // Your own cards (slot 0), fanned to the right of your avatar.
  const heroBox = (x: number, y: number): Rect => {
    const w = heroCard * 1.72 + heroCard * 0.12;
    const h = heroCard * 1.4 + heroCard * 0.1;
    const bottom = y + s / 2 + s * 0.18;
    return { left: x + s * 0.12, top: bottom - h, right: x + s * 0.12 + w, bottom };
  };

  // --- The middle: pot zone, board, breakdown --------------------------------
  const boardW = boardCard * 5 + boardGap * 4;
  const boardH = Math.round(boardCard * 1.4);
  const zoneGap = Math.max(4, Math.round(boardCard * 0.12));
  const lineH = potFont * 1.25;
  const labelH = potFont * 0.85 * 1.25;
  // Normal: up to two pots, each a line and a hand label. Compact: one line per pot, or a line and a label.
  const potZoneH = Math.ceil(compact ? lineH * 2 + 2 : (lineH + labelH) * 2 + 4);
  const breakdownH = compact ? 0 : 20;
  const clusterW = Math.max(boardW, compact ? boardW : Math.min(boardW + boardCard, fw * 0.6));
  const clusterH = potZoneH + zoneGap + boardH + (breakdownH ? zoneGap + breakdownH : 0);
  const clusterAt = (top: number) => ({
    potZone: { left: cx - clusterW / 2, top, right: cx + clusterW / 2, bottom: top + potZoneH },
    boardRow: { left: cx - boardW / 2, top: top + potZoneH + zoneGap, right: cx + boardW / 2, bottom: top + potZoneH + zoneGap + boardH },
    breakdown: {
      left: cx - clusterW / 2,
      top: top + potZoneH + zoneGap * 2 + boardH,
      right: cx + clusterW / 2,
      bottom: top + potZoneH + zoneGap * 2 + boardH + breakdownH,
    },
    board: { left: cx - clusterW / 2, top, right: cx + clusterW / 2, bottom: top + clusterH },
  });
  // Seat parts the cluster must avoid.
  const fixed: Rect[] = [];
  base.forEach((b, i) => {
    fixed.push(b.avatar, b.plate);
    if (i === 0) fixed.push(heroBox(b.x, b.y));
  });
  // Try positions from the natural one (board a touch below the middle) outward; keep the first that's clear.
  const natTop = cy + boardCard * 0.12 - (potZoneH + zoneGap + boardH / 2);
  let clusterTop = natTop;
  let bestHit = Infinity;
  const stepY = Math.max(2, fh / 60);
  for (let i = 0; i <= 40; i++) {
    const off = (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * stepY;
    const top = natTop + off;
    if (top < fy + rail || top + clusterH > fy + fh - rail) continue;
    const r = clusterAt(top).board;
    const hit = fixed.reduce((n, f) => n + overlapArea(r, f, 6), 0);
    if (hit < bestHit - 0.5) {
      bestHit = hit;
      clusterTop = top;
    }
    if (hit === 0) break;
  }
  const cluster = clusterAt(clusterTop);
  const board = cluster.board;
  const ccy = (board.top + board.bottom) / 2;

  // --- Shown cards: beside the avatar toward the middle, else above, else outward.
  const cw = shownCard * 1.82 + 2;
  const ch = shownCard * 1.4 + 2;
  const chosen: Rect[] = [];
  const cardsFor = base.map((b, i) => {
    if (i === 0) {
      const r = heroBox(b.x, b.y);
      chosen.push(r);
      return { rect: r, above: false };
    }
    const toward = Math.abs(b.x - cx) < s * 0.5 ? 1 : b.x > cx ? -1 : 1;
    const beside = (side: number): Rect => {
      const bottom = b.y + seat.pillTop;
      const left = side > 0 ? b.x + s * 0.48 : b.x - s * 0.48 - cw;
      return { left, top: bottom - ch, right: left + cw, bottom };
    };
    const aboveRect = (): Rect => {
      const bottom = b.y - s / 2 + s * 0.12;
      const mid = b.x + toward * s * 0.2;
      return { left: mid - cw / 2, top: bottom - ch, right: mid + cw / 2, bottom };
    };
    const options: { rect: Rect; above: boolean }[] = [
      { rect: beside(toward), above: false },
      { rect: aboveRect(), above: true },
      { rect: beside(-toward), above: false },
    ];
    const others = base.flatMap((o, j) => (j === i ? [] : [o.avatar, o.plate])).concat(chosen);
    let pick = options[0];
    let pickHit = Infinity;
    for (const o of options) {
      const hit =
        overlapArea(o.rect, board, 6) * 4 +
        others.reduce((n, r) => n + overlapArea(o.rect, r, 2), 0) +
        outside(o.rect, W, H) * 4;
      if (hit < pickHit - 0.5) {
        pickHit = hit;
        pick = o;
      }
      if (hit === 0) break;
    }
    chosen.push(pick.rect);
    return pick;
  });

  // Winner pill: above the avatar (or above cards stacked above it), kept on stage.
  const winH = seat.winFont * 1.35;
  const winW = seat.winFont * 3.6 + 16;
  const winPills = base.map((b, i) => {
    const c = cardsFor[i];
    const bottom = (c.above ? c.rect.top : b.y - s / 2) - 3;
    const y = Math.max(winH / 2 + 2, bottom - winH / 2);
    // If it would sit on the cards beside the avatar (your own fan up to the
    // right; a top seat's pill is pushed down level with them), slide it off
    // to the other side.
    let x = b.x;
    if (!c.above && intersects(rectAt(x, y, winW, winH), c.rect, 1)) {
      x = c.rect.left >= b.x ? c.rect.left - 2 - winW / 2 : c.rect.right + 2 + winW / 2;
    }
    return { x, y };
  });

  // --- Bets and the button ----------------------------------------------------
  const g = Math.max(13, Math.round(s * 0.34));
  const betFont = Math.max(11, Math.min(14, s * 0.3));
  // Chips, a gap and the amount ("12.5K"; "BB 50" outside compact mode).
  const betSize = { w: g + 4 + betFont * 0.52 * (compact ? 5 : 6.5) + 12, h: Math.max(g + 6, betFont * 1.4) };
  const buttonSize = Math.max(16, Math.round(s * 0.42));
  const irx = rx - rail - 2;
  const iry = ry - rail - 2;
  const onFelt = (r: Rect) =>
    [
      [r.left, r.top],
      [r.right, r.top],
      [r.left, r.bottom],
      [r.right, r.bottom],
    ].every(([px, py]) => ((px - cx) / irx) ** 2 + ((py - cy) / iry) ** 2 <= 1);

  const seatParts: Rect[] = [];
  base.forEach((b, i) => seatParts.push(b.avatar, b.plate, b.backs, cardsFor[i].rect));
  const pillRects = winPills.map((p) => rectAt(p.x, p.y, winW, winH));

  /** Candidate spots from a seat toward the middle, nearest and most direct first. */
  const candidates = (from: Point): Point[] => {
    const vx = cx - from.x;
    const vy = ccy - from.y;
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len;
    const uy = vy / len;
    const out: { p: Point; cost: number }[] = [];
    for (let d = s * 0.6; d <= len + s; d += s * 0.15) {
      for (const lat of LATERALS) {
        const l = lat * s;
        out.push({ p: { x: from.x + ux * d - uy * l, y: from.y + uy * d + ux * l }, cost: d + Math.abs(l) * 0.8 });
      }
    }
    return out.sort((a, b) => a.cost - b.cost).map((c) => c.p);
  };
  const place = (cands: Point[], w: number, h: number, obstacles: Rect[]): Point => {
    let pick = cands[0];
    let pickHit = Infinity;
    for (const p of cands) {
      const r = rectAt(p.x, p.y, w, h);
      const hit = (onFelt(r) ? 0 : 1e6) + obstacles.reduce((n, o) => n + overlapArea(r, o, 3), 0);
      if (hit === 0) return p;
      if (hit < pickHit) {
        pickHit = hit;
        pick = p;
      }
    }
    return pick;
  };

  const bets: Point[] = [];
  const betRects: Rect[] = [];
  base.forEach((b) => {
    const p = place(candidates(b), betSize.w, betSize.h, [board, ...seatParts, ...betRects]);
    bets.push(p);
    betRects.push(rectAt(p.x, p.y, betSize.w, betSize.h));
  });
  const buttons = base.map((b, i) => {
    const bet = bets[i];
    const toCentre = bet.x > cx ? -1 : 1;
    const dx = betSize.w / 2 + buttonSize / 2 + 4;
    const dy = betSize.h / 2 + buttonSize / 2 + 4;
    const near: Point[] = [
      { x: bet.x + toCentre * dx, y: bet.y },
      { x: bet.x - toCentre * dx, y: bet.y },
      { x: bet.x, y: bet.y + (b.y > ccy ? -dy : dy) },
      { x: bet.x, y: bet.y - (b.y > ccy ? -dy : dy) },
    ];
    return place(near.concat(candidates(b)), buttonSize, buttonSize, [board, ...seatParts, ...pillRects, ...betRects]);
  });

  const slots: Slot[] = base.map((b, i) => ({
    theta: b.theta,
    x: b.x,
    y: b.y,
    avatar: b.avatar,
    plate: b.plate,
    backs: b.backs,
    cards: cardsFor[i].rect,
    cardsAbove: cardsFor[i].above,
    winPill: winPills[i],
    bet: bets[i],
    button: buttons[i],
  }));

  return {
    width: W,
    height: H,
    portrait,
    compact,
    felt: { x: fx, y: fy, w: fw, h: fh },
    cx,
    cy,
    rx,
    ry,
    avatar,
    seat,
    boardCard,
    boardGap,
    heroCard,
    seatCard,
    shownCard,
    potFont,
    slots,
    boardRow: cluster.boardRow,
    potZone: cluster.potZone,
    breakdown: cluster.breakdown,
    board,
    betSize,
    buttonSize,
  };
}

export interface LayoutConflict {
  what: string;
  area: number;
}

/**
 * Everything in the layout that overlaps something it shouldn't, or leaves the
 * stage. Empty for a clean layout.
 */
export function layoutConflicts(l: StageLayout): LayoutConflict[] {
  const out: LayoutConflict[] = [];
  const add = (what: string, area: number) => {
    // Ignore sub-pixel touches.
    if (area > 2) out.push({ what, area });
  };
  const bet = (sl: Slot) => rectAt(sl.bet.x, sl.bet.y, l.betSize.w, l.betSize.h);
  const btn = (sl: Slot) => rectAt(sl.button.x, sl.button.y, l.buttonSize, l.buttonSize);
  const winH = l.seat.winFont * 1.35;
  const pill = (sl: Slot) => rectAt(sl.winPill.x, sl.winPill.y, l.seat.winFont * 3.6 + 16, winH);
  l.slots.forEach((a, i) => {
    const parts: [string, Rect][] = [
      ['avatar', a.avatar],
      ['plate', a.plate],
      ['cards', a.cards],
      ['win pill', pill(a)],
    ];
    for (const [name, r] of parts) {
      add(`seat ${i} ${name} / board`, overlapArea(r, l.board, 2));
      if (name !== 'win pill') add(`seat ${i} ${name} off stage`, outside(r, l.width, l.height));
    }
    add(`seat ${i} bet / board`, overlapArea(bet(a), l.board, 2));
    add(`seat ${i} button / board`, overlapArea(btn(a), l.board, 2));
    add(`seat ${i} bet / own button`, overlapArea(bet(a), btn(a)));
    l.slots.forEach((b, j) => {
      const theirs: [string, Rect][] = [
        ['avatar', b.avatar],
        ['plate', b.plate],
        ['cards', b.cards],
      ];
      for (const [name, r] of theirs) {
        add(`seat ${i} bet / seat ${j} ${name}`, overlapArea(bet(a), r));
        add(`seat ${i} button / seat ${j} ${name}`, overlapArea(btn(a), r));
      }
      add(`seat ${i} button / seat ${j} win pill`, overlapArea(btn(a), pill(b)));
      // A winner's pill mustn't hide anyone's cards (their own included) or a name plate.
      add(`seat ${i} win pill / seat ${j} cards`, overlapArea(pill(a), b.cards));
      if (j !== i) add(`seat ${i} win pill / seat ${j} plate`, overlapArea(pill(a), b.plate));
      if (j === i) return;
      add(`seat ${i} bet / seat ${j} button`, overlapArea(bet(a), btn(b)));
      if (j < i) return;
      add(`seat ${i} bet / seat ${j} bet`, overlapArea(bet(a), bet(b)));
      for (const [n1, r1] of parts.slice(0, 3)) {
        for (const [n2, r2] of theirs) add(`seat ${i} ${n1} / seat ${j} ${n2}`, overlapArea(r1, r2));
      }
    });
  });
  return out;
}

/** Where a seat's bet sits: in front of the seat, clear of every seat and of the middle. */
export function betPoint(_layout: StageLayout, slot: Slot): Point {
  return slot.bet;
}

/** Where the dealer button sits for a seat: beside its bet, clear of everything else. */
export function buttonPoint(_layout: StageLayout, slot: Slot): Point {
  return slot.button;
}
