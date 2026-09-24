import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatChipsShort, getItem, type TableFx, type TableView } from '@poker/shared';
import { useTableFx } from '../app/client';
import { prefersReducedMotion } from '../cosmetics';
import { ChipGlyph } from '../ui';
import type { Point } from './layout';

interface Flight {
  id: string;
  from: Point;
  to: Point;
  content: ReactNode;
  duration: number;
  delay: number;
  /** Lift at the midpoint (px) for a thrown arc. */
  arc: number;
  spin?: boolean;
  onLand?: () => void;
}

interface Floating {
  id: string;
  at: Point;
  kind: 'emote' | 'splat';
  glyph: string;
  color?: string;
}

let seq = 0;
const nextId = () => `fx-${++seq}`;

const canAnimate = () =>
  !prefersReducedMotion() && typeof Element !== 'undefined' && typeof (Element.prototype as { animate?: unknown }).animate === 'function';

/** One moving thing (chips, a thrown tomato), animated with the Web Animations API. */
function FlightView({ f, onDone }: { f: Flight; onDone(id: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dx = f.to.x - f.from.x;
    const dy = f.to.y - f.from.y;
    const frames: Keyframe[] = [
      { transform: 'translate(-50%, -50%) translate(0px, 0px) rotate(0deg)', opacity: 0 },
      { transform: `translate(-50%, -50%) translate(${dx * 0.5}px, ${dy * 0.5 - f.arc}px) rotate(${f.spin ? 200 : 0}deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${f.spin ? 400 : 0}deg)`, opacity: 1 },
    ];
    const anim = el.animate(frames, { duration: f.duration, delay: f.delay, easing: 'cubic-bezier(0.3, 0.6, 0.4, 1)', fill: 'both' });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      f.onLand?.();
      onDone(f.id);
    };
    anim.onfinish = finish;
    const fallback = setTimeout(finish, f.duration + f.delay + 400);
    return () => {
      clearTimeout(fallback);
      anim.cancel();
    };
  }, [f, onDone]);
  return (
    <div ref={ref} className="absolute" style={{ left: f.from.x, top: f.from.y, opacity: 0 }} aria-hidden="true">
      {f.content}
    </div>
  );
}

/** A soft paint blob. */
function Splat({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path
        fill={color}
        fillOpacity="0.88"
        d="M50 12c7 0 9 10 15 11s12-7 17-2-2 12 1 18 12 6 11 13-10 6-12 12 5 14-2 18-11-4-17-2-8 12-15 11-6-10-12-12-13 5-17-1 3-11 0-16-12-7-10-14 11-5 12-11-6-13 0-17 12 3 17 0 5-18 13-18Z"
      />
      <circle cx="18" cy="24" r="4" fill={color} fillOpacity="0.8" />
      <circle cx="86" cy="80" r="5" fill={color} fillOpacity="0.8" />
      <circle cx="78" cy="14" r="3" fill={color} fillOpacity="0.8" />
    </svg>
  );
}

export interface FxLayerProps {
  view: TableView;
  /** Stage position of a player's seat, or null for spectators / unknown. */
  seatPoint(playerId: string): Point | null;
  /** Stage position of a seat's bet. */
  betPoint(playerId: string): Point | null;
  /** Where the pot sits. */
  potPoint: Point;
  /** Where effects from spectators start (the watchers' corner). */
  gallery: Point;
  avatar: number;
}

/**
 * Everything that flies over the felt: bets swept into the pot, payouts to the
 * winners, emotes rising from a seat and throwables with their splat. Nothing
 * moves under reduced motion; emotes and splats still appear briefly.
 */
