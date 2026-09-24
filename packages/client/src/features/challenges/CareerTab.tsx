import {
  CAREER_GROUPS,
  CAREER_TIERS,
  TIER_INFO,
  describeGoal,
  formatChips,
  goalFor,
  rewardFor,
  tierInfo,
  type CareerDef,
} from '@poker/shared';
import { TitleTag } from '../../cosmetics';
import { Emblem } from '../../cosmetics/Emblem';
import { ChipAmount, Surface, cx } from '../../ui';
import type { Standing } from './achievements';

/** Career challenges by group, each row showing its tier, the next goal and what it pays. */
export function CareerTab({ all }: { all: Map<string, Standing> }) {
  const career = [...all.values()].filter((s): s is Standing & { def: CareerDef } => s.def.kind === 'career');
  const tiers = career.reduce((n, s) => n + s.tier, 0);
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose text-sm text-stock-dim">
        Permanent challenges with five tiers, from bronze to diamond. Each tier pays chips and XP the moment you reach it, and
        tiers III and V unlock a title. <span className="tabular font-semibold text-stock">{tiers} of {career.length * 5} tiers reached.</span>
      </p>
      {CAREER_GROUPS.map((g) => {
        const rows = career.filter((s) => s.def.group === g.id);
        if (rows.length === 0) return null;
        const id = `career-${g.id}`;
        return (
          <section key={g.id} aria-labelledby={id} className="flex flex-col gap-2">
            <h2 id={id} className="text-xl text-stock">{g.name}</h2>
            <ul className="flex flex-col gap-2">
              {rows.map((s) => <CareerRow key={s.def.id} s={s} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** "Gold · tier III of V", or "Locked · no tier yet" before tier I. */
export function tierLine(tier: number): string {
  return tier > 0 ? `${tierInfo(tier).name} · tier ${tierInfo(tier).roman} of V` : 'Locked · no tier yet';
}

/**
 * Progress or a goal as shown on the bar. Goals with a display divisor count
 * minutes and read in hours (night owl), so they show hours and minutes:
 * "59m", "33h 10m", "100h" (a floored "0 / 1" would disagree with the bar).
 */
export function progressAmount(def: CareerDef, value: number): string {
  if (!def.displayDivisor) return formatChips(Math.floor(value));
  const total = Math.floor(value);
  const h = Math.floor(total / def.displayDivisor);
  const m = total % def.displayDivisor;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${formatChips(h)}h` : `${formatChips(h)}h ${m}m`;
}

export function CareerRow({ s }: { s: Standing & { def: CareerDef } }) {
  const { def, tier } = s;
  const maxed = tier >= 5;
  const next = Math.min(5, tier + 1);
  const goal = goalFor(def, next);
  const progress = Math.min(goal, Math.max(0, s.progress));
  const frac = maxed ? 1 : progress / goal;
  const shownProgress = progressAmount(def, progress);
  const shownGoal = progressAmount(def, goal);
  const reward = rewardFor(def, next);
  const nextTitle = ([3, 5] as const).find((t) => t > tier);
  const nextColours = TIER_INFO[next as 1 | 2 | 3 | 4 | 5].colours;
  const headingId = `career-row-${def.id}`;
  return (
    <li>
      <Surface
        tone={tier > 0 ? 'walnut' : 'well'}
        as="article"
        aria-labelledby={headingId}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 xs:px-4 short:py-2"
      >
        <Emblem achievementId={def.id} tier={tier} size={60} className="short:size-12" decorative />
        <div className="min-w-0 flex-[1_1_14rem]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 id={headingId} className="font-display text-[17px] text-stock">{def.name}</h3>
            <span className="text-[13px] font-semibold text-muted">{tierLine(tier)}</span>
          </div>
          <TierPips tier={tier} />
          {maxed ? (
            <p className="mt-1 text-sm text-stock-dim">{describeGoal(def, 5)} Every tier reached.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-stock-dim">
                <span className="sr-only">Next: </span>
                {describeGoal(def, next)}
              </p>
              <div className="mt-1.5 flex items-center gap-3">
                <div
                  role="progressbar"
                  aria-label={`${def.name} progress`}
                  aria-valuemin={0}
                  aria-valuemax={goal}
                  aria-valuenow={Math.floor(progress)}
                  aria-valuetext={`${shownProgress} of ${shownGoal}`}
                  className="h-2 flex-1 overflow-hidden rounded-full bg-walnut-950 shadow-inset-well"
                >
                  <div className="h-full rounded-full" style={{ width: `${frac * 100}%`, backgroundColor: nextColours.base }} />
                </div>
                <span className="tabular shrink-0 text-[13px] font-semibold text-stock-dim">
                  {shownProgress} / {shownGoal}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right leading-tight max-xs:w-full max-xs:flex-row max-xs:items-center max-xs:justify-between">
          {maxed ? (
            <span className="inline-block -rotate-3 rounded-sm border-2 border-positive/70 px-2 py-0.5 font-condensed text-[15px] font-bold text-positive">
              Complete
            </span>
          ) : (
            <p className="flex flex-col items-end max-xs:flex-row max-xs:items-baseline max-xs:gap-1.5">
              <span className="text-[12px] font-semibold text-muted">Tier {tierInfo(next).roman} pays</span>
              <ChipAmount value={reward.chips} size="sm" className="text-stock" />
              <span className="text-[12px] font-semibold text-muted">+{formatChips(reward.xp)} XP</span>
            </p>
          )}
          {nextTitle && (
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
              <span>Tier {tierInfo(nextTitle).roman} title</span>
              <TitleTag title={def.titles[nextTitle]} />
            </p>
          )}
        </div>
      </Surface>
    </li>
  );
}

/** Five pips in each tier's metal; reached ones are filled. */
function TierPips({ tier }: { tier: number }) {
  return (
    <ol className="mt-1 flex gap-1" aria-label={`Tier ${tier} of 5`}>
      {CAREER_TIERS.map((t) => {
        const on = t <= tier;
        const c = TIER_INFO[t].colours;
        return (
          <li
            key={t}
            className={cx('h-1.5 w-6 rounded-full', !on && 'bg-walnut-950 ring-1 ring-inset ring-walnut-600')}
            style={on ? { backgroundImage: `linear-gradient(${c.light}, ${c.base})` } : undefined}
            title={`Tier ${TIER_INFO[t].roman}: ${TIER_INFO[t].name}`}
          >
            <span className="sr-only">{`${TIER_INFO[t].name}${on ? ', reached' : ''}`}</span>
          </li>
        );
      })}
    </ol>
  );
}
