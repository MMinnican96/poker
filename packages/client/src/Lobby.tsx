import { useEffect, useMemo, useState } from 'react';
import type { DiscordIdentity, LobbyState, TableConfig } from '@poker/shared';
import type { ClientSocket } from './socket';

interface LobbyProps {
  socket: ClientSocket;
  identity: DiscordIdentity;
  instanceId: string;
  onGameStart: (gameId: string) => void;
}

export function Lobby({ socket, identity, instanceId, onGameStart }: LobbyProps) {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    socket.emit('join_lobby', { instanceId, identity });
    socket.on('lobby_state_update', setLobby);
    socket.on('game_start', ({ gameId }) => onGameStart(gameId));
    return () => {
      socket.off('lobby_state_update', setLobby);
      socket.off('game_start');
    };
  }, [socket, instanceId, identity, onGameStart]);

  // Tick once a second while a countdown is running.
  useEffect(() => {
    if (lobby?.status !== 'countdown') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [lobby?.status]);

  const me = useMemo(
    () => lobby?.players.find((p) => p.discordUserId === identity.discordUserId),
    [lobby, identity.discordUserId],
  );
  const isHost = lobby?.players[0]?.discordUserId === identity.discordUserId;
  const readyCount = lobby?.players.filter((p) => p.isReady).length ?? 0;
  const someoneReady = readyCount > 0;
  const canEditConfig = isHost && lobby?.status === 'waiting' && !someoneReady;
  const insufficientChips = !!lobby && identity.chipBalance < lobby.config.buyIn;

  if (!lobby) return <Centered>Joining lobby…</Centered>;

  const secondsLeft =
    lobby.countdownEndsAt != null ? Math.max(0, Math.ceil((lobby.countdownEndsAt - now) / 1000)) : 0;

  return (
    <div style={styles.page}>
      <h1 style={{ margin: 0 }}>Poker Night</h1>
      <p style={{ opacity: 0.6, marginTop: 4 }}>Lobby · {lobby.players.length} seated</p>

      <section style={styles.players}>
        {lobby.players.map((p) => (
          <div key={p.discordUserId} style={styles.card}>
            <img src={p.avatarUrl} alt="" width={48} height={48} style={{ borderRadius: '50%' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{p.displayName}</div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>{p.chipBalance.toLocaleString()} chips</div>
            </div>
            <span style={{ ...styles.badge, opacity: p.isReady ? 1 : 0.3 }}>
              {p.isReady ? 'Ready' : 'Waiting'}
            </span>
          </div>
        ))}
      </section>

      <section style={styles.config}>
        <ConfigField label="Buy-in" value={lobby.config.buyIn} field="buyIn" editable={canEditConfig} socket={socket} />
        <ConfigField label="Small blind" value={lobby.config.smallBlind} field="smallBlind" editable={canEditConfig} socket={socket} />
        <ConfigField label="Big blind" value={lobby.config.bigBlind} field="bigBlind" editable={canEditConfig} socket={socket} />
      </section>

      {insufficientChips && (
        <p style={styles.error}>
          You need {lobby.config.buyIn.toLocaleString()} chips to join this table.
        </p>
      )}

      <div style={styles.actions}>
        <button
          style={styles.button}
          disabled={insufficientChips || lobby.status === 'countdown'}
          onClick={() => socket.emit(me?.isReady ? 'player_unready' : 'player_ready')}
        >
          {me?.isReady ? 'Unready' : 'Ready'}
        </button>
        <button
          style={{ ...styles.button, ...styles.primary }}
          disabled={readyCount < 2 || lobby.status !== 'waiting'}
          onClick={() => socket.emit('start_countdown')}
        >
          Start Game
        </button>
      </div>

      {lobby.status === 'countdown' && (
        <div style={styles.overlay}>
          <div style={{ fontSize: 64, fontWeight: 700 }}>{secondsLeft}</div>
          <div style={{ opacity: 0.8 }}>Game starting…</div>
          {me?.isReady && (
            <button style={{ ...styles.button, marginTop: 16 }} onClick={() => socket.emit('cancel_countdown')}>
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ConfigField({
  label,
  value,
  field,
  editable,
  socket,
}: {
  label: string;
  value: number;
  field: keyof TableConfig;
  editable: boolean;
  socket: ClientSocket;
}) {
  return (
    <label style={styles.field}>
      <span style={{ opacity: 0.7, fontSize: 12 }}>{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        disabled={!editable}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isInteger(n) && n > 0) socket.emit('update_config', { [field]: n });
        }}
        style={styles.input}
      />
    </label>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ ...styles.page, justifyContent: 'center' }}>{children}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    position: 'relative',
    minHeight: '100vh',
    boxSizing: 'border-box',
    padding: 24,
    background: '#1b1f3b',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  players: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: '#2a2f55',
    borderRadius: 12,
    padding: 12,
  },
  badge: { background: '#3ba55d', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600 },
  config: { display: 'flex', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  input: {
    background: '#2a2f55',
    border: '1px solid #3a3f65',
    borderRadius: 8,
    color: '#fff',
    padding: '8px 10px',
    fontSize: 15,
  },
  actions: { display: 'flex', gap: 12 },
  button: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 10,
    border: 'none',
    background: '#3a3f65',
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  primary: { background: '#5865f2' },
  error: { color: '#ff6b6b', margin: 0 },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(15,18,40,0.92)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
