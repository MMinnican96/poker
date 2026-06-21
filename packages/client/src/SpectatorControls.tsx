import type { GameState } from '@poker/shared';

interface Props {
  state: GameState;
  myId: string;
  bankroll: number;
  onSitIn: () => void;
  onSitOut: () => void;
  onLeave: () => void;
  onCancelPending: () => void;
}

export function SpectatorControls({ state, myId, bankroll, onSitIn, onSitOut, onLeave, onCancelPending }: Props) {
  const seated = state.players.some((p) => p.discordUserId === myId);
  const spectators = state.spectators ?? [];
  const pending = state.viewerPending ?? null;
  const seatFull = state.players.length >= state.config.maxPlayers;
  const underfunded = bankroll < state.config.buyIn;
  const canSit = !seatFull && !underfunded;
  const sitReason = seatFull ? 'Table is full' : underfunded ? 'Not enough chips for the buy-in' : '';

  return (
    <div style={S.wrap}>
      <div style={S.eye} title={spectators.map((s) => s.displayName).join(', ') || 'No spectators'}>
        👁 {spectators.length}
      </div>

      {state.waitingForPlayers && <div style={S.waiting}>Waiting for players…</div>}

      {!seated ? (
        <div style={S.bar}>
          <span style={S.note}>You're watching</span>
          {pending === 'seat' ? (
            <button style={S.btn} onClick={onCancelPending}>Cancel — joining next hand</button>
          ) : (
            <button style={canSit ? S.btn : S.btnDisabled} disabled={!canSit} title={sitReason} onClick={onSitIn}>
              Join Next Hand
            </button>
          )}
          <button style={S.btn} onClick={onLeave}>Leave Table</button>
        </div>
      ) : (
        <div style={S.bar}>
          {pending === 'spectate' && <button style={S.btn} onClick={onCancelPending}>Cancel — spectating after hand</button>}
          {pending === 'leave' && <button style={S.btn} onClick={onCancelPending}>Cancel — leaving after hand</button>}
          {pending === null && (
            <>
              <button style={S.btn} onClick={onSitOut}>Move to Spectate</button>
              <button style={S.btn} onClick={onLeave}>Leave Table</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' },
  eye: { background: 'rgba(10,12,28,0.8)', borderRadius: 999, padding: '4px 10px', fontSize: 14, cursor: 'default' },
  waiting: { background: 'rgba(10,12,28,0.85)', borderRadius: 8, padding: '6px 12px', color: '#ffe9a8' },
  bar: { display: 'flex', gap: 8, alignItems: 'center' },
  note: { opacity: 0.8, fontSize: 13 },
  btn: { padding: '8px 12px', borderRadius: 8, border: 'none', background: '#3a3f65', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  btnDisabled: { padding: '8px 12px', borderRadius: 8, border: 'none', background: '#2a2d44', color: '#8a8da6', cursor: 'not-allowed' },
};
