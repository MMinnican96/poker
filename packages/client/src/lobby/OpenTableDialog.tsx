import { useRef, useState, type KeyboardEvent } from 'react';
import {
  BLIND_LEVELS,
  DEFAULT_RULES,
  RULE_LIMITS,
  formatChips,
  validateRules,
  type Ack,
  type ShopItem,
  type TableRules,
} from '@poker/shared';
import { Felt, owns, ownedOfCategory } from '../cosmetics';
import { AmountInput, Button, ChipAmount, Field, Modal, Segmented, Slider, TextInput, cx } from '../ui';

export interface TableForm {
  name: string;
  /** Index into BLIND_LEVELS. */
  blindIndex: number;
  ante: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxSeats: number;
  turnSeconds: number;
  feltId: string;
}

export type TableFormErrors = Partial<Record<keyof TableForm | 'form', string>>;

export function defaultTableForm(feltId = DEFAULT_RULES.feltId): TableForm {
  const blindIndex = Math.max(0, BLIND_LEVELS.findIndex(([s, b]) => s === DEFAULT_RULES.smallBlind && b === DEFAULT_RULES.bigBlind));
  const bb = BLIND_LEVELS[blindIndex][1];
  return {
    name: DEFAULT_RULES.name,
    blindIndex,
    ante: 0,
    minBuyIn: bb * 20,
    maxBuyIn: bb * 100,
    maxSeats: DEFAULT_RULES.maxSeats,
    turnSeconds: DEFAULT_RULES.turnSeconds,
    feltId,
  };
}

/** New blinds reset the buy-in range to 20–100 big blinds and cap the ante. */
export function withBlinds(form: TableForm, blindIndex: number): TableForm {
  const [sb, bb] = BLIND_LEVELS[blindIndex];
  return { ...form, blindIndex, ante: Math.min(form.ante, sb), minBuyIn: bb * 20, maxBuyIn: bb * 100 };
}

export function formToRules(form: TableForm): TableRules {
  const [smallBlind, bigBlind] = BLIND_LEVELS[form.blindIndex] ?? [NaN, NaN];
  return {
    name: form.name.replace(/\s+/g, ' ').trim(),
    smallBlind,
    bigBlind,
    ante: form.ante,
    minBuyIn: form.minBuyIn,
    maxBuyIn: form.maxBuyIn,
    maxSeats: form.maxSeats,
    turnSeconds: form.turnSeconds,
    feltId: form.feltId,
  };
}

/**
 * Field-level checks mirroring the shared `validateRules`, plus the server's
 * extra checks (you own the felt, you can afford the minimum buy-in). Returns
 * the rules when everything passes.
 */
export function validateTableForm(form: TableForm, me: { balance: number; owned: Record<string, number> }): { errors: TableFormErrors; rules: TableRules | null } {
  const L = RULE_LIMITS;
  const r = formToRules(form);
  const errors: TableFormErrors = {};
  const isInt = Number.isInteger;
  if (r.name.length === 0) errors.name = 'Give the table a name.';
  else if (r.name.length > L.nameMax) errors.name = `Keep the name to ${L.nameMax} characters.`;
  if (!BLIND_LEVELS[form.blindIndex]) errors.blindIndex = 'Pick one of the listed blind levels.';
  if (!isInt(r.ante) || r.ante < 0 || r.ante > r.smallBlind) errors.ante = `The ante must be between 0 and the small blind (${formatChips(r.smallBlind)}).`;
  if (!isInt(r.minBuyIn) || r.minBuyIn < r.bigBlind * L.minBuyInBb) {
    errors.minBuyIn = `The minimum buy-in must be at least ${L.minBuyInBb} big blinds (${formatChips(r.bigBlind * L.minBuyInBb)}).`;
  } else if (r.minBuyIn > me.balance) {
    errors.minBuyIn = `You need ${formatChips(r.minBuyIn)} chips to sit at your own table. You have ${formatChips(me.balance)}.`;
  }
  if (!isInt(r.maxBuyIn) || r.maxBuyIn > r.bigBlind * L.maxBuyInBb) {
    errors.maxBuyIn = `The maximum buy-in can be at most ${L.maxBuyInBb} big blinds (${formatChips(r.bigBlind * L.maxBuyInBb)}).`;
  } else if (r.maxBuyIn < r.minBuyIn) {
    errors.maxBuyIn = 'The maximum buy-in must be at least the minimum.';
  }
  if (!isInt(r.maxSeats) || r.maxSeats < L.seatsMin || r.maxSeats > L.seatsMax) errors.maxSeats = `Seats must be ${L.seatsMin}–${L.seatsMax}.`;
  if (!isInt(r.turnSeconds) || r.turnSeconds < L.turnMin || r.turnSeconds > L.turnMax || r.turnSeconds % L.turnStep !== 0) {
    errors.turnSeconds = `The turn timer must be ${L.turnMin}–${L.turnMax} seconds in steps of ${L.turnStep}.`;
  }
  if (!owns(me.owned, r.feltId)) errors.feltId = "You don't own that felt.";
  if (Object.keys(errors).length > 0) return { errors, rules: null };
  const shared = validateRules(r);
  if (!shared.ok) return { errors: { form: shared.error }, rules: null };
  return { errors: {}, rules: shared.rules };
}

