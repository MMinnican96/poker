import { useEffect, useRef, useState } from 'react';
import {
  ACHIEVEMENTS,
  SHOWCASE_MAX,
  achievementLabel,
  getAchievement,
  getTitle,
  type AchievementTitle,
} from '@poker/shared';
import { useApi, useMe, useStore } from '../../app/client';
import { ExternalLink } from '../../app/ExternalLink';
import { TitleTag, ownedOfCategory } from '../../cosmetics';
import { Emblem, emblemName } from '../../cosmetics/Emblem';
import { TrophyShelf } from '../../cosmetics/TrophyShelf';
import { Button, Modal, Surface, cx } from '../../ui';
import { errorText } from '../common/useAsync';
import { earnedTitles, shelfOf, unlockDate, type Standing } from './achievements';

const LINK = 'font-semibold text-brass-light underline underline-offset-2';

export interface CabinetTabProps {
  all: Map<string, Standing>;
  /** The chosen showcase ([] = automatic). */
  showcase: string[];
  onShowcaseSaved(ids: string[]): void;
}

/** The player's trophy cabinet: the showcase shelf, everything unlocked, and the title picker. */
export function CabinetTab({ all, showcase, onShowcaseSaved }: CabinetTabProps) {
  const [editing, setEditing] = useState(false);
  const unlocked = [...all.values()].filter((s) => s.tier > 0);
  const shelf = shelfOf(all, showcase);
  const tierOf = (id: string) => all.get(id)?.tier ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="cabinet-shelf-heading" className="flex flex-col gap-2">
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id="cabinet-shelf-heading" className="text-xl text-stock">Your showcase</h2>
            <p className="text-sm text-muted">
              <span className="tabular font-semibold text-stock-dim">{unlocked.length} of {ACHIEVEMENTS.length} emblems unlocked.</span>{' '}
              {unlocked.length === 0
                ? 'Emblems come from career challenges and feats.'
                : shelf.auto
                  ? 'Showing your best emblems until you pick your own.'
                  : 'Everyone sees these on your profile card.'}
            </p>
          </div>
          <Button variant="brass" size="sm" onClick={() => setEditing(true)} disabled={unlocked.length === 0}>
            Edit showcase
          </Button>
        </header>
        <TrophyShelf label="Showcase" items={shelf.ids.map((id) => ({ id, tier: tierOf(id) }))} size={72} className="max-w-xl" />
      </section>

      <TitlePicker all={all} />

      <section aria-labelledby="cabinet-all-heading" className="flex flex-col gap-2">
        <h2 id="cabinet-all-heading" className="text-xl text-stock">Every emblem</h2>
        <ul aria-labelledby="cabinet-all-heading" className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
          {ACHIEVEMENTS.map((def) => {
            const s = all.get(def.id)!;
            const date = unlockDate(s.unlockedAt);
            return (
              <li
                key={def.id}
                className="flex flex-col items-center gap-1 text-center"
                title={s.tier > 0 ? `${achievementLabel(def, s.tier)}${date ? `, unlocked ${date}` : ''}` : undefined}
              >
                <Emblem achievementId={def.id} tier={s.tier} size={52} />
                <span className={cx('w-full truncate text-[12px] font-semibold', s.tier > 0 ? 'text-stock-dim' : 'text-muted')} aria-hidden="true">
                  {s.tier > 0 ? achievementLabel(def, s.tier) : def.kind === 'feat' && def.secret ? 'Secret' : def.name}
                </span>
                {s.tier > 0 && date && <span className="sr-only">Unlocked {date}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-[12px] text-muted">
        {/* Every author whose icons are in EMBLEM_GLYPHS; keep in step with public/CREDITS.md. */}
        Emblem icons by Lorc, Delapouite, Skoll and Carl Olsen from{' '}
        <ExternalLink href="https://game-icons.net" className={LINK}>game-icons.net</ExternalLink>,{' '}
        <ExternalLink href="https://creativecommons.org/licenses/by/3.0/" className={LINK}>CC BY 3.0</ExternalLink>.
      </p>

      {editing && (
        <ShowcaseDialog
          all={all}
          initial={shelf.auto ? [] : shelf.ids}
          onClose={() => setEditing(false)}
          onSaved={(ids) => {
            onShowcaseSaved(ids);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

/** Pick up to five unlocked emblems for the shelf, in order. */
export function ShowcaseDialog({ all, initial, onClose, onSaved }: {
  all: Map<string, Standing>;
  initial: string[];
  onClose(): void;
  onSaved(ids: string[]): void;
}) {
  const api = useApi();
  const store = useStore();
  const [picked, setPicked] = useState<string[]>(initial);
  const [saving, setSaving] = useState(false);
  const unlocked = [...all.values()].filter((s) => s.tier > 0);
  const full = picked.length >= SHOWCASE_MAX;
  const tierOf = (id: string) => all.get(id)?.tier ?? 0;

  // Buttons that vanish or become disabled would drop focus to the page, so
  // after each change focus moves to a sensible neighbour (a `data-focus` key).
  const body = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const key = focusNext.current;
    if (!key) return;
    focusNext.current = null;
    body.current?.querySelector<HTMLElement>(`[data-focus="${key}"]`)?.focus();
  }, [picked]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= SHOWCASE_MAX ? p : [...p, id]));
  /** Remove from the order list: focus the next row's Remove, else the emblem in the picker. */
  const remove = (i: number) => {
    const rest = picked.filter((_, k) => k !== i);
    focusNext.current = rest.length > 0 ? `${rest[Math.min(i, rest.length - 1)]}:remove` : `pick:${picked[i]}`;
    setPicked(rest);
  };
  /** Move one place; focus stays on the item, on the other arrow once it reaches an end. */
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= picked.length) return;
    const next = picked.slice();
    [next[i], next[j]] = [next[j], next[i]];
    const atEnd = by < 0 ? j === 0 : j === next.length - 1;
    focusNext.current = `${next[j]}:${(by < 0) !== atEnd ? 'left' : 'right'}`;
    setPicked(next);
  };
  const clear = () => {
    if (unlocked[0]) focusNext.current = `pick:${unlocked[0].def.id}`;
    setPicked([]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.setShowcase(picked);
      if (r.ok) {
        store.notify({ tone: 'good', title: 'Trophy cabinet saved', body: r.showcase.length ? undefined : 'It shows your best emblems for you.' });
        onSaved(r.showcase);
        return;
      }
      store.notify({ tone: 'bad', title: "Couldn't save your trophy cabinet", body: r.error });
    } catch (err) {
      store.notify({ tone: 'bad', title: "Couldn't save your trophy cabinet", body: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit showcase"
      description={`Pick up to ${SHOWCASE_MAX} emblems, in the order they stand on your shelf.`}
      size="md"
      footer={
        <>
          <Button variant="quiet" onClick={clear} disabled={picked.length === 0 || saving}>Clear</Button>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>Save showcase</Button>
        </>
      }
    >
      <div ref={body} className="flex flex-col gap-3">
        <TrophyShelf label="Shelf preview" items={picked.map((id) => ({ id, tier: tierOf(id) }))} size={52} />
        {picked.length > 0 && (
          <ol aria-label="Order" className="flex flex-col gap-1">
            {picked.map((id, i) => {
              const def = getAchievement(id);
              if (!def) return null;
              const label = achievementLabel(def, tierOf(id));
              return (
                <li key={id} className="flex items-center gap-2 rounded-md bg-walnut-950/60 py-1 pr-1 pl-2 ring-1 ring-inset ring-black/40">
                  <span className="tabular w-4 font-condensed text-[15px] font-bold text-brass-light">{i + 1}</span>
                  <Emblem achievementId={id} tier={tierOf(id)} size={28} decorative />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stock">{label}</span>
                  <Button variant="quiet" size="sm" onClick={() => move(i, -1)} disabled={i === 0} data-focus={`${id}:left`} aria-label={`Move ${label} left`}>Left</Button>
                  <Button variant="quiet" size="sm" onClick={() => move(i, 1)} disabled={i === picked.length - 1} data-focus={`${id}:right`} aria-label={`Move ${label} right`}>Right</Button>
                  <Button variant="quiet" size="sm" onClick={() => remove(i)} data-focus={`${id}:remove`} aria-label={`Remove ${label}`}>Remove</Button>
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-sm text-muted" aria-live="polite">
          {full
            ? `Your shelf holds ${SHOWCASE_MAX}. Remove one to add another.`
            : picked.length === 0
              ? 'Nothing picked: your shelf shows your best emblems for you.'
              : `${picked.length} of ${SHOWCASE_MAX} picked.`}
        </p>
        <ul aria-label="Unlocked emblems" className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-1.5">
          {unlocked.map((s) => {
            const on = picked.includes(s.def.id);
            const place = picked.indexOf(s.def.id) + 1;
            return (
              <li key={s.def.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => toggle(s.def.id)}
                  data-focus={`pick:${s.def.id}`}
                  aria-label={emblemName(s.def, s.tier)}
                  className={cx(
                    'relative flex w-full flex-col items-center gap-1 rounded-lg p-1.5 text-center ring-1 ring-inset transition-colors disabled:opacity-40',
                    on ? 'bg-walnut-600 ring-brass' : 'bg-walnut-950/60 ring-black/40 hover:ring-walnut-500',
                  )}
                >
                  <Emblem achievementId={s.def.id} tier={s.tier} size={44} decorative />
                  <span className="w-full truncate text-[11px] font-semibold text-stock-dim" aria-hidden="true">{achievementLabel(s.def, s.tier)}</span>
                  {on && (
                    <span className="tabular absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-brass font-condensed text-[12px] font-bold text-ink" aria-hidden="true">
                      {place}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

/** Every title you can wear: owned shop titles and earned ones, grouped, the equipped one marked. */
export function TitlePicker({ all }: { all: Map<string, Standing> }) {
  const me = useMe();
  const api = useApi();
  const store = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const earned = earnedTitles(all);
  const groups: { id: string; name: string; titles: { id: string; text: string; from?: string }[] }[] = [
    { id: 'shop', name: 'From the shop', titles: ownedOfCategory(me.owned, 'title').map((i) => ({ id: i.id, text: getTitle(i.id)?.text ?? '' })) },
    { id: 'career', name: 'Career challenges', titles: earned.filter((t) => getAchievement(t.achievementId)?.kind === 'career').map(fromAchievement) },
    { id: 'feats', name: 'Feats', titles: earned.filter((t) => getAchievement(t.achievementId)?.kind === 'feat').map(fromAchievement) },
  ];
  const equippedId = me.loadout.title;

  const equip = async (id: string, text: string) => {
    const failed = text ? `Couldn't equip ${text}` : "Couldn't remove your title";
    setBusy(id);
    try {
      const r = await api.equip('title', id);
      if (r.ok) store.notify({ tone: 'good', title: text ? `Now wearing ${text}` : 'Title removed' });
      else store.notify({ tone: 'bad', title: failed, body: r.error });
    } catch (err) {
      store.notify({ tone: 'bad', title: failed, body: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="cabinet-titles-heading" className="flex flex-col gap-2">
      <div>
        <h2 id="cabinet-titles-heading" className="text-xl text-stock">Titles</h2>
        <p className="text-sm text-muted">Shown with your name at your seat and on your profile card. Tiers III and V and every feat earn one.</p>
      </div>
      <Surface tone="well" className="flex flex-col gap-3 p-3">
        {groups.map((g) => (
          <div key={g.id} role="group" aria-labelledby={`titles-${g.id}`} className="flex flex-col gap-1.5">
            <h3 id={`titles-${g.id}`} className="font-condensed text-[14px] font-bold text-muted">{g.name}</h3>
            {g.titles.length === 0 ? (
              <p className="text-sm text-muted">{g.id === 'feats' ? 'None yet. Every feat earns one.' : 'None yet. Reach tier III to earn one.'}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {g.titles.map((t) => {
                  const on = t.id === equippedId;
                  const label = t.text || 'No title';
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={busy !== null}
                        onClick={() => !on && void equip(t.id, t.text)}
                        aria-label={t.from ? `${label} (${t.from})` : label}
                        className={cx(
                          'inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-left ring-1 ring-inset transition-colors disabled:cursor-wait',
                          on ? 'bg-walnut-600 ring-brass' : 'bg-walnut-900 ring-walnut-600 hover:ring-walnut-500',
                        )}
                      >
                        {t.text ? <TitleTag title={t.text} /> : <span className="text-[13px] font-semibold text-stock-dim">{label}</span>}
                        {t.from && <span className="text-[12px] text-muted">{t.from}</span>}
                        {on && <span className="font-condensed text-[13px] font-bold text-brass-light">Equipped</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </Surface>
    </section>
  );
}

function fromAchievement(t: AchievementTitle) {
  const def = getAchievement(t.achievementId)!;
  return { id: t.id, text: t.text, from: achievementLabel(def, t.tier) };
}
