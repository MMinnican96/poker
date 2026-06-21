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
