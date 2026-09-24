import { useState } from 'react';
import {
  LEADERBOARD_METRICS,
  formatChips,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardPeriod,
} from '@poker/shared';
import { useApi, useMe } from '../../app/client';
import { useProfileCard } from '../../app/nav';
import { TitleTag } from '../../cosmetics';
import { Avatar, Button, ChipAmount, EmptyState, Field, Segmented, cx } from '../../ui';
import { LoadError, Loading, Screen } from '../common/Screen';
import { useAsync } from '../common/useAsync';

/** Rows shown before "Show more"; the board is fetched deeper to find you. */
export const SHOWN = 25;
export const FETCH_LIMIT = 100;

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'week', label: 'This week' },
];

const CHIP_METRICS = new Set<LeaderboardMetric>(['net_profit', 'chips_won', 'biggest_pot_won', 'bankroll']);

/** The metric's value as it should read on the board. */
function Value({ metric, value, size = 'md' }: { metric: LeaderboardMetric; value: number; size?: 'md' | 'lg' }) {
  if (CHIP_METRICS.has(metric)) {
    return <ChipAmount value={value} signed={metric === 'net_profit'} short={size === 'lg'} size={size === 'lg' ? 'lg' : 'md'} />;
  }
  const unit = metric === 'level' ? null : value === 1 ? 'hand' : 'hands';
  return (
    <span className={cx('tabular whitespace-nowrap', size === 'lg' ? 'font-display text-xl' : 'text-[15px] font-semibold')}>
      {metric === 'level' ? `Level ${value}` : formatChips(value)}
      {unit && <span className="ml-1 font-ui text-[13px] font-medium text-muted">{unit}</span>}
    </span>
  );
}

/** "1st", "2nd", "=3rd" for a tie. */
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

/** Rank as shown: tied ranks get a leading "=". */
function rankText(entry: LeaderboardEntry, tied: boolean): string {
  return `${tied ? '=' : ''}${entry.rank}`;
}

function tiedRanks(entries: LeaderboardEntry[]): Set<number> {
  const counts = new Map<number, number>();
  for (const e of entries) counts.set(e.rank, (counts.get(e.rank) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([r]) => r));
}

