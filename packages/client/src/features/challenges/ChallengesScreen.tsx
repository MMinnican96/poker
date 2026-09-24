import { useEffect, useState } from 'react';
import {
  formatChips,
  levelUpReward,
  type ChallengePeriod,
  type ChallengeStatus,
} from '@poker/shared';
import { useApi, useMe, useStore } from '../../app/client';
import { useNow } from '../../app/hooks';
import { Button, ChipAmount, ChipGlyph, EmptyState, GiftIcon, LevelBadge, Surface, cx, levelFraction } from '../../ui';
import { LoadError, Loading, Screen } from '../common/Screen';
import { errorText, useAsync } from '../common/useAsync';

/** "2d 4h", "5h 12m", "12m 05s", "40s". */
export function timeLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

const PERIOD_TITLE: Record<ChallengePeriod, string> = { daily: 'Daily challenges', weekly: 'Weekly challenges' };

export function ChallengesScreen() {
  const api = useApi();
  const list = useAsync(() => api.challenges(), [api]);
  const now = useNow(1000);

  // When a period rolls over, fetch the new challenges.
  const nextEnd = Math.min(...(list.data ?? []).map((c) => Date.parse(c.endsAt)).filter((t) => !Number.isNaN(t)));
  const expired = Number.isFinite(nextEnd) && now >= nextEnd;
  const { reload } = list;
  useEffect(() => {
    if (expired) reload();
  }, [expired, reload]);

  const markClaimed = (c: ChallengeStatus) =>
    list.setData((prev) => prev?.map((x) => (x.id === c.id && x.periodKey === c.periodKey ? { ...x, claimed: true } : x)));

  return (
    <Screen id="challenges-heading" title="Challenges" intro="Play hands to fill these up, then claim chips and XP.">
      <div className="grid gap-3 @2xl:grid-cols-2">
        <DailyBonus />
        <LevelProgress />
      </div>
      {!list.data && list.loading ? (
        <Loading label="Loading challenges" />
      ) : !list.data ? (
        <LoadError what="challenges" error={list.error ?? ''} onRetry={list.reload} />
      ) : list.data.length === 0 ? (
        <EmptyState title="No challenges right now" body="New ones are posted every day and every Monday. Check back soon." />
      ) : (
        (['daily', 'weekly'] as const).map((period) => {
          const items = list.data!.filter((c) => c.period === period);
          if (items.length === 0) return null;
          return <PeriodGroup key={period} period={period} items={items} now={now} onClaimed={markClaimed} />;
        })
      )}
    </Screen>
  );
}