function FeltPicker({ felts, value, onChange }: { felts: ShopItem[]; value: string; onChange(id: string): void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent) => {
    const i = felts.findIndex((f) => f.id === value);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + felts.length) % felts.length;
    onChange(felts[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" onKeyDown={onKeyDown} className="grid grid-cols-2 gap-2 xs:grid-cols-3">
      {felts.map((f, i) => {
        const checked = f.id === value;
        return (
          <button
            key={f.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(f.id)}
            className={cx(
              'flex flex-col gap-1.5 rounded-lg p-1.5 text-left ring-2 transition-colors',
              checked ? 'bg-walnut-700 ring-brass' : 'ring-transparent hover:bg-walnut-700/60',
            )}
          >
            <Felt feltId={f.id} shape="rect" crestScale={0.34} className="aspect-[5/3] w-full" />
            <span className="px-0.5 text-[13px] font-semibold text-stock">{f.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface OpenTableDialogProps {
  open: boolean;
  onClose(): void;
  me: { balance: number; owned: Record<string, number>; loadout: { felt: string } };
  onSubmit(rules: TableRules): Promise<Ack>;
}

/** The host's form for opening the room's table with its rules. */
export function OpenTableDialog({ open, onClose, me, onSubmit }: OpenTableDialogProps) {
  const felts = ownedOfCategory(me.owned, 'felt');
  const [form, setForm] = useState<TableForm>(() => defaultTableForm(owns(me.owned, me.loadout.felt) ? me.loadout.felt : DEFAULT_RULES.feltId));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const { errors, rules } = validateTableForm(form, me);
  const shown: TableFormErrors = touched ? errors : { minBuyIn: errors.minBuyIn };
  const [sb, bb] = BLIND_LEVELS[form.blindIndex];
  const set = <K extends keyof TableForm>(key: K, value: TableForm[K]) => {
    setServerError(null);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = async () => {
    setTouched(true);
    if (!rules) return;
    setBusy(true);
    setServerError(null);
    const ack = await onSubmit(rules);
    setBusy(false);
    if (ack.ok) onClose();
    else setServerError(ack.error);
  };

  const anteStep = Math.max(1, Math.round(sb / 5));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Open a table"
      description="Set the stakes for this room. You can change them until the first hand is dealt."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="open-table-form" loading={busy}>Open the table</Button>
        </>
      }
    >
      <form
        id="open-table-form"
        noValidate
        className="grid gap-x-6 gap-y-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Table name" error={shown.name} className="sm:col-span-2">
          <TextInput
            value={form.name}
            maxLength={RULE_LIMITS.nameMax + 8}
            onChange={(e) => set('name', e.target.value)}
            onBlur={() => setTouched(true)}
            autoComplete="off"
            data-autofocus
          />
        </Field>

        <Field label="Blinds" group error={shown.blindIndex} className="sm:col-span-2" hint="Small blind / big blind">
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

        <Field label="Ante" aside={form.ante === 0 ? 'None' : <ChipAmount value={form.ante} size="sm" />} error={shown.ante} hint="Posted by everyone, every hand.">
          <Slider value={form.ante} onChange={(v) => set('ante', v)} min={0} max={sb} step={anteStep} valueText={(v) => (v === 0 ? 'No ante' : `${v} chips`)} />
        </Field>

        <Field label="Seats" group error={shown.maxSeats}>
          <Segmented
            size="sm"
            options={Array.from({ length: RULE_LIMITS.seatsMax - RULE_LIMITS.seatsMin + 1 }, (_, i) => ({ value: i + RULE_LIMITS.seatsMin, label: String(i + RULE_LIMITS.seatsMin) }))}
            value={form.maxSeats}
            onChange={(v) => set('maxSeats', v)}
          />
        </Field>

        <Field label="Minimum buy-in" error={shown.minBuyIn} hint={`${Math.round(form.minBuyIn / bb)} big blinds`}>
          <AmountInput
            value={form.minBuyIn}
            onChange={(v) => set('minBuyIn', v)}
            min={bb * RULE_LIMITS.minBuyInBb}
            max={bb * RULE_LIMITS.maxBuyInBb}
            step={bb}
          />
        </Field>

        <Field label="Maximum buy-in" error={shown.maxBuyIn} hint={`${Math.round(form.maxBuyIn / bb)} big blinds`}>
          <AmountInput
            value={form.maxBuyIn}
            onChange={(v) => set('maxBuyIn', v)}
            min={bb * RULE_LIMITS.minBuyInBb}
            max={bb * RULE_LIMITS.maxBuyInBb}
            step={bb}
          />
        </Field>

        <Field label="Turn timer" aside={`${form.turnSeconds} seconds`} error={shown.turnSeconds} className="sm:col-span-2" hint="When time runs out, the player checks if they can, otherwise folds.">
          <Slider
            value={form.turnSeconds}
            onChange={(v) => set('turnSeconds', v)}
            min={RULE_LIMITS.turnMin}
            max={RULE_LIMITS.turnMax}
            step={RULE_LIMITS.turnStep}
            valueText={(v) => `${v} seconds`}
          />
        </Field>

        <Field label="Felt" group error={shown.feltId} className="sm:col-span-2" hint={felts.length === 1 ? 'More felts are in the shop.' : undefined}>
          <FeltPicker felts={felts} value={form.feltId} onChange={(id) => set('feltId', id)} />
        </Field>

        {(serverError || shown.form) && (
          <p role="alert" className="rounded-lg bg-chip-dark/40 px-3 py-2 text-sm font-medium text-stock ring-1 ring-chip/60 sm:col-span-2">
            {serverError ?? shown.form}
          </p>
        )}
      </form>
    </Modal>
  );
}
