import type { LobbyStatus, TableConfig } from '@poker/shared';

export const BLIND_LADDER: [number, number][] = [
  [10, 20],
  [25, 50],
  [25, 100],
  [50, 100],
  [100, 200],
  [200, 400],
];

const DEFAULT_BLIND_INDEX = 1; // [25, 50]

export function currentBlindIndex(smallBlind: number, bigBlind: number): number {
  const i = BLIND_LADDER.findIndex(([s, b]) => s === smallBlind && b === bigBlind);
  return i === -1 ? DEFAULT_BLIND_INDEX : i;
}

export interface TableSettingsProps {
  config: TableConfig;
  canEditConfig: boolean;
  isHost: boolean;
  hostExists: boolean;
  status: LobbyStatus;
  readyCount: number;
  playerCount: number;
  secondsLeft: number;
  meIsReady: boolean;
  canStart: boolean;
  insufficientChips: boolean;
  onUpdateConfig: (patch: Partial<TableConfig>) => void;
  onCreateGame: () => void;
  onCancelGame: () => void;
  onReadyToggle: () => void;
  onStartCountdown: () => void;
  onCancelCountdown: () => void;
  onLeave: () => void;
}

function Stepper({
  label,
  hint,
  value,
  editable,
  onDown,
  onUp,
  decLabel,
  incLabel,
}: {
  label: string;
  hint: string;
  value: string;
  editable: boolean;
  onDown: () => void;
  onUp: () => void;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3.5 rounded-2xl border-2 border-black/30 bg-felt-600 py-[15px] pl-[22px] pr-4">
      <div className="flex flex-col leading-tight">
        <span className="text-xs font-extrabold tracking-[0.12em] text-sage">{label}</span>
        <span className="mt-[3px] font-display text-[15px] font-semibold text-sage-light">{hint}</span>
      </div>
      {editable ? (
        <div className="flex items-center gap-3">
          <button
            aria-label={decLabel}
            onClick={onDown}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border-[2.5px] border-ink bg-felt-300 font-display text-2xl leading-none text-cream shadow-hard-ink-sm active:translate-y-0.5"
          >
            −
          </button>
          <span className="min-w-[78px] text-center font-display text-[26px] font-bold text-gold">
            {value}
          </span>
          <button
            aria-label={incLabel}
            onClick={onUp}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border-[2.5px] border-ink bg-felt-300 font-display text-2xl leading-none text-cream shadow-hard-ink-sm active:translate-y-0.5"
          >
            +
          </button>
        </div>
      ) : (
        <span className="font-display text-[26px] font-bold text-gold">{value}</span>
      )}
    </div>
  );
}