function PeriodGroup({ period, items, now, onClaimed }: { period: ChallengePeriod; items: ChallengeStatus[]; now: number; onClaimed(c: ChallengeStatus): void }) {
  const ends = Date.parse(items[0].endsAt);
  const id = `challenges-${period}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-xl text-stock">{PERIOD_TITLE[period]}</h2>
        {!Number.isNaN(ends) && (
          <p className="text-sm text-muted">
            New {period === 'daily' ? 'challenges' : 'week'} in{' '}
            <time dateTime={items[0].endsAt} className="tabular font-semibold text-stock-dim">{timeLeft(ends - now)}</time>
          </p>
        )}
      </header>
      <ul className="flex flex-col gap-2">
        {items.map((c) => <ChallengeRow key={`${c.periodKey}:${c.id}`} c={c} onClaimed={onClaimed} />)}
      </ul>
    </section>
  );
}

function ChallengeRow({ c, onClaimed }: { c: ChallengeStatus; onClaimed(c: ChallengeStatus): void }) {
  const api = useApi();
  const store = useStore();
  const [claiming, setClaiming] = useState(false);
  const progress = Math.min(c.goal, Math.max(0, Math.floor(c.progress)));
  const frac = c.goal > 0 ? progress / c.goal : 0;
  const ready = c.completed && !c.claimed;

  const claim = async () => {
    setClaiming(true);
    try {
      const r = await api.claimChallenge(c.periodKey, c.id);
      if (r.ok) {
        onClaimed(c);
        const ups = r.levelUps.map((u) => `You reached level ${u.level}: +${formatChips(u.reward)} chips.`).join(' ');
        store.notify({ tone: 'good', title: `Claimed: ${c.title}`, body: `+${formatChips(r.chips)} chips and ${formatChips(r.xp)} XP.${ups ? ` ${ups}` : ''}` });
      } else {
        store.notify({ tone: 'bad', title: "Couldn't claim that challenge", body: r.error });
      }
    } catch (err) {
      store.notify({ tone: 'bad', title: "Couldn't claim that challenge", body: errorText(err) });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <li>
      <Surface
        tone={ready ? 'walnut' : 'well'}
        className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 short:py-2', ready && 'ring-2 ring-brass', c.claimed && 'opacity-75')}
      >
        <div className="min-w-0 flex-[1_1_16rem]">
          <h3 className="font-display text-[17px] text-stock">{c.title}</h3>
          <p className="text-sm text-stock-dim">{c.description}</p>
          <div className="mt-2 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label={`${c.title} progress`}
              aria-valuemin={0}
              aria-valuemax={c.goal}
              aria-valuenow={progress}
              aria-valuetext={`${formatChips(progress)} of ${formatChips(c.goal)}`}
              className="h-2 flex-1 overflow-hidden rounded-full bg-walnut-950 shadow-inset-well"
            >
              <div className={cx('h-full rounded-full', c.completed ? 'bg-positive' : 'bg-brass')} style={{ width: `${frac * 100}%` }} />
            </div>
            <span className="tabular shrink-0 text-[13px] font-semibold text-stock-dim">
              {formatChips(progress)} / {formatChips(c.goal)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <p className="flex flex-col items-end text-right leading-tight">
            <ChipAmount value={c.reward.chips} size="sm" className="text-stock" />
            <span className="text-[12px] font-semibold text-muted">+{formatChips(c.reward.xp)} XP</span>
          </p>
          <div className="w-24 text-right">
            {c.claimed ? (
              <span className="inline-block -rotate-3 rounded-sm border-2 border-positive/70 px-2 py-0.5 font-condensed text-[15px] font-bold text-positive">
                Claimed
              </span>
            ) : ready ? (
              <Button variant="brass" size="sm" loading={claiming} onClick={claim} aria-label={`Claim ${c.title}`}>Claim</Button>
            ) : null}
          </div>
        </div>
      </Surface>
    </li>
  );
}

function DailyBonus() {
  const me = useMe();
  const api = useApi();
  const store = useStore();
  const [claiming, setClaiming] = useState(false);
  const { available, streak, nextAmount } = me.daily;
  const claim = async () => {
    setClaiming(true);
    try {
      const r = await api.claimDaily();
      if (r.ok) store.notify({ tone: 'good', title: 'Daily bonus claimed', body: `+${formatChips(r.amount)} chips. Day ${r.streak} of your streak.` });
      else store.notify({ tone: 'bad', title: "Couldn't claim the daily bonus", body: r.error });
    } catch (err) {
      store.notify({ tone: 'bad', title: "Couldn't claim the daily bonus", body: errorText(err) });
    } finally {
      setClaiming(false);
    }
  };
  // `streak` is the day the next claim counts as (while available) or the day
  // just claimed. The bonus stops growing after day 7.
  const day = Math.min(7, streak);
  const claimedDays = available ? day - 1 : day;
  return (
    <Surface tone="walnut" className="flex flex-col gap-3 p-4 short:p-3" aria-labelledby="daily-heading" as="section">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="daily-heading" className="text-xl text-stock">Daily bonus</h2>
          <p className="text-sm text-muted">
            {available ? `Claim ${formatChips(nextAmount)} free chips.` : `Back tomorrow for ${formatChips(nextAmount)} chips.`}
          </p>
        </div>
        <Button variant="brass" icon={<GiftIcon size={18} />} onClick={claim} loading={claiming} disabled={!available}>
          {available ? 'Claim' : 'Claimed today'}
        </Button>
      </div>
      <ol className="flex gap-1.5" aria-label={available ? `Streak: claiming day ${streak}` : `Streak: day ${streak} claimed`}>
        {Array.from({ length: 7 }, (_, i) => {
          const done = i < claimedDays;
          const next = available && i === day - 1;
          return (
            <li key={i} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={cx(
                  'grid size-8 place-items-center rounded-full ring-1 ring-inset',
                  done ? 'bg-brass ring-brass-dark' : next ? 'ring-2 ring-brass' : 'bg-walnut-950/70 ring-walnut-600',
                )}
                aria-hidden="true"
              >
                {done && <ChipGlyph size={18} />}
              </span>
              <span className={cx('text-[11px] font-semibold', i + 1 === day ? 'text-stock' : 'text-muted')}>Day {i + 1}</span>
            </li>
          );
        })}
      </ol>
    </Surface>
  );
}

function LevelProgress() {
  const me = useMe();
  const lp = me.level;
  const maxed = lp.needed === 0;
  return (
    <Surface tone="walnut" as="section" className="flex items-center gap-4 p-4 short:p-3" aria-labelledby="level-heading">
      <LevelBadge level={lp.level} progress={lp} size={64} />
      <div className="min-w-0 flex-1">
        <h2 id="level-heading" className="text-xl text-stock">Level {lp.level}</h2>
        {maxed ? (
          <p className="text-sm text-muted">You've reached the top level.</p>
        ) : (
          <>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-walnut-950 shadow-inset-well" aria-hidden="true">
              <div className="h-full rounded-full bg-brass" style={{ width: `${levelFraction(lp) * 100}%` }} />
            </div>
            <p className="tabular mt-1 text-sm text-stock-dim">
              {formatChips(lp.into)} / {formatChips(lp.needed)} XP. Level {lp.level + 1} pays{' '}
              <ChipAmount value={levelUpReward(lp.level + 1)} size="sm" className="align-middle text-stock" />.
            </p>
          </>
        )}
      </div>
    </Surface>
  );
}
