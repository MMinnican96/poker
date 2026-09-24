import { describe, expect, it } from 'vitest';
import { betPoint, buttonPoint, displayIndex, ellipseSlotAngles, stageLayout } from './layout';

describe('displayIndex', () => {
  it('puts the anchor seat at slot 0 and keeps clockwise order', () => {
    expect(displayIndex(3, 3, 6)).toBe(0);
    expect(displayIndex(4, 3, 6)).toBe(1);
    expect(displayIndex(2, 3, 6)).toBe(5);
    expect(displayIndex(0, 3, 6)).toBe(3);
  });
  it('is the identity for watchers (anchor 0)', () => {
    expect([0, 1, 2, 3, 4].map((s) => displayIndex(s, 0, 5))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('ellipseSlotAngles', () => {
  it('starts at the bottom and spaces two seats bottom and top', () => {
    const [a, b] = ellipseSlotAngles(2, 200, 100);
    expect(a).toBeCloseTo(Math.PI / 2, 5);
    expect(b).toBeCloseTo((3 * Math.PI) / 2, 1);
  });
  it('spaces seats evenly by arc length (neighbours equally far apart)', () => {
    const rx = 400;
    const ry = 180;
    const pts = ellipseSlotAngles(8, rx, ry).map((t) => ({ x: rx * Math.cos(t), y: ry * Math.sin(t) }));
    const gaps = pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return Math.hypot(q.x - p.x, q.y - p.y);
    });
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);
    expect(max / min).toBeLessThan(1.25);
  });
  it('goes clockwise on screen: the second seat is left of the first', () => {
    const [a, b] = ellipseSlotAngles(6, 300, 150);
    expect(300 * Math.cos(b)).toBeLessThan(300 * Math.cos(a));
  });
});

describe('stageLayout', () => {
  it('lays a wide oval out in landscape with slot 0 at the bottom centre', () => {
    const l = stageLayout(1280, 700, 9);
    expect(l.portrait).toBe(false);
    expect(l.felt.w / l.felt.h).toBeGreaterThan(1.6);
    expect(l.slots).toHaveLength(9);
    expect(l.slots[0].x).toBeCloseTo(l.cx, 5);
    expect(l.slots[0].y).toBeGreaterThan(l.cy);
    // Every seat's slot is the lowest-or-highest... the bottom one is the lowest.
    expect(Math.max(...l.slots.map((s) => s.y))).toBeCloseTo(l.slots[0].y, 5);
  });

  it('stands the oval on its end on tall screens', () => {
    const l = stageLayout(390, 700, 6);
    expect(l.portrait).toBe(true);
    expect(l.felt.h).toBeGreaterThan(l.felt.w);
  });

  it('keeps the felt inside the stage at a tight 640×360', () => {
    const l = stageLayout(640, 260, 9);
    expect(l.felt.x).toBeGreaterThanOrEqual(0);
    expect(l.felt.y).toBeGreaterThanOrEqual(0);
    expect(l.felt.x + l.felt.w).toBeLessThanOrEqual(640);
    expect(l.felt.y + l.felt.h).toBeLessThanOrEqual(260);
    for (const s of l.slots) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(640);
    }
  });

  it('puts bets and the button on the felt, between the seat and the middle', () => {
    const l = stageLayout(1200, 640, 6);
    for (const slot of l.slots) {
      const b = betPoint(l, slot);
      const d = buttonPoint(l, slot);
      const inside = (p: { x: number; y: number }) => ((p.x - l.cx) / l.rx) ** 2 + ((p.y - l.cy) / l.ry) ** 2 < 1;
      expect(inside(b)).toBe(true);
      expect(inside(d)).toBe(true);
    }
  });
});
