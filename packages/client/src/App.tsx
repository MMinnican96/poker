import { useEffect, useRef, useState } from 'react';
import type { DiscordIdentity } from '@poker/shared';
import { setupDiscord } from './discord';
import { createSocket, type ClientSocket } from './socket';
import { Lobby } from './Lobby';
import { GameCanvas } from './GameCanvas';

type Status =
  | { phase: 'connecting' }
  | { phase: 'ready'; identity: DiscordIdentity; instanceId: string }
  | { phase: 'error'; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ phase: 'connecting' });
  const [gameId, setGameId] = useState<string | null>(null);
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
        if (!cancelled) {
          setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
    };
  }, []);

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

  if (gameId) {
    return <GameCanvas socket={socketRef.current!} identity={status.identity} />;
  }

  return (
    <Lobby
      socket={socketRef.current!}
      identity={status.identity}
      instanceId={status.instanceId}
      onGameStart={setGameId}
    />
  );
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
