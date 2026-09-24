import { useState } from 'react';
import type { TableView } from '@poker/shared';
import { useAppState, useCommands, useMe, useTable } from '../app/client';
import { useMediaQuery } from '../app/hooks';
import { RoomChat, useUnseenRoomMessages } from '../lobby/RoomPanel';
import { seatBlockedReason, TakeSeatDialog } from '../lobby/TakeSeatDialog';
import { Button, CloseIcon, Drawer, IconButton } from '../ui';
import { IdleMessage } from './CenterCluster';
import { EditRulesDialog } from './EditRulesDialog';
import { HeroDock } from './HeroDock';
import { useRun } from './hooks';
import { useTableSounds } from './sound/useTableSounds';
import { TableMenu } from './TableMenu';
import { TableStage } from './TableStage';
import { TopBar } from './TopBar';
import { TopUpDialog } from './TopUpDialog';
import './table.css';

/** Seated players who'd be dealt into the next hand. */
export function readyPlayers(view: TableView): number {
  return view.seats.filter((s) => s.player && !s.player.sittingOut && s.player.connected && s.player.stack > 0 && s.player.pending === null).length;
}

type Dialog = { kind: 'seat'; seat?: number } | { kind: 'topup' } | { kind: 'rules' } | null;

/** What the middle of the felt says between hands. */
function Idle({ view, onStart, starting }: { view: TableView; onStart(): void; starting: boolean }) {
  const ready = readyPlayers(view);
  const isHost = view.hostId === view.you.id;
  if (view.status === 'open') {
    if (isHost) {
      return (
        <IdleMessage
          title={ready >= 2 ? 'Ready when you are' : 'Waiting for players'}
          body={ready >= 2 ? `${ready} players are seated.` : 'The game needs two seated players.'}
          action={
            <Button size="sm" onClick={onStart} loading={starting} disabled={ready < 2}>
              Start the game
            </Button>
          }
        />
      );
    }
    const host = view.seats.find((s) => s.player?.id === view.hostId)?.player?.name
      ?? view.spectators.find((p) => p.id === view.hostId)?.name;
    return <IdleMessage title="Waiting for the host to start" body={host ? `${host} deals the first hand.` : undefined} />;
  }
  if (ready < 2) return <IdleMessage title="Waiting for players" body="Hands deal as soon as two players are in." />;
  return <IdleMessage title="Shuffling up" />;
}

/**
 * The table: the felt with everyone around it, your controls underneath, and
 * the table menu, chat and dialogs on top.
 */
export function TableScreen() {
  const table = useTable();
  if (!table) return null;
  return <Table view={table} />;
}

function Table({ view }: { view: TableView }) {
  const commands = useCommands();
  const me = useMe();
  const connection = useAppState((s) => s.connection);
  const portrait = useMediaQuery('(max-aspect-ratio: 4/5)');
  const narrow = useMediaQuery('(max-width: 559px)');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState(false);
  const [chat, setChat] = useState(false);
  const unseen = useUnseenRoomMessages(chat);
  const [run, busy] = useRun();
  useTableSounds(view);

  const { you, rules } = view;
  const openSeats = view.seats.filter((s) => !s.player).map((s) => s.seat);
  const seated = you.role === 'seated';
  const blocked = seated ? null : seatBlockedReason({ openSeats: openSeats.length, minBuyIn: rules.minBuyIn, balance: you.bankroll, closing: view.closing });
  const mine = seated ? view.seats.find((s) => s.player?.id === you.id)?.player ?? null : null;
  const highestSeat = Math.max(-1, ...view.seats.filter((s) => s.player).map((s) => s.seat));

  const banner = view.closing ? (
    <p role="status" className="rounded-full bg-chip-dark/90 px-3 py-1 text-center text-[13px] font-semibold text-stock shadow-lift ring-1 ring-chip">
      The host is closing the table after this hand.
    </p>
  ) : connection === 'offline' ? (
    <p role="status" className="rounded-full bg-walnut-950/90 px-3 py-1 text-center text-[13px] font-semibold text-stock ring-1 ring-walnut-600">
      Lost the connection. Reconnecting.
    </p>
  ) : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-walnut-900 lamp-glow">
      <TopBar view={view} unseenChat={unseen} onOpenChat={() => setChat(true)} onOpenMenu={() => setMenu(true)} />
      <main className="relative flex min-h-0 flex-1 flex-col" id="main">
        <TableStage
          view={view}
          canSit={!seated && !view.closing}
          sitBlockedReason={blocked}
          onSit={(seat) => setDialog({ kind: 'seat', seat })}
          idle={<Idle view={view} onStart={() => void run('start', commands.startTable)} starting={busy === 'start'} />}
          banner={banner}
        />
      </main>
      <HeroDock view={view} narrow={narrow || portrait} onTakeSeat={() => setDialog({ kind: 'seat' })} sitBlockedReason={blocked} />

      <TableMenu
        open={menu}
        onClose={() => setMenu(false)}
        view={view}
        readyCount={readyPlayers(view)}
        onTakeSeat={() => {
          setMenu(false);
          setDialog({ kind: 'seat' });
        }}
        onTopUp={() => {
          setMenu(false);
          setDialog({ kind: 'topup' });
        }}
        onEditRules={() => {
          setMenu(false);
          setDialog({ kind: 'rules' });
        }}
      />

      <Drawer open={chat} onClose={() => setChat(false)} label="Room chat">
        <div className="flex items-center justify-between border-b border-walnut-700 px-4 py-2">
          <h2 className="text-lg">Room chat</h2>
          <IconButton label="Close" size="sm" onClick={() => setChat(false)}>
            <CloseIcon size={18} />
          </IconButton>
        </div>
        <RoomChat />
      </Drawer>

      {dialog?.kind === 'seat' && (
        <TakeSeatDialog
          open
          onClose={() => setDialog(null)}
          rules={rules}
          openSeats={openSeats}
          balance={you.bankroll}
          initialSeat={dialog.seat}
          onConfirm={(seat, buyIn) => commands.takeSeat(seat, buyIn)}
        />
      )}
      {dialog?.kind === 'topup' && mine && (
        <TopUpDialog
          open
          onClose={() => setDialog(null)}
          rules={rules}
          stack={mine.stack}
          pendingTopUp={you.pendingTopUp}
          bankroll={you.bankroll}
          inHand={!!mine.inHand && !!view.hand && !view.hand.result}
          onConfirm={(amount) => commands.topUp(amount)}
        />
      )}
      {dialog?.kind === 'rules' && (
        <EditRulesDialog
          open
          onClose={() => setDialog(null)}
          rules={rules}
          highestSeat={highestSeat}
          me={me}
          onSubmit={(r) => commands.updateRules(r)}
        />
      )}
    </div>
  );
}