export function FxLayer({ view, seatPoint, betPoint, potPoint, gallery, avatar }: FxLayerProps) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [floating, setFloating] = useState<Floating[]>([]);
  const prev = useRef<TableView | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const fns = useRef({ seatPoint, betPoint, potPoint, gallery });
  fns.current = { seatPoint, betPoint, potPoint, gallery };

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of t) clearTimeout(id);
    };
  }, []);

  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  };

  const float = (item: Omit<Floating, 'id'>, ms: number) => {
    const id = nextId();
    setFloating((list) => [...list, { ...item, id }]);
    later(ms, () => setFloating((list) => list.filter((x) => x.id !== id)));
  };

  const removeFlight = useRef((id: string) => setFlights((list) => list.filter((f) => f.id !== id))).current;

  // Chips: bets swept to the pot when a street ends; the pot pushed to winners.
  useEffect(() => {
    const p = prev.current;
    prev.current = view;
    const ph = p?.hand;
    const nh = view.hand;
    if (!p || !ph || !nh || ph.handNumber !== nh.handNumber || !canAnimate()) return;
    const { betPoint: bp, seatPoint: sp, potPoint: pot } = fns.current;
    const add: Flight[] = [];
    const streetOver = nh.street !== ph.street || nh.board.length > ph.board.length || (!!nh.result && !ph.result);
    if (streetOver) {
      for (const s of p.seats) {
        if (!s.player || s.player.committed <= 0) continue;
        const from = bp(s.player.id);
        if (!from) continue;
        add.push({ id: nextId(), from, to: pot, duration: 380, delay: 0, arc: 0, content: <ChipGlyph size={Math.max(14, avatar * 0.34)} /> });
      }
    }
    if (nh.result && !ph.result) {
      let i = 0;
      for (const [id, amount] of Object.entries(nh.result.payouts)) {
        if (amount <= 0) continue;
        const to = sp(id);
        if (!to) continue;
        add.push({
          id: nextId(), from: pot, to, duration: 620, delay: 380 + i * 140, arc: 0,
          content: (
            <span className="tabular inline-flex items-center gap-1 rounded-full bg-walnut-950/85 px-1.5 font-display text-[13px] text-brass-light shadow-lift">
              <ChipGlyph size={14} />
              {formatChipsShort(amount)}
            </span>
          ),
        });
        i += 1;
      }
    }
    if (add.length) setFlights((list) => [...list, ...add]);
  }, [view, avatar]);

  useTableFx((fx: TableFx) => {
    const { seatPoint: sp, gallery: g } = fns.current;
    const from = sp(fx.fromId) ?? g;
    if (fx.kind === 'emote') {
      float({ at: { x: from.x, y: from.y - avatar * 0.3 }, kind: 'emote', glyph: fx.value }, 2600);
      return;
    }
    const item = getItem(fx.value);
    const v = item?.visual.kind === 'throwable' ? item.visual : null;
    const to = fx.toId ? sp(fx.toId) : null;
    if (!v || !to) return;
    const land = () => float({ at: to, kind: 'splat', glyph: v.glyph, color: v.splat }, 1900);
    if (!canAnimate()) {
      land();
      return;
    }
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    setFlights((list) => [
      ...list,
      {
        id: nextId(), from, to, duration: Math.min(900, 420 + dist * 0.6), delay: 0, arc: Math.min(120, dist * 0.35), spin: true,
        content: <span className="block leading-none" style={{ fontSize: Math.max(22, avatar * 0.62) }}>{v.glyph}</span>,
        onLand: land,
      },
    ]);
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      {flights.map((f) => (
        <FlightView key={f.id} f={f} onDone={removeFlight} />
      ))}
      {floating.map((f) =>
        f.kind === 'emote' ? (
          <span
            key={f.id}
            className="tbl-emote absolute block leading-none drop-shadow-[0_3px_4px_rgb(0_0_0/0.5)]"
            style={{ left: f.at.x, top: f.at.y, fontSize: Math.max(28, avatar * 0.8), transform: 'translate(-50%, -90%)' }}
          >
            {f.glyph}
          </span>
        ) : (
          <span key={f.id} className="tbl-splat absolute grid place-items-center" style={{ left: f.at.x, top: f.at.y, transform: 'translate(-50%, -50%)' }}>
            <Splat color={f.color ?? 'currentColor'} size={avatar * 1.6} />
            <span className="absolute leading-none" style={{ fontSize: Math.max(18, avatar * 0.5) }}>{f.glyph}</span>
          </span>
        ),
      )}
    </div>
  );
}
