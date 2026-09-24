import type { ReactNode } from 'react';
import {
  CATEGORY_NAME,
  CATEGORY_ORDER,
  formatChips,
  formatDuration,
  formatPercent,
  type PlayerStatsSummary,
} from '@poker/shared';
import type { HandHistoryView } from '../../app/api';
import { useApi, useMe } from '../../app/client';
import { timeAgo, useNow } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { PlayingCard } from '../../cosmetics';
import { Button, ChipAmount, EmptyState, Panel, TableIcon, cx } from '../../ui';
import { LoadError, Loading, Screen } from '../common/Screen';
import { useAsync } from '../common/useAsync';
import { ProfitChart } from './ProfitChart';

export const HISTORY_LIMIT = 20;

export function StatsScreen() {
  const api = useApi();
  const me = useMe();
  const nav = useNav();
  const stats = useAsync(() => api.playerStats(me.id), [api, me.id]);
  const hands = useAsync(() => api.myHands(HISTORY_LIMIT), [api]);

  let body: ReactNode;
  if (!stats.data && stats.loading) body = <Loading label="Loading your stats" />;
  else if (!stats.data) body = <LoadError what="your stats" error={stats.error ?? ''} onRetry={stats.reload} />;
  else if (stats.data.summary.handsPlayed === 0) {
    body = (
      <EmptyState
        title="No hands yet"
        body="Take a seat and play a hand. Your win rate, profit and every hand you play show up here."
        action={<Button icon={<TableIcon size={18} />} onClick={() => nav.go('table')}>Go to the table</Button>}
      />
    );
  } else {
    const { summary: s, curve } = stats.data;
    body = (
      <>
        <Tiles s={s} />
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel title="Profit over time" headingLevel="h2" bodyClassName="px-4 pb-3">
            <p className="-mt-1 mb-2 text-[13px] text-muted">
              Running total of chips won and lost, over your last {curve.length} {curve.length === 1 ? 'hand' : 'hands'}.
            </p>
            {curve.length > 0 ? <ProfitChart curve={curve} /> : <p className="py-8 text-center text-sm text-muted">No hands recorded yet.</p>}
          </Panel>
          <Panel title="Hands shown down" headingLevel="h2">
            <CategoryBars counts={s.categoryCounts} />
          </Panel>
        </div>
        <Panel title="Recent hands" headingLevel="h2" bodyClassName="px-2 pb-2 sm:px-3 sm:pb-3">
          {!hands.data && hands.loading ? (
            <Loading label="Loading your hands" />
          ) : !hands.data ? (
            <LoadError compact what="your hands" error={hands.error ?? ''} onRetry={hands.reload} />
          ) : hands.data.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">Your hands show up here once they finish.</p>
          ) : (
            <ol className="flex flex-col gap-2" aria-label="Recent hands">
              {hands.data.map((h) => <HandRow key={`${h.tableId}:${h.handNumber}:${h.playedAt}`} hand={h} meId={me.id} />)}
            </ol>
          )}
        </Panel>
      </>
    );
  }

  return (
    <Screen id="stats-heading" title="Your stats" intro="How your nights at the back room have gone, hand by hand.">
      {body}
    </Screen>
  );
}

function Tiles({ s }: { s: PlayerStatsSummary }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-walnut-600/60 ring-1 ring-walnut-600/60 @2xl:grid-cols-4">
        <Tile label="Hands played" value={formatChips(s.handsPlayed)} note={`${formatChips(s.handsWon)} won, ${formatChips(s.handsLost)} lost.`} />
        <Tile label="Win rate" value={formatPercent(s.winRate)} note="Hands you won out of hands you played." />
        <Tile label="Net profit" value={<ChipAmount value={s.netProfit} signed size="lg" bare className="font-ui text-[26px] font-semibold" />} note="Chips won minus chips you put in." />
        <Tile label="Biggest pot" value={<ChipAmount value={s.biggestPotWon} size="lg" bare className="font-ui text-[26px] font-semibold" />} note="The largest pot you've taken down." />
        <Tile
          label="Showdown wins"
          value={s.showdownsSeen ? formatPercent(s.showdownWinRate) : '–'}
          note={s.showdownsSeen ? `You won ${formatChips(s.showdownsWon)} of ${formatChips(s.showdownsSeen)} showdowns.` : 'You haven\'t reached a showdown yet.'}
        />
        <Tile label="VPIP" value={formatPercent(s.vpip)} note="How often you choose to put chips in before the flop." />
        <Tile label="PFR" value={formatPercent(s.pfr)} note="How often you raise before the flop." />
        <Tile label="Aggression" value={s.aggressionFactor.toFixed(1)} note="Bets and raises for every call. Above 2 is aggressive." />
      </dl>
      <p className="mt-2 text-[13px] text-muted">
        {formatDuration(s.totalPlayMs)} at the table over {formatChips(s.sessionsPlayed)} {s.sessionsPlayed === 1 ? 'session' : 'sessions'}, {formatChips(s.flopsSeen)} flops seen.
      </p>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-walnut-900 px-4 py-3 short:py-2">
      <dt className="text-[13px] font-semibold text-stock-dim">{label}</dt>
      <dd className="order-first text-[26px] leading-tight font-semibold text-stock short:text-[22px]">{value}</dd>
      <dd className="text-[12px] leading-snug text-muted">{note}</dd>
    </div>
  );
}

