import { useState } from 'react';
import { formatChips, type Ack } from '@poker/shared';
import { useCommands, useTable } from '../app/client';
import { Felt, PlayingCard } from '../cosmetics';
import { TakeSeatDialog } from '../lobby/TakeSeatDialog';
import { Button, ChipAmount, Surface } from '../ui';

/**
 * PLACEHOLDER table screen — replaced by the table agent in wave 2. Shows the
 * raw table state with working host/seat controls so the lobby flow can be
 * exercised end to end.
 */
export function TableScreen() {
  const table = useTable();
  const commands = useCommands();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seating, setSeating] = useState(false);
  if (!table) return null;

  const run = (key: string, fn: () => Promise<Ack>) => async () => {
    setBusy(key);
    setError(null);
    const ack = await fn();
    setBusy(null);
    if (!ack.ok) setError(ack.error);
  };
  const { you, rules, hand } = table;
  const isHost = table.hostId === you.id;
  const openSeats = table.seats.filter((s) => !s.player).map((s) => s.seat);

  return (
    <div className="flex h-dvh flex-col gap-3 overflow-y-auto bg-walnut-900 p-3 sm:p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl">{rules.name}</h1>
        {isHost && table.status === 'open' && (
          <Button onClick={run('start', commands.startTable)} loading={busy === 'start'}>Deal the first hand</Button>
        )}
        {you.role === 'spectator' && (
          <Button variant="brass" onClick={() => setSeating(true)} disabled={openSeats.length === 0}>Take a seat</Button>
        )}
        {you.role === 'seated' && (
          <Button variant="ghost" onClick={run('stand', commands.standUp)} loading={busy === 'stand'} disabled={you.pending === 'stand'}>
            {you.pending === 'stand' ? 'Standing up after this hand' : 'Stand up'}
          </Button>
        )}
        <Button variant="danger" onClick={run('leave', commands.leaveTable)} loading={busy === 'leave'} disabled={you.pending === 'leave'}>
          {you.pending === 'leave' ? 'Leaving after this hand' : 'Leave table'}
        </Button>
      </header>
      {error && <p role="alert" className="text-sm font-medium text-negative">{error}</p>}

      <Felt feltId={rules.feltId} rail className="mx-auto aspect-[2/1] w-full max-w-3xl">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="flex gap-1.5">
            {hand?.board.map((c) => <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="sm" />)}
          </div>
          {hand && <ChipAmount value={hand.potTotal} size="lg" />}
          <p className="text-sm text-stock-dim">
            {table.status === 'open' ? 'Waiting for the host to deal' : hand ? `Hand ${hand.handNumber}, ${hand.street}` : 'Between hands'}
          </p>
        </div>
      </Felt>

      <Surface tone="well" className="mx-auto w-full max-w-3xl p-3">
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {table.seats.map(({ seat, player }) => (
            <li key={seat} className="flex items-center gap-2">
              <span className="tabular w-14 text-muted">Seat {seat + 1}</span>
              {player ? (
                <>
                  <span className="font-semibold">{player.name}</span>
                  <ChipAmount value={player.stack} size="sm" />
                  {player.holeCards && player.holeCards.map((c) => <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="xs" />)}
                  <span className="text-muted">{player.folded ? 'folded' : player.state}</span>
                  {hand?.toActSeat === seat && <span className="text-brass">to act</span>}
                </>
              ) : (
                <span className="text-muted">Empty</span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[13px] text-muted">
          You are {you.role === 'seated' ? `in seat ${(you.seat ?? 0) + 1}` : 'watching'}. Bankroll {formatChips(you.bankroll)}. {table.spectators.length} watching.
        </p>
      </Surface>

      {seating && (
        <TakeSeatDialog
          open
          onClose={() => setSeating(false)}
          rules={rules}
          openSeats={openSeats}
          balance={you.bankroll}
          onConfirm={(seat, buyIn) => commands.takeSeat(seat, buyIn)}
        />
      )}
    </div>
  );
}
