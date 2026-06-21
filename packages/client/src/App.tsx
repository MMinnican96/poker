import { useEffect, useRef, useState } from 'react';
import type { DiscordIdentity } from '@poker/shared';
import { setupDiscord } from './discord';
import { createSocket, type ClientSocket } from './socket';
import { LobbyScreen } from './lobby/LobbyScreen';
import { GameCanvas } from './GameCanvas';

type Status =
  | { phase: 'connecting' }
  | { phase: 'ready'; identity: DiscordIdentity; instanceId: string }
  | { phase: 'error'; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ phase: 'connecting' });
  const [atTable, setAtTable] = useState(false);
  const socketRef = useRef<ClientSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    setupDiscord()
      .then(({ identity, instanceId }) => {
        if (cancelled) return;
        socketRef.current = createSocket();
        setStatus({ phase: 'ready', identity, instanceId });
      })
      .catch((err: unknown) => {
        console.error('[poker] setup failed:', err);
        if (!cancelled) setStatus({ phase: 'error', message: formatError(err) });
      });
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (status.phase !== 'ready') return;
    const socket = socketRef.current!;
    const onJoined = () => {
      setAtTable(true);
      socket.emit('request_game_state');
    };
    const onLeft = () => setAtTable(false);
    socket.on('joined_table', onJoined);
    socket.on('left_table', onLeft);
    return () => {
      socket.off('joined_table', onJoined);
      socket.off('left_table', onLeft);
    };
  }, [status.phase]);

  if (status.phase === 'connecting') return <Centered>Connecting to Discord…</Centered>;

  if (status.phase === 'error') {
    return (
      <Centered>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1>Couldn't start</h1>
          <p style={{ opacity: 0.8 }}>{status.message}</p>
          <p style={{ opacity: 0.5, fontSize: 13 }}>
            This screen is expected outside of Discord — launch the Activity inside a Discord
            voice channel.
          </p>
        </div>
      </Centered>
    );
  }

  if (atTable) {
    return <GameCanvas socket={socketRef.current!} identity={status.identity} />;
  }

  return (
    <LobbyScreen
      socket={socketRef.current!}
      identity={status.identity}
      instanceId={status.instanceId}
    />
  );
}

/** Turn any thrown value (incl. Discord SDK error objects) into readable text. */
function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const detail = o.message ?? o.error ?? o.code;
    if (detail != null) return String(detail);
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }
  return String(err);
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        color: '#fff',
        background: '#1b1f3b',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </main>
  );
}
