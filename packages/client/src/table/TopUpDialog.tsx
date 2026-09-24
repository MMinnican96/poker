import { useState } from 'react';
import { formatChips, type Ack, type TableRules } from '@poker/shared';
import { AmountInput, Button, ChipAmount, Field, Modal } from '../ui';

/**
 * How much you can add: up to the table maximum (counting chips already queued)
 * and no more than your bankroll.
 */
export function topUpBounds(rules: Pick<TableRules, 'maxBuyIn' | 'bigBlind'>, stack: number, pendingTopUp: number, bankroll: number) {
  const room = Math.max(0, rules.maxBuyIn - stack - pendingTopUp);
  const max = Math.max(0, Math.min(room, bankroll));
  const min = Math.min(max, rules.bigBlind);
  return { min: Math.max(1, min), max, room, canTopUp: max >= 1 };
}

export interface TopUpDialogProps {
  open: boolean;
  onClose(): void;
  rules: TableRules;
  stack: number;
  pendingTopUp: number;
  bankroll: number;
  /** You're in a hand, so the chips arrive when it ends. */
  inHand: boolean;
  onConfirm(amount: number): Promise<Ack>;
}

export function TopUpDialog({ open, onClose, rules, stack, pendingTopUp, bankroll, inHand, onConfirm }: TopUpDialogProps) {
  const b = topUpBounds(rules, stack, pendingTopUp, bankroll);
  const [amount, setAmount] = useState(b.max);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const ack = await onConfirm(amount);
    setBusy(false);
    if (ack.ok) onClose();
    else setError(ack.error);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Top up"
      description={
        inHand
          ? 'The chips move to your stack when this hand ends.'
          : `You can have up to ${formatChips(rules.maxBuyIn)} chips at this table.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!b.canTopUp || amount < b.min || amount > b.max}>
            Add {formatChips(amount)}
          </Button>
        </>
      }
    >
      {b.canTopUp ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Chips to add" aside={<ChipAmount value={amount} />}>
            <AmountInput
              value={amount}
              onChange={setAmount}
              min={b.min}
              max={b.max}
              step={rules.smallBlind}
              label="Chips to add"
              presets={[
                { label: 'Half', value: Math.round(b.max / 2) },
                { label: 'To the maximum', value: b.max },
              ].filter((p, i, all) => p.value >= b.min && all.findIndex((q) => q.value === p.value) === i)}
            />
          </Field>
          <p className="text-[13px] text-muted">
            Stack <ChipAmount value={stack} size="sm" />
            {pendingTopUp > 0 && <> plus <ChipAmount value={pendingTopUp} size="sm" /> on the way</>}. Bankroll <ChipAmount value={bankroll} size="sm" />.
          </p>
        </form>
      ) : (
        <p role="alert" className="rounded-lg bg-walnut-950/60 p-3 text-sm text-stock-dim">
          {b.room <= 0
            ? `You're at the table maximum of ${formatChips(rules.maxBuyIn)} chips.`
            : "Your bankroll is empty. Win some chips back, or claim your daily bonus in the lobby."}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm font-medium text-negative">{error}</p>}
    </Modal>
  );
}
