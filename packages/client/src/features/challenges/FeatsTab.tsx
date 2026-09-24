import { RARITY_COLOURS, RARITY_NAME, featsInDisplayOrder, formatChips, type FeatDef } from '@poker/shared';
import { TitleTag } from '../../cosmetics';
import { Emblem } from '../../cosmetics/Emblem';
import { ChipAmount, Surface, cx } from '../../ui';
import { unlockDate, type Standing } from './achievements';

/** One-off feats as a grid of cards, common to legendary. */
export function FeatsTab({ all }: { all: Map<string, Standing> }) {
  const feats = featsInDisplayOrder().map((def) => ({ ...all.get(def.id)!, def }));
  const done = feats.filter((f) => f.tier > 0).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-sm text-stock-dim">
        Hard-won moments at the table. Each pays once, the moment it happens, and earns a title. Some are secret until you get them.{' '}
        <span className="tabular font-semibold text-stock">{done} of {feats.length} feats unlocked.</span>
      </p>
      <h2 id="feats-heading" className="sr-only">Every feat</h2>
      <ul aria-labelledby="feats-heading" className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2 xs:gap-3">
        {feats.map((f) => <FeatCard key={f.def.id} def={f.def} tier={f.tier} unlockedAt={f.unlockedAt} />)}
      </ul>
    </div>
  );
}

export function FeatCard({ def, tier, unlockedAt }: { def: FeatDef; tier: number; unlockedAt: string | null }) {
  const unlocked = tier > 0;
  const hidden = def.secret && !unlocked;
  const name = hidden ? 'Secret feat' : def.name;
  const headingId = `feat-${def.id}`;
  const date = unlockDate(unlockedAt);
  return (
    <li className="flex">
      <Surface
        as="article"
        tone={unlocked ? 'walnut' : 'well'}
        aria-labelledby={headingId}
        data-locked={!unlocked || undefined}
        className={cx('relative flex w-full gap-3 overflow-hidden p-3', unlocked && 'ring-2')}
        style={unlocked ? { ['--tw-ring-color' as string]: RARITY_COLOURS[def.rarity].base } : undefined}
      >
        <Emblem achievementId={def.id} tier={tier} size={64} className={cx(!unlocked && 'opacity-80')} decorative />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 id={headingId} className={cx('font-display text-[17px] leading-tight', unlocked ? 'text-stock' : 'text-stock-dim')}>{name}</h3>
            <RarityLabel rarity={def.rarity} />
          </div>
          <p className={cx('text-sm', hidden ? 'italic text-muted' : 'text-stock-dim')}>{hidden ? def.hint : def.description}</p>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            <span className="flex items-baseline gap-1.5">
              <ChipAmount value={def.reward.chips} size="sm" className="text-stock" />
              <span className="text-[12px] font-semibold text-muted">+{formatChips(def.reward.xp)} XP</span>
            </span>
            {!hidden && <TitleTag title={def.title} />}
          </div>
          <p className="text-[12px] font-semibold text-muted">
            {unlocked ? (
              <>Unlocked{date && <> <time dateTime={unlockedAt ?? undefined}>{date}</time></>}</>
            ) : (
              'Locked'
            )}
          </p>
        </div>
      </Surface>
    </li>
  );
}

/** Rarity as a word with a dot in the rarity colour (colour never carries it alone). */
export function RarityLabel({ rarity }: { rarity: FeatDef['rarity'] }) {
  const c = RARITY_COLOURS[rarity];
  return (
    <span className="inline-flex items-center gap-1 font-condensed text-[13px] font-bold text-stock-dim">
      <span className="size-2 rotate-45 rounded-[1px]" style={{ backgroundImage: `linear-gradient(${c.light}, ${c.base})` }} aria-hidden="true" />
      {RARITY_NAME[rarity]}
    </span>
  );
}
