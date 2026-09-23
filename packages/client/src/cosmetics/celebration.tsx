import confetti from 'canvas-confetti';
import { celebrationVisual } from './catalog';
import { cx } from '../ui/cx';

export interface CelebrationOrigin {
  /** 0..1 across the viewport. */
  x: number;
  /** 0..1 down the viewport. */
  y: number;
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * canvas-confetti options for a celebration item (one burst). Fireworks fire
 * several of these; see `fireCelebration`.
 */
export function celebrationOptions(celebrationId: string, origin: CelebrationOrigin = { x: 0.5, y: 0.5 }): confetti.Options {
  const v = celebrationVisual(celebrationId);
  const base: confetti.Options = { origin, colors: v.colors, disableForReducedMotion: true, zIndex: 60 };
  switch (v.style) {
    case 'cheese':
      return { ...base, particleCount: 40, spread: 100, startVelocity: 32, gravity: 1.1, scalar: 1.6,
        shapes: [confetti.shapeFromText({ text: '🧀', scalar: 1.6 })] };
    case 'money':
      return { ...base, particleCount: 36, spread: 110, startVelocity: 30, gravity: 0.8, drift: 0.4, scalar: 1.5,
        shapes: [confetti.shapeFromText({ text: '💵', scalar: 1.5 })] };
    case 'fireworks':
      return { ...base, particleCount: 60, spread: 360, startVelocity: 26, gravity: 0.7, ticks: 90, scalar: 0.9 };
    default:
      return { ...base, particleCount: 90, spread: 75, startVelocity: 38, ticks: 160 };
  }
}

/**
 * Fire a player's win celebration from a point on screen. Does nothing when the
 * user prefers reduced motion. Returns a promise that resolves when it's done.
 */
export async function fireCelebration(celebrationId: string, origin: CelebrationOrigin = { x: 0.5, y: 0.5 }): Promise<void> {
  if (prefersReducedMotion()) return;
  const v = celebrationVisual(celebrationId);
  if (v.style === 'fireworks') {
    const bursts = [origin, { x: origin.x - 0.15, y: origin.y - 0.1 }, { x: origin.x + 0.15, y: origin.y - 0.12 }];
    await Promise.all(bursts.map((o, i) => new Promise<void>((resolve) => {
      setTimeout(() => void Promise.resolve(confetti(celebrationOptions(celebrationId, o))).then(() => resolve()), i * 280);
    })));
    return;
  }
  await confetti(celebrationOptions(celebrationId, origin));
}

/**
 * A static preview of a celebration (for shop tiles and pickers): its colours
 * scattered like fallen confetti, with the item's glyph where it has one.
 */
export function CelebrationPreview({ celebrationId, className }: { celebrationId: string; className?: string }) {
  const v = celebrationVisual(celebrationId);
  const glyph = v.style === 'cheese' ? '🧀' : v.style === 'money' ? '💵' : null;
  const bits = [
    [14, 22, 20], [32, 60, -30], [52, 18, 45], [70, 48, 10], [86, 24, -60], [22, 78, 70], [62, 80, -15], [44, 42, 30], [80, 70, 55],
  ];
  return (
    <svg viewBox="0 0 100 100" className={cx('block', className)} aria-hidden="true">
      {v.style === 'fireworks' &&
        [[35, 38], [68, 55]].map(([cx0, cy0], k) => (
          <g key={k}>
            {Array.from({ length: 10 }, (_, i) => (
              <line key={i} x1={cx0} y1={cy0} x2={cx0 + 14 * Math.cos((i * Math.PI) / 5)} y2={cy0 + 14 * Math.sin((i * Math.PI) / 5)}
                stroke={v.colors[(i + k) % v.colors.length]} strokeWidth="2.4" strokeLinecap="round" />
            ))}
          </g>
        ))}
      {v.style !== 'fireworks' && !glyph &&
        bits.map(([x, y, r], i) => (
          <rect key={i} x={x - 4} y={y - 2} width="8" height="4" rx="1" fill={v.colors[i % v.colors.length]} transform={`rotate(${r} ${x} ${y})`} />
        ))}
      {glyph &&
        bits.slice(0, 6).map(([x, y, r], i) => (
          <text key={i} x={x} y={y} fontSize="16" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${r} ${x} ${y})`}>{glyph}</text>
        ))}
    </svg>
  );
}
