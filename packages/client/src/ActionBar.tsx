import { useEffect, useState } from 'react';
import type { GameState, PlayerAction } from '@poker/shared';

interface ActionBarProps {
  state: GameState;
  myId: string;
  onAction: (action: PlayerAction) => void;
}

const BETTING_PHASES: GameState['phase'][] = ['pre-flop', 'flop', 'turn', 'river'];

export function ActionBar({ state, myId, onAction }: ActionBarProps) {
  const me = state.players.find((p) => p.discordUserId === myId);
  const isMyTurn =
    BETTING_PHASES.includes(state.phase) &&
    me?.status === 'active' &&
    state.players[state.currentPlayerIndex]?.discordUserId === myId;

  const toCall = me ? state.callAmount - me.betThisRound : 0;
  const maxTotal = me ? me.betThisRound + me.chipStack : 0;
  const minRaiseTotal = Math.min(state.callAmount + state.minRaise, maxTotal);
  const canRaise = !!me && maxTotal > state.callAmount && me.chipStack > toCall;

  const [showRaise, setShowRaise] = useState(false);
  const [raiseTo, setRaiseTo] = useState(minRaiseTotal);

  // Reset the raise widget whenever it stops being our turn or the bet changes.
  useEffect(() => {
    setShowRaise(false);
    setRaiseTo(minRaiseTotal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, state.callAmount, state.handNumber]);

  if (!me || !isMyTurn) return null;

  return (
    <div style={styles.bar}>
      {showRaise ? (
        <div style={styles.raiseRow}>
          <input
            type="range"
            min={minRaiseTotal}
            max={maxTotal}
            step={state.config.smallBlind}
            value={raiseTo}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={styles.raiseValue}>{raiseTo.toLocaleString()}</span>
          <button style={styles.btn} onClick={() => setShowRaise(false)}>
            Cancel
          </button>
          <button
            style={{ ...styles.btn, ...styles.confirm }}
            onClick={() => onAction({ type: 'raise', amount: raiseTo })}
          >
            Raise to {raiseTo.toLocaleString()}
          </button>
        </div>
      ) : (
        <div style={styles.row}>
          <button style={{ ...styles.btn, ...styles.fold }} onClick={() => onAction({ type: 'fold' })}>
            Fold
          </button>
          {toCall === 0 ? (
            <button style={styles.btn} onClick={() => onAction({ type: 'check' })}>
              Check
            </button>
          ) : (
            <button style={styles.btn} onClick={() => onAction({ type: 'call' })}>
              Call {Math.min(toCall, me.chipStack).toLocaleString()}
            </button>
          )}
          {canRaise && (
            <button style={styles.btn} onClick={() => { setRaiseTo(minRaiseTotal); setShowRaise(true); }}>
              Raise
            </button>
          )}
          <button style={{ ...styles.btn, ...styles.allIn }} onClick={() => onAction({ type: 'all-in' })}>
            All-In
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    display: 'flex',
    justifyContent: 'center',
    background: 'linear-gradient(transparent, rgba(10,12,28,0.85))',
  },
  row: { display: 'flex', gap: 10, width: '100%', maxWidth: 560 },
  raiseRow: { display: 'flex', gap: 10, width: '100%', maxWidth: 560, alignItems: 'center' },
  raiseValue: { color: '#ffe9a8', fontWeight: 700, minWidth: 64, textAlign: 'right', fontFamily: 'system-ui' },
  btn: {
    flex: 1,
    padding: '14px 12px',
    borderRadius: 10,
    border: 'none',
    background: '#3a3f65',
    color: '#fff',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif',
  },
  fold: { background: '#7a2a2a' },
  allIn: { background: '#b8860b' },
  confirm: { background: '#5865f2' },
};
