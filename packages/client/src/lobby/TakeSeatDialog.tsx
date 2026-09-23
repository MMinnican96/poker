import { useState } from 'react';
import { formatChips, type Ack, type TableRules } from '@poker/shared';
import { AmountInput, Button, ChipAmount, Field, Modal, Segmented } from '../ui';

/** What you can buy in for: [minBuyIn, min(maxBuyIn, balance)]. */
export function buyInBounds(rules: Pick<TableRules, 'minBuyIn' | 'maxBuyIn'>, balance: number) {
  const max = Math.min(rules.maxBuyIn, balance);
  return { min: rules.minBuyIn, max, canAfford: max >= rules.minBuyIn };
}

/** Starting buy-in: 100 big blinds, kept inside the bounds. */
export function defaultBuyIn(rules: Pick<TableRules, 'minBuyIn' | 'maxBuyIn' | 'bigBlind'>, balance: number): number {
  const { min, max } = buyInBounds(rules, balance);
  return Math.max(min, Math.min(max, rules.bigBlind * 100));
}

/** Why a player can't sit down, or null when they can. */
export function seatBlockedReason(opts: { openSeats: number; minBuyIn: number; balance: number; closing?: boolean }): string | null {
  if (opts.closing) return 'The table is closing.';
  if (opts.openSeats === 0) return 'Every seat is taken.';
  if (opts.balance < opts.minBuyIn) return `You need ${formatChips(opts.minBuyIn)} chips to buy in. You have ${formatChips(opts.balance)}.`;
  return null;
}

export interface TakeSeatDialogProps {
  open: boolean;
  onClose(): void;
  rules: TableRules;
  /** Empty seat numbers (0-based). */
  openSeats: number[];
  /** Your off-table chips. */
  balance: number;
  /** Seat to preselect (e.g. the one clicked). */
  initialSeat?: number;
  onConfirm(seat: number, buyIn: number): Promise<Ack>;
}

/** Pick an empty seat and a buy-in within the table's range and your bankroll. */
export function TakeSeatDialog({ open, onClose, rules, openSeats, balance, initialSeat, onConfirm }: TakeSeatDialogProps) {
  const bounds = buyInBounds(rules, balance);
  const [seat, setSeat] = useState<number>(initialSeat !== undefined && openSeats.includes(initialSeat) ? initialSeat : openSeats[0] ?? 0);
  const [buyIn, setBuyIn] = useState(() => defaultBuyIn(rules, balance));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seatTaken = !openSeats.includes(seat);
  const canSubmit = bounds.canAfford && !seatTaken && buyIn >= bounds.min && buyIn <= bounds.max && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const ack = await onConfirm(seat, buyIn);
    setBusy(false);
    if (ack.ok) onClose();
    else setError(ack.error);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Take a seat"
      description={`Buy in for ${formatChips(rules.minBuyIn)} to ${formatChips(rules.maxBuyIn)} chips. You're dealt in from the next hand.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Sit down with {formatChips(buyIn)}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <Field label="Seat" group error={seatTaken ? 'Someone just took that seat. Pick another.' : undefined}>
          <Segmented<number>
            options={Array.from({ length: rules.maxSeats }, (_, s) => ({
              value: s,
              label: String(s + 1),
              ariaLabel: `Seat ${s + 1}${openSeats.includes(s) ? '' : ', taken'}`,
              disabled: !openSeats.includes(s),
            }))}
            value={seat}
            onChange={setSeat}
            size="sm"
          />
        </Field>
        {bounds.canAfford ? (
          <Field
            label="Buy-in"
            aside={<ChipAmount value={buyIn} />}
            hint={
              bounds.max < rules.maxBuyIn
                ? `Up to ${formatChips(bounds.max)}: that's your whole bankroll.`
                : `Between ${formatChips(bounds.min)} and ${formatChips(bounds.max)} chips.`
            }
          >
            <AmountInput
              value={buyIn}
              onChange={setBuyIn}
              min={bounds.min}
              max={bounds.max}
              step={rules.smallBlind}
              label="Buy-in"
              presets={[
                { label: 'Minimum', value: bounds.min },
                { label: '100 big blinds', value: rules.bigBlind * 100 },
                { label: 'Maximum', value: bounds.max },
              ].filter((p, i, all) => p.value >= bounds.min && p.value <= bounds.max && all.findIndex((q) => q.value === p.value) === i)}
            />
          </Field>
        ) : (
          <p role="alert" className="rounded-lg bg-walnut-950/60 p-3 text-sm text-negative">
            You need {formatChips(rules.minBuyIn)} chips to buy in. You have {formatChips(balance)}.
          </p>
        )}
        {error && <p role="alert" className="text-sm font-medium text-negative">{error}</p>}
        {bounds.canAfford && (
          <p className="text-[13px] text-muted">
            Bankroll after buying in: <ChipAmount value={balance - buyIn} size="sm" />
          </p>
        )}
      </form>
    </Modal>
  );
}
