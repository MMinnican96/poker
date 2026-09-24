import { useState } from 'react';
import { BLIND_LEVELS, RULE_LIMITS, formatChips, type Ack, type TableRules } from '@poker/shared';
import { ownedOfCategory } from '../cosmetics';
import { FeltPicker, validateTableForm, withBlinds, type TableForm } from '../lobby/OpenTableDialog';
import { AmountInput, Button, ChipAmount, Field, Modal, Segmented, Slider, TextInput } from '../ui';

/** The form state for the rules a table already has. */
export function formFromRules(rules: TableRules): TableForm {
  const blindIndex = Math.max(0, BLIND_LEVELS.findIndex(([s, b]) => s === rules.smallBlind && b === rules.bigBlind));
  return {
    name: rules.name,
    blindIndex,
    ante: rules.ante,
    minBuyIn: rules.minBuyIn,
    maxBuyIn: rules.maxBuyIn,
    maxSeats: rules.maxSeats,
    turnSeconds: rules.turnSeconds,
    feltId: rules.feltId,
  };
}

export interface EditRulesDialogProps {
  open: boolean;
  onClose(): void;
  rules: TableRules;
  /** Highest occupied seat number (seats can't be removed from under someone). */
  highestSeat: number;
  me: { owned: Record<string, number> };
  onSubmit(rules: TableRules): Promise<Ack>;
}

/** The host changes the table's rules before the first hand. */
export function EditRulesDialog({ open, onClose, rules: current, highestSeat, me, onSubmit }: EditRulesDialogProps) {
  const felts = ownedOfCategory(me.owned, 'felt');
  // The table's felt stays pickable even if the host doesn't own it.
  const feltIds = felts.some((f) => f.id === current.feltId) ? felts.map((f) => f.id) : [current.feltId, ...felts.map((f) => f.id)];
  const [form, setForm] = useState<TableForm>(() => formFromRules(current));
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Balance isn't checked when editing: the host may already be seated.
  const owned = { ...me.owned, [current.feltId]: 1 };
  const { errors, rules } = validateTableForm(form, { balance: Number.MAX_SAFE_INTEGER, owned });
  const seatError = form.maxSeats <= highestSeat ? `Seat ${highestSeat + 1} is taken, so keep at least ${highestSeat + 1} seats.` : undefined;
  const [sb, bb] = BLIND_LEVELS[form.blindIndex];
  const set = <K extends keyof TableForm>(key: K, value: TableForm[K]) => {
    setServerError(null);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const submit = async () => {
    if (!rules || seatError) return;
    setBusy(true);
    const ack = await onSubmit(rules);
    setBusy(false);
    if (ack.ok) onClose();
    else setServerError(ack.error);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Edit rules"
      description="Rules lock when the first hand is dealt."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="edit-rules-form" loading={busy} disabled={!rules || !!seatError}>Save rules</Button>
        </>
      }
    >
      <form
        id="edit-rules-form"
        noValidate
        className="grid gap-x-6 gap-y-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Table name" error={errors.name} className="sm:col-span-2">
          <TextInput value={form.name} maxLength={RULE_LIMITS.nameMax + 8} onChange={(e) => set('name', e.target.value)} autoComplete="off" data-autofocus />
        </Field>
        <Field label="Blinds" group error={errors.blindIndex} className="sm:col-span-2" hint="Small blind / big blind. Changing them resets the buy-in range.">
          <Segmented
            size="sm"
            options={BLIND_LEVELS.map(([s, b], i) => ({ value: i, label: `${formatChips(s)}/${formatChips(b)}` }))}
            value={form.blindIndex}
            onChange={(i) => {
              setServerError(null);
              setForm((f) => withBlinds(f, i));
            }}
          />
        </Field>
        <Field label="Ante" aside={form.ante === 0 ? 'None' : <ChipAmount value={form.ante} size="sm" />} error={errors.ante}>
          <Slider value={form.ante} onChange={(v) => set('ante', v)} min={0} max={sb} step={Math.max(1, Math.round(sb / 5))} valueText={(v) => (v === 0 ? 'No ante' : `${v} chips`)} />
        </Field>
        <Field label="Seats" group error={errors.maxSeats ?? seatError}>
          <Segmented
            size="sm"
            options={Array.from({ length: RULE_LIMITS.seatsMax - RULE_LIMITS.seatsMin + 1 }, (_, i) => {
              const n = i + RULE_LIMITS.seatsMin;
              return { value: n, label: String(n), disabled: n <= highestSeat };
            })}
            value={form.maxSeats}
            onChange={(v) => set('maxSeats', v)}
          />
        </Field>
        <Field label="Minimum buy-in" error={errors.minBuyIn} hint={`${Math.round(form.minBuyIn / bb)} big blinds`}>
          <AmountInput value={form.minBuyIn} onChange={(v) => set('minBuyIn', v)} min={bb * RULE_LIMITS.minBuyInBb} max={bb * RULE_LIMITS.maxBuyInBb} step={bb} />
        </Field>
        <Field label="Maximum buy-in" error={errors.maxBuyIn} hint={`${Math.round(form.maxBuyIn / bb)} big blinds`}>
          <AmountInput value={form.maxBuyIn} onChange={(v) => set('maxBuyIn', v)} min={bb * RULE_LIMITS.minBuyInBb} max={bb * RULE_LIMITS.maxBuyInBb} step={bb} />
        </Field>
        <Field label="Turn timer" aside={`${form.turnSeconds} seconds`} error={errors.turnSeconds} className="sm:col-span-2">
          <Slider value={form.turnSeconds} onChange={(v) => set('turnSeconds', v)} min={RULE_LIMITS.turnMin} max={RULE_LIMITS.turnMax} step={RULE_LIMITS.turnStep} valueText={(v) => `${v} seconds`} />
        </Field>
        <Field label="Felt" group error={errors.feltId} className="sm:col-span-2">
          <FeltPicker
            felts={feltIds.map((id) => ({ id, name: felts.find((f) => f.id === id)?.name ?? 'Current felt' }))}
            value={form.feltId}
            onChange={(id) => set('feltId', id)}
          />
        </Field>
        {(serverError || errors.form) && (
          <p role="alert" className="rounded-lg bg-chip-dark/40 px-3 py-2 text-sm font-medium text-stock ring-1 ring-chip/60 sm:col-span-2">
            {serverError ?? errors.form}
          </p>
        )}
      </form>
    </Modal>
  );
}
