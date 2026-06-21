import { useEffect, useMemo, useState } from 'react';
import type { DiscordIdentity, GameState, PlayerAction, LobbyPlayer } from '@poker/shared';
import type { ClientSocket } from '../socket';
import { TableHeader } from './TableHeader';
import { CenterCluster } from './CenterCluster';
import { Seat } from './Seat';
import { HeroToken } from './HeroToken';
import { HeroHud } from './HeroHud';
import { TableActionBar } from './TableActionBar';
import { arrangeSeats, seatPositions } from './SeatLayout';
import { UserPopout, type SeatActions } from '../lobby/UserPopout';
import { PlayerProfileModal } from '../lobby/PlayerProfileModal';
import { useStats } from '../lobby/useStats';

const BETTING_PHASES: GameState['phase'][] = ['pre-flop', 'flop', 'turn', 'river'];

interface Props {
  socket: ClientSocket;
  identity: DiscordIdentity;
}

export function TableScreen({ socket, identity }: Props) {
  const viewerId = identity.discordUserId;
  const [view, setView] = useState<GameState | null>(null);
  const [timer, setTimer] = useState<{ playerId: string; remainingMs: number } | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { stats } = useStats(userOpen ? viewerId : null);

  useEffect(() => {
    const onState = (s: GameState) => setView(s);
    const onTimer = (p: { playerId: string; remainingMs: number }) => setTimer(p);
    const onResult = (p: { finalState: GameState }) => setView(p.finalState);
    socket.on('game_state_update', onState);
    socket.on('timer_tick', onTimer);
    socket.on('hand_result', onResult);
    socket.emit('request_game_state');
    return () => {
      socket.off('game_state_update', onState);
      socket.off('timer_tick', onTimer);
      socket.off('hand_result', onResult);
    };
  }, [socket]);

  const act = (a: PlayerAction) => socket.emit('player_action', a);

  const { hero, opponents, positions } = useMemo(() => {
    if (!view) return { hero: null, opponents: [], positions: [] as ReturnType<typeof seatPositions> };
    const seated = view.players.filter((p) => p.status !== 'sitting-out');
    const { hero, opponents } = arrangeSeats(seated, viewerId);
    return { hero, opponents, positions: seatPositions(opponents.length + 1) };
  }, [view, viewerId]);

  if (!view) {
    return <div className="flex h-screen w-full items-center justify-center bg-felt-900 text-sage-light">Dealing…</div>;
  }

  const me = view.players.find((p) => p.discordUserId === viewerId) ?? null;
  const isSpectating = me == null || me.status === 'sitting-out';
  const isMyTurn =
    BETTING_PHASES.includes(view.phase) &&
    me?.status === 'active' &&
    view.players[view.currentPlayerIndex]?.discordUserId === viewerId;

  const activeId = view.players[view.currentPlayerIndex]?.discordUserId ?? null;
  const timerPctFor = (id: string): number | null => {
    if (id !== activeId || !timer || timer.playerId !== id) return null;
    return Math.max(0, Math.min(100, (timer.remainingMs / (view.config.turnSeconds * 1000)) * 100));
  };
  const roleFor = (seatIndex: number): 'D' | 'SB' | 'BB' | null =>
    seatIndex === view.dealerIndex ? 'D'
      : seatIndex === view.smallBlindIndex ? 'SB'
      : seatIndex === view.bigBlindIndex ? 'BB' : null;

  const reveal = view.phase === 'showdown' || view.phase === 'hand-complete';
  const bank = view.viewerBankroll ?? identity.chipBalance;
  const seatFull = view.players.length >= view.config.maxPlayers;
  const underfunded = bank < view.config.buyIn;
  const canJoin = !seatFull && !underfunded;
  const joinReason = seatFull ? `The table is full (${view.config.maxPlayers} seats).`
    : underfunded ? `Not enough chips for the ${view.config.buyIn.toLocaleString()} buy-in.` : '';

  const seatActions: SeatActions = {
    mode: isSpectating ? 'spectating' : 'playing',
    buyIn: view.config.buyIn,
    canJoin,
    joinReason,
    pending: view.viewerPending === 'leave' ? 'leave' : view.viewerPending === 'spectate' ? 'spectate' : null,
    leaveHint: isSpectating ? 'Back to the lobby — any time' : 'After this hand finishes',
    onSpectate: () => { setUserOpen(false); socket.emit('sit_out'); },
    onJoin: () => { setUserOpen(false); socket.emit('sit_in'); },
    onLeave: () => { setUserOpen(false); socket.emit('leave_table'); },
    onCancelPending: () => socket.emit('cancel_pending'),
  };

  const selected = selectedId ? view.players.find((p) => p.discordUserId === selectedId) ?? null : null;

  return (
    <div className="felt-bg flex h-screen w-full flex-col overflow-hidden text-cream">
      <TableHeader
        identity={identity}
        handNumber={view.handNumber}
        config={view.config}
        spectators={view.spectators ?? []}
        heroStack={me?.chipStack ?? null}
        onOpenUser={() => setUserOpen(true)}
      />

      <main className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative" style={{ width: 'min(880px, calc(100vw - 240px))', height: 'min(440px, calc(100vh - 280px))' }}>
          <div className="absolute inset-0 rounded-[50%] border-[3px] border-[#0c0a05] bg-gradient-to-b from-[#3a2a12] to-[#1c1407] shadow-tablecard" />
          <div className="absolute inset-[14px] rounded-[50%] border-[3px] border-felt-900 bg-[radial-gradient(120%_120%_at_50%_38%,#1f7a55_0%,#156040_55%,#0c4730_100%)]" />
          <div className="absolute inset-[13%] rounded-[50%] border-2 border-dashed border-white/10" />

          {view.waitingForPlayers ? (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-pill border-[2.5px] border-gold-border bg-gold px-5 py-2 font-display text-sm font-semibold tracking-[0.16em] text-felt-900 shadow-hard-gold">
              WAITING FOR PLAYERS…
            </div>
          ) : (
            <CenterCluster phase={view.phase} community={view.communityCards} pots={view.pots} />
          )}

          {opponents.map((p, i) => (
            <Seat
              key={p.discordUserId}
              player={p}
              pos={positions[i + 1]}
              role={roleFor(p.seatIndex)}
              isActive={p.discordUserId === activeId && BETTING_PHASES.includes(view.phase)}
              timerPct={timerPctFor(p.discordUserId)}
              reveal={reveal}
              onOpen={() => setSelectedId(p.discordUserId)}
            />
          ))}

          {!view.waitingForPlayers && (
            <HeroToken
              player={isSpectating ? null : hero}
              role={hero ? roleFor(hero.seatIndex) : null}
              isActive={!!isMyTurn}
              timerPct={isMyTurn ? timerPctFor(viewerId) : null}
              isSpectating={isSpectating}
            />
          )}
        </div>
      </main>

      <HeroHud
        me={isSpectating ? null : me}
        community={view.communityCards}
        bank={bank}
        isSpectating={isSpectating}
        isMyTurn={!!isMyTurn}
        turnSecondsLeft={isMyTurn && timer ? timer.remainingMs / 1000 : null}
      />

      <TableActionBar state={view} myId={viewerId} onAction={act} />

      {userOpen && (
        <UserPopout identity={{ ...identity, chipBalance: bank }} stats={stats} onClose={() => setUserOpen(false)} seat={seatActions} />
      )}

      {selected && (
        <PlayerProfileModal
          player={gamePlayerToLobby(selected)}
          tableRole="seated"
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/** Adapt a GamePlayer to the LobbyPlayer shape the reused modal expects. */
function gamePlayerToLobby(p: GameState['players'][number]): LobbyPlayer {
  return {
    discordUserId: p.discordUserId,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    chipBalance: p.chipStack,
    isReady: false,
    socketId: '',
  };
}
