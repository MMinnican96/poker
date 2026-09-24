/**
 * Table geometry. Pure functions: given the stage size and seat count, where the
 * felt, the seats, the bets and the buttons go. Everything is in stage pixels.
 *
 * Seats sit on the rail of an oval, spaced evenly along its edge (not by angle,
 * which would bunch seats at the narrow ends). Display slot 0 is bottom-centre
 * and slots go clockwise on screen (bottom → left → top → right), which is the
 * direction the action moves.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Slot extends Point {
  /** Eccentric angle on the seat oval (π/2 = bottom, π = left). */
  theta: number;
}

export interface StageLayout {
  width: number;
  height: number;
  /** Tall screens stand the oval on its end. */
  portrait: boolean;
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
  /** Width of a board card. */
  boardCard: number;
  /** Width of your own hole cards. */
  heroCard: number;
  /** Width of an opponent's face-down cards. */
  seatCard: number;
  /** Width of an opponent's cards when shown. */
  shownCard: number;
  /** One slot per seat, by display index. */
  slots: Slot[];
  /** The pot + board area that bets keep out of. */
  board: { left: number; right: number; top: number; bottom: number };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

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

/** Lay out the table for a stage of `width` × `height` px. */
export function stageLayout(width: number, height: number, maxSeats: number): StageLayout {
  const W = Math.max(200, width);
  const H = Math.max(160, height);
  const portrait = H > W * 1.15;

  let avatar: number;
  let padX: number;
  let padTop: number;
  let padBottom: number;
  if (portrait) {
    avatar = Math.round(clamp(Math.min(W / 7.6, H / 12), 30, 56));
    padX = avatar * 1.2;
    padTop = avatar * 1.0;
    padBottom = avatar * 1.55;
  } else {
    avatar = Math.round(clamp(Math.min(W / 13, H / 6.8), 28, 60));
    padX = avatar * 1.3;
    padTop = avatar * 0.9;
    padBottom = avatar * 1.6;
  }

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

  const boardCard = Math.round(
    portrait ? clamp(fw * 0.14, 26, 60) : clamp(Math.min(fw * 0.074, fh * 0.2), 26, 72),
  );
  const heroCard = Math.round(clamp(avatar * 1.2, 36, 84));
  const seatCard = Math.round(clamp(avatar * 0.5, 16, 30));
  const shownCard = Math.round(clamp(avatar * 0.74, 22, 46));

  const slots = ellipseSlotAngles(maxSeats, rx, ry).map((theta) => ({
    theta,
    x: cx + rx * Math.cos(theta),
    y: cy + ry * Math.sin(theta),
  }));

  // Mirrors CenterCluster: pot line above five cards, centred just below the middle.
  const gap = Math.max(3, Math.round(boardCard * 0.08));
  const clusterH = Math.max(22, boardCard * 0.45) + boardCard * 0.12 + boardCard * 1.4;
  const midY = cy + boardCard * 0.12;
  const board = {
    left: cx - (boardCard * 5 + gap * 4) / 2,
    right: cx + (boardCard * 5 + gap * 4) / 2,
    top: midY - clusterH / 2,
    bottom: midY + clusterH / 2,
  };

  return { width: W, height: H, portrait, felt: { x: fx, y: fy, w: fw, h: fh }, cx, cy, rx, ry, avatar, boardCard, heroCard, seatCard, shownCard, slots, board };
}

/** Step from a slot toward the centre by `d` px (never more than `maxFrac` of the way). */
function inward(layout: StageLayout, slot: Slot, d: number, maxFrac: number): { at: Point } {
  const vx = layout.cx - slot.x;
  const vy = layout.cy - slot.y;
  const len = Math.hypot(vx, vy) || 1;
  const t = Math.min(d / len, maxFrac);
  return { at: { x: slot.x + vx * t, y: slot.y + vy * t } };
}

/**
 * Where a seat's bet sits: in front of the seat, clear of its avatar and name
 * plate. Your own bet (bottom seat, cards to the right) sits up and to the left.
 */
export function betPoint(layout: StageLayout, slot: Slot, hero = false): Point {
  const s = layout.avatar;
  if (hero) {
    const { at } = inward(layout, slot, s * 1.35, 0.6);
    return { x: at.x - s * 0.55, y: at.y };
  }
  const { at } = inward(layout, slot, s * 1.85, layout.portrait ? 0.7 : 0.62);
  // The name plate hangs below the avatar; slide the bet out sideways if it lands on it.
  const half = Math.max(32, s * 1.13) + s * 0.75;
  const inPlate = at.y > slot.y + s * 0.3 && at.y < slot.y + s * 1.55 && Math.abs(at.x - slot.x) < half;
  const p = inPlate ? { x: slot.x + (slot.x > layout.cx ? -half : half), y: at.y } : at;
  return clearOfBoard(layout, p, slot);
}

/** Nudge a point (a bet, ~s wide) out of the pot/board area, toward its seat's side. */
function clearOfBoard(layout: StageLayout, p: Point, slot: Slot): Point {
  const b = layout.board;
  const padX = layout.avatar * 0.7;
  const padY = Math.max(16, layout.avatar * 0.4);
  const inside = p.x > b.left - padX && p.x < b.right + padX && p.y > b.top - padY && p.y < b.bottom + padY;
  if (!inside) return p;
  return { x: p.x, y: slot.y < layout.cy ? b.top - padY : b.bottom + padY };
}

/** Where the dealer button sits for a seat: just beside its bet, on the side facing the middle. */
export function buttonPoint(layout: StageLayout, slot: Slot, hero = false): Point {
  const s = layout.avatar;
  const bet = betPoint(layout, slot, hero);
  const toLeft = hero || slot.x > layout.cx + s * 0.5;
  const dx = Math.max(30, s * 0.95);
  return clearOfBoard(layout, { x: bet.x + (toLeft ? -dx : dx), y: bet.y }, slot);
}