export function TableSettings(props: TableSettingsProps) {
  const {
    config,
    canEditConfig,
    isHost,
    hostExists,
    status,
    readyCount,
    playerCount,
    secondsLeft,
    meIsReady,
    canStart,
    insufficientChips,
    onUpdateConfig,
    onCreateGame,
    onCancelGame,
    onReadyToggle,
    onStartCountdown,
    onCancelCountdown,
    onLeave,
  } = props;

  const blindIdx = currentBlindIndex(config.smallBlind, config.bigBlind);
  const cdRunning = status === 'countdown';

  const buyInUp = () => onUpdateConfig({ buyIn: config.buyIn + 500 });
  const buyInDown = () => onUpdateConfig({ buyIn: Math.max(500, config.buyIn - 500) });
  const blindsUp = () => {
    const i = Math.min(BLIND_LADDER.length - 1, blindIdx + 1);
    onUpdateConfig({ smallBlind: BLIND_LADDER[i][0], bigBlind: BLIND_LADDER[i][1] });
  };
  const blindsDown = () => {
    const i = Math.max(0, blindIdx - 1);
    onUpdateConfig({ smallBlind: BLIND_LADDER[i][0], bigBlind: BLIND_LADDER[i][1] });
  };
  const timerUp = () => onUpdateConfig({ turnSeconds: Math.min(120, config.turnSeconds + 5) });
  const timerDown = () => onUpdateConfig({ turnSeconds: Math.max(10, config.turnSeconds - 5) });

  const statusText = cdRunning
    ? secondsLeft === 0
      ? 'Dealing in…'
      : `Starting in ${secondsLeft}s`
    : 'Waiting to start';

  return (
    <div className="relative mx-auto w-full max-w-[740px] py-7">
      {/* top straddle pill: READY STATUS */}
      <div className="absolute left-1/2 top-0.5 z-[4] flex -translate-x-1/2 items-center gap-2.5 rounded-pill border-[2.5px] border-ink bg-felt-800 py-2 pl-[18px] pr-2.5 shadow-pill">
        <span className="font-display text-[13px] font-semibold tracking-[0.12em] text-[#cfeadd]">
          READY STATUS
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-pill border-2 border-mint-border bg-mint px-3 py-1 font-display text-[13px] font-bold text-felt-900">
          <span className="h-2 w-2 rounded-pill bg-felt-900" />
          {readyCount} / {playerCount} READY
        </span>
      </div>

      {/* card */}
      <div className="rounded-[28px] border-[2.5px] border-black/30 bg-felt-500 px-9 pb-14 pt-[54px] shadow-tablecard">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-extrabold tracking-[0.22em] text-sage">THE TABLE</span>
            <span className="whitespace-nowrap font-display text-[28px] font-semibold leading-tight text-white">
              Table Settings
            </span>
          </div>
          <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-pill border-2 border-gold/35 bg-gold/15 px-3 py-1.5 text-xs font-extrabold text-gold-soft">
            ♠ Hold&apos;em
          </span>
        </div>

        <p className="mb-[22px] mt-1 text-sm font-bold text-sage-muted">
          {!hostExists
            ? 'Set up the table, then create a game for everyone to join.'
            : isHost
              ? "You're the host — tweak the table, then deal everyone in."
              : 'Only the host can change these. Sit tight!'}
        </p>

        <div className="flex flex-col gap-3">
          <Stepper
            label="BUY-IN"
            hint="Chips to sit down"
            value={config.buyIn.toLocaleString()}
            editable={canEditConfig}
            onDown={buyInDown}
            onUp={buyInUp}
            decLabel="Decrease buy-in"
            incLabel="Increase buy-in"
          />
          <Stepper
            label="BLINDS"
            hint="Small / Big"
            value={`${config.smallBlind} / ${config.bigBlind}`}
            editable={canEditConfig}
            onDown={blindsDown}
            onUp={blindsUp}
            decLabel="Decrease blinds"
            incLabel="Increase blinds"
          />
          <Stepper
            label="TURN TIMER"
            hint="Seconds to act"
            value={`${config.turnSeconds}s`}
            editable={canEditConfig}
            onDown={timerDown}
            onUp={timerUp}
            decLabel="Decrease turn timer"
            incLabel="Increase turn timer"
          />
        </div>

        {insufficientChips && (
          <p className="mt-4 text-sm font-bold text-red">
            You need {config.buyIn.toLocaleString()} chips to join this table.
          </p>
        )}

        <div className="my-6 h-0.5 rounded bg-black/25" />

        {/* ACTION */}
        {cdRunning ? (
          <div className="flex items-center gap-4">
            <div className="flex flex-1 items-center gap-4 rounded-2xl border-[2.5px] border-mint-border bg-felt-800 px-[22px] py-3.5">
              <span className="min-w-[54px] text-center font-display text-[44px] font-bold leading-none text-mint">
                {secondsLeft}
              </span>
              <div className="flex flex-col leading-tight">
                <span className="font-display text-lg font-semibold text-white">Game starting…</span>
                <span className="text-[13px] font-bold text-sage-muted">
                  Take your seat — cards are coming out.
                </span>
              </div>
            </div>
            {meIsReady && (
              <button
                onClick={onCancelCountdown}
                className="rounded-2xl border-[2.5px] border-red-border bg-red px-6 py-[15px] font-display text-base font-semibold text-white shadow-hard-red active:translate-y-[3px]"
              >
                Cancel
              </button>
            )}
          </div>
        ) : !hostExists ? (
          <button
            onClick={onCreateGame}
            disabled={insufficientChips}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border-[3px] border-gold-border bg-gold p-[18px] font-display text-[21px] font-semibold text-[#2a1c00] shadow-hard-gold-lg transition-transform hover:-translate-y-px active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ♠ CREATE A GAME
          </button>
        ) : isHost ? (
          <div className="flex items-center gap-3.5">
            <button
              onClick={onStartCountdown}
              disabled={!canStart}
              className="flex flex-1 items-center justify-center gap-3 rounded-2xl border-[3px] border-gold-border bg-gold p-[18px] font-display text-[21px] font-semibold text-[#2a1c00] shadow-hard-gold-lg transition-transform hover:-translate-y-px active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ♠ START GAME
            </button>
            <button
              onClick={onCancelGame}
              className="rounded-2xl border-[2.5px] border-red-border bg-red px-6 py-[18px] font-display text-base font-semibold text-white shadow-hard-red active:translate-y-[3px]"
            >
              Cancel Game
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3.5">
            <button
              onClick={onReadyToggle}
              disabled={insufficientChips}
              className="flex flex-1 items-center gap-3 rounded-2xl border-[2.5px] border-dashed border-gold/40 bg-gold/10 px-[22px] py-4 font-display text-[17px] font-semibold text-gold-soft disabled:opacity-50"
            >
              <span className="h-2.5 w-2.5 rounded-pill bg-gold" />
              {meIsReady ? 'Ready — waiting for host…' : 'Tap to ready up'}
            </button>
            <button
              onClick={onLeave}
              className="rounded-2xl border-[2.5px] border-red-border bg-red px-6 py-4 font-display text-base font-semibold text-white shadow-hard-red active:translate-y-[3px]"
            >
              Leave
            </button>
          </div>
        )}
      </div>

      {/* bottom straddle pill: TABLE STATUS */}
      <div className="absolute bottom-0.5 left-1/2 z-[4] flex -translate-x-1/2 items-center gap-2.5 rounded-pill border-[2.5px] border-ink bg-felt-800 px-[18px] py-2 shadow-pill">
        <span className="font-display text-[13px] font-semibold tracking-[0.12em] text-[#cfeadd]">
          TABLE STATUS
        </span>
        <span className={`h-[7px] w-[7px] rounded-pill ${cdRunning ? 'bg-mint' : 'bg-[#ffcb52]'}`} />
        <span className={`font-display text-[13px] font-semibold ${cdRunning ? 'text-mint' : 'text-sage-muted'}`}>
          {statusText}
        </span>
      </div>
    </div>
  );
}
