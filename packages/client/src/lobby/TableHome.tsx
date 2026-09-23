import { useState } from 'react';
import { formatChips, type TableSummary } from '@poker/shared';
import { useCommands, useLobby, useMe } from '../app/client';
import { useProfileCard } from '../app/nav';
import { Felt } from '../cosmetics';
import { Button, EyeIcon, Placard, PlacardRow, SeatIcon, Spinner } from '../ui';
import { MiniTable } from './MiniTable';
import { OpenTableDialog } from './OpenTableDialog';
import { seatBlockedReason, TakeSeatDialog } from './TakeSeatDialog';

/** The lobby's main view: open a table, or watch / sit at the one that's open. */
export function TableHome() {
  const lobby = useLobby();
  if (!lobby) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size={28} label="Loading the room" className="text-brass" />
      </div>
    );
  }
  return lobby.table ? <OpenTable table={lobby.table} /> : <NoTable />;
}

function NoTable() {
  const me = useMe();
  const commands = useCommands();
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col items-center justify-center gap-6 p-4 sm:p-6 short:flex-row short:gap-5 short:py-3">
      <div className="relative w-full max-w-2xl short:max-w-none short:flex-[3]">
        <Felt feltId={me.loadout.felt} rail className="aspect-[2/1] w-full" crestScale={0.34} />
      </div>
      <div className="flex max-w-md flex-col items-center gap-3 text-center short:flex-[2] short:gap-2">
        <h1 className="text-3xl text-stock short:text-2xl">The table's empty</h1>
        <p className="text-muted">
          Open a table and set the stakes. Everyone in this room can watch or take a seat.
        </p>
        <Button size="lg" onClick={() => setOpen(true)}>Open a table</Button>
      </div>
      {open && (
        <OpenTableDialog open onClose={() => setOpen(false)} me={me} onSubmit={(rules) => commands.openTable(rules)} />
      )}
    </div>
  );
}

function OpenTable({ table }: { table: TableSummary }) {
  const me = useMe();
  const commands = useCommands();
  const profile = useProfileCard();
  const [seatDialog, setSeatDialog] = useState<{ seat?: number } | null>(null);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { rules } = table;
  const openSeats = table.seats.filter((s) => !s.player).map((s) => s.seat);
  const seated = table.seats.length - openSeats.length;
  const blocked = seatBlockedReason({ openSeats: openSeats.length, minBuyIn: rules.minBuyIn, balance: me.balance });

  const watch = async () => {
    setWatching(true);
    setError(null);
    const ack = await commands.watchTable();
    setWatching(false);
    if (!ack.ok) setError(ack.error);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center gap-5 p-4 sm:p-6 @2xl:flex-row @2xl:items-center short:gap-3 short:py-3 short:@lg:flex-row short:@lg:items-center">
      <div className="min-w-0 @2xl:flex-[3] short:@lg:flex-[3]">
        <MiniTable
          table={table}
          onSeatClick={(seat) => setSeatDialog({ seat })}
          onPlayerClick={profile.open}
          seatBlockedReason={blocked}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-4 @2xl:flex-[2] short:gap-2.5 short:@lg:flex-[2]">
        <Placard
          title={rules.name}
          subtitle={
            table.status === 'running'
              ? `Game on, ${table.handsDealt} ${table.handsDealt === 1 ? 'hand' : 'hands'} dealt`
              : 'Waiting for the host to deal'
          }
        >
          <PlacardRow label="Blinds">{formatChips(rules.smallBlind)} / {formatChips(rules.bigBlind)}</PlacardRow>
          {rules.ante > 0 && <PlacardRow label="Ante">{formatChips(rules.ante)}</PlacardRow>}
          <PlacardRow label="Buy-in">{formatChips(rules.minBuyIn)} to {formatChips(rules.maxBuyIn)}</PlacardRow>
          <PlacardRow label="Seats">{seated} of {rules.maxSeats} taken</PlacardRow>
          <PlacardRow label="Turn timer">{rules.turnSeconds} seconds</PlacardRow>
          <PlacardRow label="Host">{table.hostName ?? 'Nobody'}</PlacardRow>
          <PlacardRow label="Watching">{table.spectatorCount}</PlacardRow>
        </Placard>

        <div className="flex flex-wrap gap-2">
          <Button icon={<SeatIcon size={18} />} onClick={() => setSeatDialog({})} disabled={!!blocked} className="flex-1">
            Take a seat
          </Button>
          <Button variant="ghost" icon={<EyeIcon size={18} />} onClick={watch} loading={watching} className="flex-1">
            Watch
          </Button>
        </div>
        {blocked && <p className="text-sm text-muted">{blocked}</p>}
        {error && <p role="alert" className="text-sm font-medium text-negative">{error}</p>}
      </div>

      {seatDialog && (
        <TakeSeatDialog
          open
          onClose={() => setSeatDialog(null)}
          rules={rules}
          openSeats={openSeats}
          balance={me.balance}
          initialSeat={seatDialog.seat}
          onConfirm={(seat, buyIn) => commands.takeSeat(seat, buyIn)}
        />
      )}
    </div>
  );
}
