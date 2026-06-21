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
