import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TableView } from '@poker/shared';
import { useProfileCard } from '../app/nav';
import { Felt, fireCelebration } from '../cosmetics';
import { CenterCluster } from './CenterCluster';
import { FxLayer } from './FxLayer';
import { useElementSize } from './hooks';
import { betPoint, buttonPoint, displayIndex, stageLayout, type Point } from './layout';
import { BetChips, SeatMarker } from './Markers';
import { EmptySeat, Seat, cardKey, type SeatOutcome } from './Seat';
import { SeatMenu } from './SeatMenu';

export interface TableStageProps {
  view: TableView;
  /** Can you sit down (you're watching and the table isn't closing)? */
  canSit: boolean;
  sitBlockedReason: string | null;
  onSit(seat: number): void;
  /** Shown in the middle when no hand is running. */
  idle: ReactNode;
  /** Top-of-felt banner (closing). */
  banner?: ReactNode;
}

/**
 * The felt with everyone around it. Seats are rotated so you sit at the bottom
 * (watchers see seat 1 there), and everything scales with the space available.
 */
export function TableStage({ view, canSit, sitBlockedReason, onSit, idle, banner }: TableStageProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const { rules, hand, you } = view;
  const layout = useMemo(() => stageLayout(size.width, size.height, rules.maxSeats), [size.width, size.height, rules.maxSeats]);
  const anchor = you.role === 'seated' && you.seat !== null ? you.seat : 0;
  const profile = useProfileCard();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const slotOf = (seat: number) => layout.slots[displayIndex(seat, anchor, rules.maxSeats)];
  const seatById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of view.seats) if (s.player) m.set(s.player.id, s.seat);
    return m;
  }, [view.seats]);
  const nameOf = (id: string) => {
    const seat = seatById.get(id);
    const p = seat !== undefined ? view.seats[seat]?.player : null;
    return p?.name ?? view.spectators.find((x) => x.id === id)?.name ?? 'Someone';
  };

  const result = hand?.result ?? null;
  // The cards to light up: the best five of the main pot's winner(s).
  const highlight = useMemo(() => {
    const set = new Set<string>();
    if (!result?.wentToShowdown) return set;
    const winners = result.pots[0]?.winnerIds ?? [];
    for (const id of winners) for (const c of result.shown[id]?.best ?? []) set.add(cardKey(c));
    return set;
  }, [result]);

  // Celebrate each winner once per hand, from their seat.
  const celebrated = useRef<string | null>(null);
  const stageEl = ref;
  useEffect(() => {
    if (!hand || !result) return;
    const key = `${view.tableId}:${hand.handNumber}`;
    if (celebrated.current === key) return;
    celebrated.current = key;
    const winners = Object.entries(result.payouts).filter(([, n]) => n > 0).map(([id]) => id);
    const t = setTimeout(() => {
      const box = stageEl.current?.getBoundingClientRect();
      if (!box || typeof window === 'undefined') return;
      for (const id of winners) {
        const seat = seatById.get(id);
        const p = seat !== undefined ? view.seats[seat]?.player : null;
        if (!p || seat === undefined) continue;
        const slot = slotOf(seat);
        const origin = { x: (box.left + slot.x) / window.innerWidth, y: (box.top + slot.y) / window.innerHeight };
        void fireCelebration(p.cosmetics.celebration, origin);
      }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, hand?.handNumber, view.tableId]);

  // Close the seat menu if that player leaves.
  useEffect(() => {
    if (menuFor && !seatById.has(menuFor)) setMenuFor(null);
  }, [menuFor, seatById]);

  const turnMs = rules.turnSeconds * 1000;
  const pointOf = (id: string): Point | null => {
    const seat = seatById.get(id);
    return seat === undefined ? null : slotOf(seat);
  };
  const betOf = (id: string): Point | null => {
    const seat = seatById.get(id);
    return seat === undefined ? null : betPoint(layout, slotOf(seat), id === you.id);
  };
  const menuPlayer = menuFor ? view.seats[seatById.get(menuFor) ?? -1]?.player ?? null : null;

  return (
    <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden" data-testid="table-stage" data-portrait={layout.portrait || undefined}>
      <Felt
        feltId={rules.feltId}
        rail
        crestScale={layout.portrait ? 0.46 : 0.26}
        className="absolute"
        style={{ left: layout.felt.x, top: layout.felt.y, width: layout.felt.w, height: layout.felt.h }}
      />

      {banner && (
        <div className="absolute inset-x-0 z-20 flex justify-center px-3" style={{ top: Math.max(4, layout.felt.y + layout.felt.h * 0.1) }}>
          {banner}
        </div>
      )}

      <CenterCluster layout={layout} feltId={rules.feltId} hand={hand} highlight={highlight} nameOf={nameOf} youId={you.id} idle={idle} />

      {/* Bets, dealer button and blinds */}
      {hand &&
        view.seats.map(({ seat, player }) => {
          if (!player) return null;
          const slot = slotOf(seat);
          const blind = hand.street === 'pre-flop' && !result && !player.lastAction ? (hand.bigBlindSeat === seat ? 'BB' : hand.smallBlindSeat === seat ? 'SB' : null) : null;
          return (
            <div key={`m-${seat}`}>
              {player.committed > 0 && <BetChips at={betPoint(layout, slot, player.id === you.id)} amount={player.committed} name={player.name} size={layout.avatar} blind={blind} />}
              {hand.buttonSeat === seat && <SeatMarker at={buttonPoint(layout, slot, player.id === you.id)} kind="D" size={layout.avatar} />}
            </div>
          );
        })}

      <ol aria-label="Seats" className="absolute inset-0">
        {view.seats.map(({ seat, player }) => {
          const slot = slotOf(seat);
          if (!player) {
            return (
              <EmptySeat
                key={seat}
                seat={seat}
                slot={slot}
                layout={layout}
                canSit={canSit}
                blockedReason={sitBlockedReason}
                onSit={() => onSit(seat)}
              />
            );
          }
          const hero = player.id === you.id;
          const outcome: SeatOutcome | null = result
            ? { won: result.payouts[player.id] ?? 0, shown: result.shown[player.id] ?? null }
            : null;
          return (
            <Seat
              key={seat}
              seat={seat}
              player={player}
              slot={slot}
              layout={layout}
              hero={hero}
              toAct={!!hand && !result && hand.toActSeat === seat}
              actionEndsAt={hand?.actionEndsAt ?? null}
              turnMs={turnMs}
              handNumber={hand?.handNumber ?? null}
              outcome={outcome}
              resultShowing={!!result}
              highlight={highlight}
              selected={menuFor === player.id}
              onSelect={() => (hero ? profile.open(player.id) : setMenuFor((m) => (m === player.id ? null : player.id)))}
            />
          );
        })}
      </ol>

      <FxLayer
        view={view}
        seatPoint={pointOf}
        betPoint={betOf}
        potPoint={{ x: layout.cx, y: layout.cy - layout.boardCard * 0.9 }}
        gallery={{ x: layout.width - 56, y: Math.max(40, layout.avatar) }}
        avatar={layout.avatar}
      />

      {menuPlayer && (
        <SeatMenu
          key={menuPlayer.id}
          player={menuPlayer}
          at={slotOf(seatById.get(menuPlayer.id)!)}
          stage={layout}
          avatar={layout.avatar}
          canThrow={menuPlayer.id !== you.id}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}
