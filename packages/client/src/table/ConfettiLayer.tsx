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
