import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import type { DiscordIdentity, GameState, PlayerAction } from '@poker/shared';
import type { ClientSocket } from './socket';
import { GameBridge } from './game/bridge';
import { createGame } from './game/createGame';
import { ActionBar } from './ActionBar';

interface GameCanvasProps {
  socket: ClientSocket;
  identity: DiscordIdentity;
}

interface ResultBanner {
  winnerNames: string[];
  potAmount: number;
  handName?: string;
}

export function GameCanvas({ socket, identity }: GameCanvasProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [view, setView] = useState<GameState | null>(null);
  const [result, setResult] = useState<ResultBanner | null>(null);

  useEffect(() => {
    if (!parentRef.current) return;
    const bridge = new GameBridge();
    const game = createGame(parentRef.current, bridge);
    gameRef.current = game;
    const viewerId = identity.discordUserId;

    const onState = (state: GameState) => {
      setView(state);
      bridge.pushState({ state, viewerId });
    };
    const onTimer = (payload: { playerId: string; remainingMs: number }) => {
      bridge.pushTimer(payload);
    };
    const onResult = (payload: {
      winnerIds: string[];
      potAmount: number;
      handName?: string;
      finalState: GameState;
    }) => {
      setView(payload.finalState);
      bridge.pushState({ state: payload.finalState, viewerId });
      const names = payload.winnerIds.map(
        (id) => payload.finalState.players.find((p) => p.discordUserId === id)?.displayName ?? id,
      );
      setResult({ winnerNames: names, potAmount: payload.potAmount, handName: payload.handName });
      window.setTimeout(() => setResult(null), 4500);
    };

    socket.on('game_state_update', onState);
    socket.on('timer_tick', onTimer);
    socket.on('hand_result', onResult);

    return () => {
      socket.off('game_state_update', onState);
      socket.off('timer_tick', onTimer);
      socket.off('hand_result', onResult);
      bridge.removeAllListeners();
      game.destroy(true);
      gameRef.current = null;
    };
  }, [socket, identity.discordUserId]);

  const act = (action: PlayerAction) => socket.emit('player_action', action);

  return (
    <div style={styles.wrap}>
      <div ref={parentRef} style={styles.canvas} />

      {!view && <div style={styles.center}>Dealing…</div>}

      {result && (
        <div style={styles.banner}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            {result.winnerNames.join(', ')} win{result.winnerNames.length === 1 ? 's' : ''}{' '}
            {result.potAmount.toLocaleString()}
          </div>
          {result.handName && <div style={{ opacity: 0.85 }}>{result.handName}</div>}
        </div>
      )}

      {view && <ActionBar state={view} myId={identity.discordUserId} onAction={act} />}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    background: '#14182f',
    overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
    color: '#fff',
  },
  canvas: { position: 'absolute', inset: 0 },
  center: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  banner: {
    position: 'absolute',
    top: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(10,12,28,0.9)',
    border: '1px solid #ffd24a',
    borderRadius: 12,
    padding: '12px 22px',
    textAlign: 'center',
  },
};
