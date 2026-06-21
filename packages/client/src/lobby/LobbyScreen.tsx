import { useEffect, useMemo, useState } from 'react';
import type { DiscordIdentity, LobbyState, TableConfig } from '@poker/shared';
import type { ClientSocket } from '../socket';
import { Header, type LobbyTab } from './Header';
import { PlayersPanel } from './PlayersPanel';
import { TableSettings } from './TableSettings';
import { ComingSoon } from './ComingSoon';
import { RecentActivity } from './RecentActivity';
import { UserPopout } from './UserPopout';
import { PlayerProfileModal } from './PlayerProfileModal';
import { useStats } from './useStats';

export interface LobbyScreenProps {
  socket: ClientSocket;
  identity: DiscordIdentity;
  instanceId: string;
  onGameStart: (gameId: string) => void;
}

export function LobbyScreen({ socket, identity, instanceId, onGameStart }: LobbyScreenProps) {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<LobbyTab>('home');
  const [userOpen, setUserOpen] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const { stats: myStats } = useStats(userOpen ? identity.discordUserId : null);

  useEffect(() => {
    socket.emit('join_lobby', { instanceId, identity });
    socket.on('lobby_state_update', setLobby);
    socket.on('game_start', ({ gameId }) => onGameStart(gameId));
    return () => {
      socket.off('lobby_state_update', setLobby);
      socket.off('game_start');
    };
  }, [socket, instanceId, identity, onGameStart]);

  useEffect(() => {
    if (lobby?.status !== 'countdown') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [lobby?.status]);

  const me = useMemo(
    () => lobby?.players.find((p) => p.discordUserId === identity.discordUserId),
    [lobby, identity.discordUserId],
  );

  if (!lobby) {
    return (
      <main className="felt-bg flex h-screen items-center justify-center font-body text-cream">
        Joining lobby…
      </main>
    );
  }

  const isHost = lobby.players[0]?.discordUserId === identity.discordUserId;
  const readyCount = lobby.players.filter((p) => p.isReady).length;
  const otherReadyCount = lobby.players.filter(
    (p) => p.isReady && p.discordUserId !== identity.discordUserId,
  ).length;
  const canEditConfig = isHost && lobby.status === 'waiting' && readyCount === 0;
  const insufficientChips = identity.chipBalance < lobby.config.buyIn;
  // Host has no Ready control; they ready implicitly on START. START is enabled
  // once at least one OTHER player is ready (host + that player = the 2-ready min).
  const canStart = lobby.status === 'waiting' && !insufficientChips && otherReadyCount >= 1;

  // Ready the host implicitly, then start the countdown.
  const startCountdown = () => {
    if (!me?.isReady) socket.emit('player_ready');
    socket.emit('start_countdown');
  };
  const secondsLeft =
    lobby.countdownEndsAt != null ? Math.max(0, Math.ceil((lobby.countdownEndsAt - now) / 1000)) : 0;

  const selectedPlayer = selectedPlayerId
    ? lobby.players.find((p) => p.discordUserId === selectedPlayerId) ?? null
    : null;

  const updateConfig = (patch: Partial<TableConfig>) => socket.emit('update_config', patch);

  return (
    <div className="felt-bg flex h-screen w-full flex-col overflow-hidden font-body text-cream">
      <Header
        activeTab={tab}
        onTabChange={setTab}
        identity={identity}
        onOpenUser={() => setUserOpen(true)}
      />

      <main className="flex min-h-0 flex-1 gap-3.5 px-[18px] pb-[22px] pt-1.5">
        <PlayersPanel
          players={lobby.players}
          lobbyStatus={lobby.status}
          maxPlayers={lobby.config.maxPlayers}
          onSelectPlayer={setSelectedPlayerId}
        />

        <section className="min-w-[336px] flex-1 overflow-y-auto overflow-x-hidden p-1">
          {tab === 'home' && (
            <TableSettings
              config={lobby.config}
              canEditConfig={canEditConfig}
              isHost={isHost}
              status={lobby.status}
              readyCount={readyCount}
              playerCount={lobby.players.length}
              secondsLeft={secondsLeft}
              meIsReady={me?.isReady ?? false}
              canStart={canStart}
              insufficientChips={insufficientChips}
              onUpdateConfig={updateConfig}
              onReadyToggle={() => socket.emit(me?.isReady ? 'player_unready' : 'player_ready')}
              onStartCountdown={startCountdown}
              onCancelCountdown={() => socket.emit('cancel_countdown')}
              onLeave={() => socket.emit('leave_table')}
            />
          )}
          {tab === 'leaderboard' && <ComingSoon title="Leaderboard" />}
          {tab === 'stats' && <ComingSoon title="Stats" />}
          {tab === 'shop' && <ComingSoon title="Shop" />}
        </section>

        <RecentActivity />
      </main>

      {userOpen && (
        <UserPopout identity={identity} stats={myStats} onClose={() => setUserOpen(false)} />
      )}
      {selectedPlayer && (
        <PlayerProfileModal
          player={selectedPlayer}
          lobbyStatus={lobby.status}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </div>
  );
}