/** Showdown hands by category, strongest first, as thin brass bars with the count at the tip. */
function CategoryBars({ counts }: { counts: PlayerStatsSummary['categoryCounts'] }) {
  const total = CATEGORY_ORDER.reduce((n, c) => n + (counts[c] ?? 0), 0);
  if (total === 0) {
    return <p className="py-6 text-center text-sm text-muted">No hands shown at showdown yet. Win or call down to the river and they're counted here.</p>;
  }
  const max = Math.max(...CATEGORY_ORDER.map((c) => counts[c] ?? 0));
  const rows = [...CATEGORY_ORDER].reverse();
  return (
    <>
      <p className="-mt-1 mb-3 text-[13px] text-muted">The {formatChips(total)} {total === 1 ? 'hand' : 'hands'} you showed at showdown, by what you made.</p>
      <table className="w-full border-separate border-spacing-y-1 text-[14px]">
        <thead className="sr-only">
          <tr><th scope="col">Hand</th><th scope="col">Times shown</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const n = counts[c] ?? 0;
            const share = n / total;
            return (
              <tr key={c} title={`${CATEGORY_NAME[c]}: ${n} (${formatPercent(share)})`}>
                <th scope="row" className={cx('w-[8.5rem] pr-3 text-left font-medium whitespace-nowrap', n ? 'text-stock' : 'text-muted')}>
                  {CATEGORY_NAME[c]}
                </th>
                <td className="p-0 pr-9">
                  <div className="relative h-5">
                    {n > 0 && (
                      <span className="absolute top-[3px] left-0 block h-3.5 rounded-r-[4px] bg-brass" style={{ width: `max(3px, ${(n / max) * 100}%)` }} aria-hidden="true" />
                    )}
                    <span
                      className={cx('tabular absolute top-0 text-[13px] leading-5 font-semibold', n ? 'text-stock' : 'text-walnut-400')}
                      style={{ left: n ? `calc(max(3px, ${(n / max) * 100}%) + 6px)` : 0 }}
                    >
                      {n}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function HandRow({ hand, meId }: { hand: HandHistoryView; meId: string }) {
  const now = useNow();
  const mine = hand.players.find((p) => p.id === meId);
  const others = hand.players.filter((p) => p.id !== meId);
  const names = new Map(hand.players.map((p) => [p.id, p.id === meId ? 'You' : p.name]));
  const board = [...hand.board, ...Array<null>(Math.max(0, 5 - hand.board.length)).fill(null)];
  const net = mine?.net ?? 0;
  return (
    <li className="rounded-lg bg-walnut-950/55 p-3 ring-1 ring-inset ring-black/40">
      <header className="flex items-start justify-between gap-3">
        <p className="flex items-baseline gap-2 text-[13px]">
          <span className="font-semibold text-stock">Hand {hand.handNumber}</span>
          <time className="text-muted" dateTime={hand.playedAt}>{timeAgo(hand.playedAt, now)}</time>
        </p>
        <p className="flex items-baseline gap-2">
          <span className="text-[13px] text-muted">{net > 0 ? 'You won' : net < 0 ? 'You lost' : 'You broke even'}</span>
          <ChipAmount value={net} signed size="lg" bare />
        </p>
      </header>
      <div className="mt-1 flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="flex min-w-36 flex-col gap-1">
          <div className="flex gap-1" aria-label="Your cards" role="group">
            {mine?.cards ? mine.cards.map((c, i) => <PlayingCard key={i} card={c} size="sm" dim={mine.result === 'folded'} />) : null}
          </div>
          <p className="text-[13px] text-stock-dim">
            {mine?.result === 'folded' ? 'You folded' : mine?.handLabel ?? (mine?.result === 'won' ? 'Won uncontested' : 'Mucked')}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-1" role="group" aria-label={hand.board.length ? 'Board' : 'No board dealt'}>
            {board.map((c, i) =>
              c ? (
                <PlayingCard key={i} card={c} size="sm" />
              ) : (
                <span key={i} className="block h-14 w-10 rounded-[4px] border border-dashed border-walnut-600" aria-hidden="true" />
              ),
            )}
          </div>
          <p className="text-[13px] text-muted">{hand.board.length ? 'Board' : 'No flop'}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-walnut-800 pt-2 @xl:flex-row @xl:items-start @xl:gap-6">
        <ul className="flex flex-col gap-0.5 text-[13px] text-stock-dim @xl:max-w-[45%]" aria-label="Pots">
          {hand.pots.map((p, i) => (
            <li key={i}>
              <span className="text-stock">{hand.pots.length > 1 ? (i === 0 ? 'Main pot' : `Side pot ${i}`) : 'Pot'} <ChipAmount value={p.amount} size="sm" /></span>
              {' '}to {p.winnerIds.map((id) => names.get(id) ?? 'someone').join(' and ')}
              {p.handLabel ? `, ${p.handLabel.charAt(0).toLowerCase()}${p.handLabel.slice(1)}` : ''}
            </li>
          ))}
        </ul>
        {others.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-2 @xl:ml-auto" aria-label="Opponents">
            {others.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <span className="flex gap-0.5">
                  {o.cards
                    ? o.cards.map((c, i) => <PlayingCard key={i} card={c} size="xs" />)
                    : [0, 1].map((i) => <PlayingCard key={i} card={null} size="xs" dim={o.result === 'folded'} />)}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="max-w-28 truncate text-[13px] font-semibold text-stock">{o.name}</span>
                  <span className="text-[12px] text-muted">
                    {o.result === 'folded' ? 'Folded' : o.handLabel ?? (o.result === 'won' ? 'Won' : 'Lost')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
