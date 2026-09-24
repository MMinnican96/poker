import { useRef, useState } from 'react';
import {
  CATALOG,
  LOADOUT_SLOTS,
  formatChips,
  getItem,
  isPermanent,
  type ItemCategory,
  type LoadoutSlot,
  type PlayerSelf,
  type Rarity,
  type ShopItem,
} from '@poker/shared';
import { useApi, useMe, useStore } from '../../app/client';
import { ItemPreview, owns } from '../../cosmetics';
import { Button, ChipAmount, Modal, Tabs, cx, tabPanelProps } from '../../ui';
import { Screen } from '../common/Screen';
import { errorText } from '../common/useAsync';

export const CATEGORIES: readonly { id: ItemCategory; label: string; intro: string }[] = [
  { id: 'felt', label: 'Felts', intro: 'The host picks the felt when they open a table. The felt you equip is the default for tables you open.' },
  { id: 'card-back', label: 'Card backs', intro: 'Everyone at the table sees this on your face-down cards.' },
  { id: 'frame', label: 'Frames', intro: 'Worn around your picture at your seat, in chat and on your profile card.' },
  { id: 'title', label: 'Titles', intro: 'Shown with your name at your seat and on your profile card.' },
  { id: 'celebration', label: 'Celebrations', intro: 'Goes off over the table when you win a pot.' },
  { id: 'emote-pack', label: 'Emote packs', intro: 'Every emote in a pack you own can be sent from your seat.' },
  { id: 'throwable', label: 'Throwables', intro: "Lob these at another player's seat. Each purchase adds to your supply." },
];

const SLOT_LABEL: Record<LoadoutSlot, string> = {
  felt: 'Default felt',
  'card-back': 'Card back',
  frame: 'Frame',
  title: 'Title',
  celebration: 'Celebration',
};

const RARITY: Record<Rarity, { label: string; className: string }> = {
  common: { label: 'Common', className: 'text-stock-dim ring-stock-dim/40' },
  rare: { label: 'Rare', className: 'text-brass-light ring-brass/60' },
  epic: { label: 'Epic', className: 'text-stock bg-chip-dark ring-chip' },
  legendary: { label: 'Legendary', className: 'text-ink bg-brass ring-brass-light' },
};

const isSlot = (c: ItemCategory): c is LoadoutSlot => (LOADOUT_SLOTS as readonly string[]).includes(c);

/** Why a player can't buy an item right now, or null. */
export function buyBlockedReason(item: ShopItem, me: Pick<PlayerSelf, 'balance' | 'level'>): string | null {
  if (item.minLevel && me.level.level < item.minLevel) return `Unlocks at level ${item.minLevel}`;
  if (item.price > me.balance) return `Need ${formatChips(item.price - me.balance)} more chips`;
  return null;
}

