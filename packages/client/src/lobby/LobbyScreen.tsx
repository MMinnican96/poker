import { useEffect, useMemo, useState } from 'react';
import type { DiscordIdentity, LobbyState, TableConfig } from '@poker/shared';
import { DEFAULT_TABLE_CONFIG } from '@poker/shared';
import type { ClientSocket } from '../socket';
import { Header, type LobbyTab } from './Header';
import { PlayersPanel } from './PlayersPanel';
import { TableSettings } from './TableSettings';
import { ActiveGameCard } from './ActiveGameCard';
import { ComingSoon } from './ComingSoon';
import { RecentActivity } from './RecentActivity';
import { UserPopout } from './UserPopout';
import { PlayerProfileModal } from './PlayerProfileModal';
import { useStats } from './useStats';

export interface LobbyScreenProps {
  socket: ClientSocket;
  identity: DiscordIdentity;
  instanceId: string;
}

export function LobbyScreen({ socket, identity, instanceId }: LobbyScreenProps) {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<LobbyTab>('home');
  const [userOpen, setUserOpen] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [draftConfig, setDraftConfig] = useState<TableConfig>(DEFAULT_TABLE_CONFIG);

  const { stats: myStats } = useStats(userOpen ? identity.discordUserId : null);

  useEffect(() => {
    socket.emit('join_lobby', { instanceId, identity });
    socket.on('lobby_state_update', setLobby);
    return () => {
      socket.off('lobby_state_update', setLobby);
    };
  }, [socket, instanceId, identity]);

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

  const hostExists = lobby.hostId !== null;
  const isHost = lobby.hostId === identity.discordUserId;
  const readyCount = lobby.players.filter((p) => p.isReady).length;
  const otherReadyCount = lobby.players.filter(
    (p) => p.isReady && p.discordUserId !== identity.discordUserId,
  ).length;
  // No host yet → everyone may edit their own local draft. Host set → host edits live.
  const canEditConfig = hostExists ? isHost && lobby.status === 'waiting' : true;
  const activeConfig = hostExists ? lobby.config : draftConfig;
  const insufficientChips = identity.chipBalance < activeConfig.buyIn;
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

  const updateConfig = (patch: Partial<TableConfig>) => {
    if (hostExists) socket.emit('update_config', patch);
    else setDraftConfig((c) => ({ ...c, ...patch }));
  };

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
          {tab === 'home' && (lobby.activeGame
            ? <ActiveGameCard activeGame={lobby.activeGame} onJoinTable={() => socket.emit('join_table')} />
            : (
              <TableSettings
                config={activeConfig}
                canEditConfig={canEditConfig}
                isHost={isHost}
                hostExists={hostExists}
                status={lobby.status}
                readyCount={readyCount}
                playerCount={lobby.players.length}
                secondsLeft={secondsLeft}
                meIsReady={me?.isReady ?? false}
                canStart={canStart}
                insufficientChips={insufficientChips}
                onUpdateConfig={updateConfig}
                onCreateGame={() => socket.emit('create_game', draftConfig)}
                onCancelGame={() => socket.emit('cancel_game')}
                onReadyToggle={() => socket.emit(me?.isReady ? 'player_unready' : 'player_ready')}
                onStartCountdown={startCountdown}
                onCancelCountdown={() => socket.emit('cancel_countdown')}
                onLeave={() => socket.emit('leave_table')}
              />
            )
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