export function LeaderboardScreen() {
  const api = useApi();
  const me = useMe();
  const [metric, setMetric] = useState<LeaderboardMetric>('net_profit');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const [expanded, setExpanded] = useState(false);
  const def = LEADERBOARD_METRICS.find((m) => m.id === metric)!;
  // Metrics without a weekly board always read all-time.
  const effective: LeaderboardPeriod = def.weekly ? period : 'all';
  const board = useAsync(() => api.leaderboard(metric, effective, FETCH_LIMIT), [api, metric, effective]);

  const entries = board.data ?? [];
  const shown = expanded ? entries : entries.slice(0, SHOWN);
  const ties = tiedRanks(entries);
  const mine = entries.find((e) => e.player.id === me.id);
  const mineShown = !!mine && shown.includes(mine);
  const podium = shown.slice(0, 3);
  const rest = shown.slice(3);

  return (
    <Screen id="leaderboard-heading" title="Leaderboard" intro="Who's up, who's down, and who never leaves the table.">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <Field label="Ranked by" group className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <Segmented
            size="sm"
            className="flex-nowrap! overflow-x-auto pb-1 [scrollbar-width:none] [&>button]:shrink-0 [&>button]:whitespace-nowrap"
            value={metric}
            onChange={(m) => {
              setMetric(m);
              setExpanded(false);
            }}
            options={LEADERBOARD_METRICS.map((m) => ({ value: m.id, label: m.label }))}
          />
        </Field>
        <Field
          label="Period"
          group
          hint={def.weekly ? undefined : `${def.label} is always all time.`}
        >
          <Segmented
            size="sm"
            value={effective}
            onChange={(p) => {
              setPeriod(p);
              setExpanded(false);
            }}
            options={PERIODS.map((p) => ({ ...p, disabled: p.value === 'week' && !def.weekly }))}
          />
        </Field>
      </div>

      {board.data === undefined && board.loading ? (
        <Loading label="Loading the leaderboard" />
      ) : board.data === undefined && board.error ? (
        <LoadError what="the leaderboard" error={board.error} onRetry={board.reload} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nobody's on the board yet"
          body={effective === 'week' ? 'No hands played this week. Deal one in and take the top spot.' : 'Play a hand to put your name up here.'}
        />
      ) : (
        <div className={cx('flex flex-col gap-4 transition-opacity', board.loading && 'opacity-60')} aria-busy={board.loading || undefined}>
          <h2 className="sr-only">{`${def.label}, ${effective === 'week' ? 'this week' : 'all time'}`}</h2>
          <Podium entries={podium} metric={metric} ties={ties} meId={me.id} />
          {rest.length > 0 && (
            <ol className="flex flex-col gap-1 rounded-xl bg-walnut-950/60 p-1.5 ring-1 ring-inset ring-black/40 shadow-inset-well" aria-label="Rankings">
              {rest.map((e) => (
                <li key={e.player.id}>
                  <Row entry={e} metric={metric} tied={ties.has(e.rank)} isMe={e.player.id === me.id} />
                </li>
              ))}
            </ol>
          )}
          {!expanded && entries.length > SHOWN && (
            <Button variant="ghost" size="sm" className="self-center" onClick={() => setExpanded(true)}>
              Show the top {entries.length}
            </Button>
          )}
          {!mineShown && (
            <div aria-label="Your position" role="group" className="flex flex-col gap-1">
              <p className="px-2 text-[13px] font-semibold text-muted">Your position</p>
              {mine ? (
                <Row entry={mine} metric={metric} tied={ties.has(mine.rank)} isMe />
              ) : (
                <p className="rounded-lg bg-walnut-950/60 px-3 py-2.5 text-sm text-stock-dim ring-1 ring-inset ring-black/40">
                  {entries.length >= FETCH_LIMIT
                    ? `You're outside the top ${FETCH_LIMIT}. Keep playing.`
                    : effective === 'week'
                      ? "You're not ranked this week. Play a hand to get on the board."
                      : "You're not on this board yet. Play a hand to get ranked."}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Screen>
  );
}

const PLACE = [
  { plate: 'bg-brass text-ink shadow-edge-brass', step: 'h-20 short:h-12', size: 76, order: 'col-start-2 row-start-1' },
  { plate: 'bg-stock-dim text-ink shadow-[0_3px_0_var(--color-stock-edge)]', step: 'h-14 short:h-9', size: 60, order: 'col-start-1 row-start-1' },
  { plate: 'bg-bronze text-stock shadow-edge-walnut', step: 'h-10 short:h-7', size: 60, order: 'col-start-3 row-start-1' },
] as const;

/** The top three on stepped walnut blocks: 2nd, 1st, 3rd. */
function Podium({ entries, metric, ties, meId }: { entries: LeaderboardEntry[]; metric: LeaderboardMetric; ties: Set<number>; meId: string }) {
  const profile = useProfileCard();
  return (
    <ol className="grid grid-cols-3 items-end gap-2 sm:gap-4" aria-label="Top three">
      {entries.map((e, i) => {
        const place = PLACE[Math.min(e.rank, 3) - 1] ?? PLACE[2];
        const isMe = e.player.id === meId;
        const tied = ties.has(e.rank);
        return (
          <li key={e.player.id} className={cx('flex min-w-0 flex-col items-center', PLACE[i].order)}>
            <button
              type="button"
              onClick={() => profile.open(e.player.id)}
              className="group flex w-full min-w-0 flex-col items-center gap-1 rounded-xl px-1 pt-2 pb-2 hover:bg-walnut-800/70"
              aria-label={`${tied ? 'Tied ' : ''}${ordinal(e.rank)}: ${e.player.name}${isMe ? ' (you)' : ''}. Open profile card.`}
            >
              <Avatar src={e.player.avatarUrl} name={e.player.name} frameId={e.player.cosmetics.frame} size={place.size} className="short:scale-75" />
              <span className={cx('mt-1 max-w-full truncate font-semibold', isMe ? 'text-brass-light' : 'text-stock')}>
                {e.player.name}
                {isMe && <span className="ml-1 text-[13px] font-medium text-muted">(you)</span>}
              </span>
              <TitleTag title={e.player.cosmetics.title} className="hidden max-w-full truncate sm:inline-flex" />
              <Value metric={metric} value={e.value} size="lg" />
            </button>
            <div
              className={cx(
                'tex-wood relative flex w-full items-start justify-center rounded-t-lg bg-walnut-700 pt-2 ring-1 ring-inset ring-walnut-600',
                place.step,
                isMe && 'ring-2 ring-brass',
              )}
              aria-hidden="true"
            >
              <span className={cx('tabular rounded-md px-2.5 py-0.5 font-display text-lg leading-6 short:text-base short:leading-5', place.plate)}>
                {tied ? '=' : ''}{ordinal(e.rank)}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ entry, metric, tied, isMe }: { entry: LeaderboardEntry; metric: LeaderboardMetric; tied: boolean; isMe: boolean }) {
  const profile = useProfileCard();
  const p = entry.player;
  return (
    <button
      type="button"
      onClick={() => profile.open(p.id)}
      aria-current={isMe ? 'true' : undefined}
      className={cx(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors',
        isMe ? 'bg-brass/15 ring-1 ring-inset ring-brass/70 hover:bg-brass/20' : 'hover:bg-walnut-800',
      )}
    >
      <span className="tabular w-10 shrink-0 text-right font-display text-lg text-stock-dim" aria-label={`${tied ? 'Tied ' : ''}${ordinal(entry.rank)}`}>
        {rankText(entry, tied)}
      </span>
      <Avatar src={p.avatarUrl} name={p.name} frameId={p.cosmetics.frame} size={36} />
      <span className="flex min-w-0 flex-1 flex-col xs:flex-row xs:items-center xs:gap-2">
        <span className={cx('truncate font-semibold', isMe ? 'text-brass-light' : 'text-stock')}>
          {p.name}
          {isMe && <span className="ml-1 text-[13px] font-medium text-muted">(you)</span>}
        </span>
        <TitleTag title={p.cosmetics.title} className="hidden self-start sm:inline-flex sm:self-auto" />
      </span>
      <span className="shrink-0 text-right text-stock">
        <Value metric={metric} value={entry.value} />
      </span>
    </button>
  );
}