export function ShopScreen() {
  const me = useMe();
  const api = useApi();
  const store = useStore();
  const [category, setCategory] = useState<ItemCategory>('felt');
  const [buying, setBuying] = useState<ShopItem | null>(null);
  const [equipping, setEquipping] = useState<string | null>(null);
  // One nonce per item until its purchase succeeds, so a retry can't buy twice.
  const nonces = useRef(new Map<string, string>());
  const cat = CATEGORIES.find((c) => c.id === category)!;
  const items = CATALOG.filter((i) => i.category === category);

  const equip = async (item: ShopItem) => {
    if (!isSlot(item.category)) return false;
    setEquipping(item.id);
    try {
      const r = await api.equip(item.category, item.id);
      if (r.ok) {
        store.notify({
          tone: 'good',
          title: `Equipped ${item.name}`,
          body: item.category === 'felt' ? 'Tables you open will use this felt unless you pick another.' : undefined,
        });
        return true;
      }
      store.notify({ tone: 'bad', title: `Couldn't equip ${item.name}`, body: r.error });
    } catch (err) {
      store.notify({ tone: 'bad', title: `Couldn't equip ${item.name}`, body: errorText(err) });
    } finally {
      setEquipping(null);
    }
    return false;
  };

  const purchase = async (item: ShopItem) => {
    let nonce = nonces.current.get(item.id);
    if (!nonce) {
      nonce = crypto.randomUUID();
      nonces.current.set(item.id, nonce);
    }
    const r = await api.purchase(item.id, nonce);
    if (r.ok) nonces.current.delete(item.id);
    return r;
  };

  return (
    <Screen id="shop-heading" title="Shop" intro="Spend your winnings on things everyone at the table will see." width="6xl">
      <div className="grid gap-5 @4xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs<ItemCategory> idBase="shop" label="Categories" value={category} onChange={setCategory} tabs={CATEGORIES.map((c) => ({ id: c.id, label: c.label }))} />
          <div {...tabPanelProps('shop', category)} className="flex flex-col gap-3 outline-none">
            <p className="max-w-prose text-sm text-stock-dim">{cat.intro}</p>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2 xs:gap-3">
              {items.map((item) => (
                <li key={item.id} className="flex">
                  <ItemCard
                    item={item}
                    me={me}
                    equipping={equipping === item.id}
                    onBuy={() => setBuying(item)}
                    onEquip={() => void equip(item)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Loadout me={me} onPick={(slot) => setCategory(slot)} />
      </div>
      {buying && (
        <BuyDialog
          item={buying}
          balance={me.balance}
          owned={me.owned[buying.id] ?? 0}
          onBuy={() => purchase(buying)}
          onEquip={() => equip(buying)}
          onClose={() => setBuying(null)}
        />
      )}
    </Screen>
  );
}

function RarityTag({ rarity }: { rarity: Rarity }) {
  const r = RARITY[rarity];
  return <span className={cx('rounded-sm px-1.5 font-condensed text-[12px] leading-[18px] font-bold ring-1 ring-inset', r.className)}>{r.label}</span>;
}

function ItemCard({ item, me, equipping, onBuy, onEquip }: {
  item: ShopItem;
  me: PlayerSelf;
  equipping: boolean;
  onBuy(): void;
  onEquip(): void;
}) {
  const permanent = isPermanent(item);
  const owned = permanent && owns(me.owned, item.id);
  const count = me.owned[item.id] ?? 0;
  const equipped = isSlot(item.category) && me.loadout[item.category] === item.id;
  const blocked = buyBlockedReason(item, me);
  const locked = !!item.minLevel && me.level.level < item.minLevel;
  const headingId = `item-${item.id}`;

  let action;
  if (equipped) {
    action = <span className="inline-flex h-8 items-center gap-1 text-[13px] font-semibold text-brass-light"><Check /> Equipped</span>;
  } else if (owned && isSlot(item.category)) {
    action = <Button size="sm" variant="ghost" loading={equipping} onClick={onEquip} aria-describedby={headingId}>Equip</Button>;
  } else if (owned) {
    action = <span className="inline-flex h-8 items-center gap-1 text-[13px] font-semibold text-stock-dim"><Check /> Owned</span>;
  } else {
    action = (
      <Button size="sm" onClick={onBuy} disabled={!!blocked} aria-describedby={blocked ? `${headingId}-why` : headingId}>
        {permanent ? 'Buy' : `Buy ${item.quantity}`}
      </Button>
    );
  }

  return (
    <article
      aria-labelledby={headingId}
      className={cx(
        'flex w-full flex-col overflow-hidden rounded-xl bg-walnut-800 tex-wood ring-1 ring-inset shadow-panel',
        equipped ? 'ring-2 ring-brass' : 'ring-walnut-600/70',
      )}
    >
      <div className={cx('relative grid place-items-center bg-walnut-950/60 py-3 shadow-inset-well', locked && 'grayscale-[0.6]')}>
        <ItemPreview item={item} size={112} />
        <span className="absolute top-2 left-2"><RarityTag rarity={item.rarity} /></span>
        {!permanent && count > 0 && (
          <span className="tabular absolute top-2 right-2 rounded-full bg-walnut-950/85 px-2 text-[12px] leading-5 font-bold text-stock ring-1 ring-walnut-600">
            {count} owned
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 id={headingId} className="text-[17px] leading-tight text-stock">{item.name}</h3>
        <p className="text-[13px] leading-snug text-stock-dim">{item.description}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {owned ? (
            <span className="text-[13px] text-muted">{item.price === 0 ? 'Free' : 'Yours'}</span>
          ) : (
            <ChipAmount value={item.price} size="md" className="text-stock" />
          )}
          {action}
        </div>
        {!owned && blocked && (
          <p id={`${headingId}-why`} className="text-[12px] font-semibold text-negative">{blocked}</p>
        )}
      </div>
    </article>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function Loadout({ me, onPick }: { me: PlayerSelf; onPick(slot: LoadoutSlot): void }) {
  return (
    <aside aria-labelledby="loadout-heading" className="order-first flex min-w-0 flex-col gap-2 self-start @4xl:sticky @4xl:top-4 @4xl:order-none">
      <h2 id="loadout-heading" className="text-lg text-stock">Your loadout</h2>
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 @4xl:flex-col @4xl:overflow-visible">
        {LOADOUT_SLOTS.map((slot) => {
          const item = getItem(me.loadout[slot]);
          return (
            <li key={slot} className="w-44 shrink-0 @4xl:w-auto">
              <button
                type="button"
                onClick={() => onPick(slot)}
                className="flex w-full items-center gap-2.5 rounded-lg bg-walnut-950/60 p-1.5 text-left ring-1 ring-inset ring-black/40 hover:ring-walnut-500"
                aria-label={`${SLOT_LABEL[slot]}: ${item?.name ?? 'None'}. Browse ${SLOT_LABEL[slot].toLowerCase()}s.`}
              >
                {item && item.visual.kind !== 'title' && <ItemPreview item={item} size={44} className="rounded-md" />}
                {item?.visual.kind === 'title' && (
                  <span className="grid size-11 shrink-0 place-items-center rounded-md bg-walnut-900 font-display text-lg text-brass-light" aria-hidden="true">Aa</span>
                )}
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-muted">{SLOT_LABEL[slot]}</span>
                  <span className="block truncate text-sm font-semibold text-stock">{item?.name ?? 'None'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-muted">
        Consumables: {CATALOG.filter((i) => !isPermanent(i) && (me.owned[i.id] ?? 0) > 0).map((i) => `${i.name.toLowerCase()} ×${me.owned[i.id]}`).join(', ') || 'none yet'}.
      </p>
    </aside>
  );
}

type BuyResult = Awaited<ReturnType<ReturnType<typeof useApi>['purchase']>>;

function BuyDialog({ item, balance, owned, onBuy, onEquip, onClose }: {
  item: ShopItem;
  balance: number;
  owned: number;
  onBuy(): Promise<BuyResult>;
  onEquip(): Promise<boolean>;
  onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ quantity: number } | null>(null);
  const permanent = isPermanent(item);
  const equippable = permanent && isSlot(item.category);
  const after = balance - item.price;

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await onBuy();
      if (r.ok) {
        setDone({ quantity: r.quantity });
      } else setError(r.error);
    } catch (err) {
      setError(`${errorText(err)} Try again; you won't be charged twice.`);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal
        open
        onClose={onClose}
        size="sm"
        title={permanent ? `${item.name} is yours` : `Added ${item.quantity} ${item.name.toLowerCase()}`}
        description={permanent ? (equippable ? 'Equip it now or any time from the shop.' : 'Use it from your seat at the table.') : `You have ${done.quantity} now.`}
        footer={
          <>
            <Button variant="ghost" onClick={onClose} data-autofocus={!equippable || undefined}>Done</Button>
            {equippable && (
              <Button
                variant="brass"
                loading={busy}
                data-autofocus
                onClick={async () => {
                  setBusy(true);
                  const ok = await onEquip();
                  setBusy(false);
                  if (ok) onClose();
                }}
              >
                Equip now
              </Button>
            )}
          </>
        }
      >
        <div className="grid place-items-center py-2">
          <ItemPreview item={item} size={128} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Buy ${item.name}?`}
      description={item.description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={buy} loading={busy} disabled={after < 0} data-autofocus>
            {`Buy for ${formatChips(item.price)}`}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <ItemPreview item={item} size={96} />
        <dl className="grid flex-1 grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
          <dt className="text-stock-dim">Price</dt>
          <dd className="text-right"><ChipAmount value={item.price} /></dd>
          <dt className="text-stock-dim">Your balance</dt>
          <dd className="text-right"><ChipAmount value={balance} /></dd>
          <dt className="border-t border-walnut-600 pt-1 text-stock-dim">After</dt>
          <dd className={cx('border-t border-walnut-600 pt-1 text-right', after < 0 && 'text-negative')}><ChipAmount value={after} /></dd>
          {!permanent && (
            <>
              <dt className="text-stock-dim">You get</dt>
              <dd className="tabular text-right font-semibold">{item.quantity} (have {owned})</dd>
            </>
          )}
        </dl>
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-negative">{error}</p>}
    </Modal>
  );
}
