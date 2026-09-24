import { useId, useState, type ReactNode } from 'react';
import {
  CATEGORY_NAME,
  formatChips,
  formatDuration,
  formatPercent,
  formatSigned,
  RARITY_NAME,
  achievementLabel,
  getAchievement,
  tierInfo,
  type ProfileCard,
  type ProfileTrophies,
} from '@poker/shared';
import { ApiError } from '../../app/api';
import { useApi, useLobby, useMe } from '../../app/client';
import { useMediaQuery } from '../../app/hooks';
import { useNav } from '../../app/nav';
import { CardBackPattern, TitleTag } from '../../cosmetics';
import { Emblem } from '../../cosmetics/Emblem';
import { TrophyShelf } from '../../cosmetics/TrophyShelf';
import { Avatar, Button, ChartIcon, ChatIcon, CloseIcon, IconButton, LevelBadge, Modal, RefreshIcon, Spinner, cx, levelFraction } from '../../ui';
import { useAsync } from '../common/useAsync';
import { FormTally, formSummary } from './FormTally';

export interface ProfileCardModalProps {
  playerId: string;
  onClose(): void;
}

const joinedFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });

/** "Sep 2026" */
function joined(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown' : joinedFmt.format(d);
}

/**
 * A player's profile card: a printed card-stock trading card with their card
 * back as the art, their framed portrait, and a stat sheet on the lower half.
 */
export function ProfileCardModal({ playerId, onClose }: ProfileCardModalProps) {
  const api = useApi();
  const me = useMe();
  const nav = useNav();
  const member = useLobby()?.members.find((m) => m.id === playerId);
  // Wide screens get the card opened out: the front on the left, the stat sheet on the right.
  const landscape = useMediaQuery('(min-width: 600px)');
  const card = useAsync(() => api.profile(playerId), [api, playerId]);
  const isMe = playerId === me.id;
  const knownName = card.data?.name ?? (isMe ? me.name : member?.name);
  const notFound = !card.data && card.loadError instanceof ApiError && card.loadError.status === 404;

  const footer = card.data ? (
    <>
      {isMe ? (
        <Button
          variant="brass"
          icon={<ChartIcon size={18} />}
          onClick={() => {
            nav.go('stats');
            onClose();
          }}
        >
          View stats
        </Button>
      ) : (
        <Button
          icon={<ChatIcon size={18} />}
          onClick={() => {
            nav.openMessages(playerId);
            onClose();
          }}
        >
          Message
        </Button>
      )}
    </>
  ) : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      tone="paper"
      size={landscape ? 'lg' : 'sm'}
      hideHeader
      title={knownName ? `${knownName}'s profile card` : 'Player profile card'}
      footer={footer}
    >
      {card.data ? (
        <CardFace card={card.data} isMe={isMe} landscape={landscape} onClose={onClose} />
      ) : card.loading ? (
        <div className="relative grid min-h-72 place-items-center pt-5">
          <CloseButton onClose={onClose} className="absolute top-3 right-0" />
          <Spinner size={28} label="Loading profile" className="text-brass-dark" />
        </div>
      ) : (
        <div className="relative flex min-h-60 flex-col items-center justify-center gap-2 pt-8 text-center">
          <CloseButton onClose={onClose} className="absolute top-3 right-0" />
          <h3 className="text-xl text-ink">{notFound ? 'No such player' : "Couldn't load this profile"}</h3>
          <p className="max-w-64 text-sm text-ink-soft">
            {notFound ? "This player hasn't signed in here, or their account is gone." : card.error}
          </p>
          {!notFound && (
            <button
              type="button"
              onClick={card.reload}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold text-ink ring-1 ring-inset ring-ink/30 hover:bg-ink/8"
            >
              <RefreshIcon size={16} /> Try again
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

function CloseButton({ onClose, className }: { onClose(): void; className?: string }) {
  return (
    <IconButton label="Close" size="sm" onClick={onClose} className={cx('z-10 bg-stock/90 text-ink! shadow-card hover:bg-stock', className)}>
      <CloseIcon size={18} />
    </IconButton>
  );
}

function CardFace({ card, isMe, landscape, onClose }: { card: ProfileCard; isMe: boolean; landscape: boolean; onClose(): void }) {
  const lp = card.levelProgress;
  const s = card.stats;
  const form = formSummary(card.recentForm);
  return (
    // The printed frame: a heavy outer rule and a hairline inside it, like a card's border.
    <div className="mt-4 rounded-[14px] border-[3px] border-ink/85 p-[3px]">
      <div className={cx('rounded-[10px] border border-ink/35 p-3', landscape && 'grid grid-cols-[minmax(0,4fr)_minmax(0,7fr)] short:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
        <div className={cx('flex flex-col', landscape && 'pr-4')}>
          {/* Art window: the player's card back, with their framed portrait. */}
          <div className={cx('relative overflow-hidden rounded-md ring-1 ring-ink/40', landscape ? 'h-40 short:h-24' : 'h-32')}>
            <CardBackPattern backId={card.cosmetics.cardBack} className="absolute inset-0" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_75%,transparent_20%,rgb(0_0_0/0.45))]" aria-hidden="true" />
            <span className="absolute top-2 left-2 grid place-items-center rounded-full bg-stock p-[3px] shadow-card">
              <LevelBadge level={card.level} progress={lp} size={40} />
            </span>
            <CloseButton onClose={onClose} className="absolute top-2 right-2" />
          </div>
          <div className="-mt-12 flex flex-col items-center text-center short:-mt-10">
            <span className="rounded-full bg-stock p-1 shadow-card">
              <Avatar src={card.avatarUrl} name={card.name} frameId={card.cosmetics.frame} size={landscape ? 76 : 92} />
            </span>
            <h3 className="mt-1.5 max-w-full truncate text-2xl leading-tight text-ink">{card.name}</h3>
            <div className="mt-1 flex min-h-6 items-center gap-2">
              <TitleTag title={card.cosmetics.title} size="md" tone="paper" />
              {isMe && <span className="text-[13px] font-semibold text-ink-soft">That's you</span>}
            </div>
          </div>

          <dl className="mt-3 grid grid-cols-3 divide-x divide-ink/20 rounded-md bg-ink/5 py-2 text-center ring-1 ring-inset ring-ink/15">
            <Vital label="Total chips">
              {/* The server counts chips on the table too, so this can differ from the lobby bankroll. */}
              <span className="font-display text-[17px] leading-none tabular" title="Bankroll plus chips at a table">{formatChips(card.bankroll)}</span>
              <span className="sr-only"> (bankroll plus chips at a table)</span>
            </Vital>
            <Vital label={`Level ${card.level}`}>
              <XpBar into={lp.into} needed={lp.needed} />
            </Vital>
            <Vital label="Joined">
              <span className="font-condensed text-[16px] font-bold leading-none">{joined(card.joinedAt)}</span>
            </Vital>
          </dl>
        </div>

        <div className={cx('@container flex flex-col', landscape ? 'border-l-2 border-dotted border-ink/20 pl-4' : 'mt-4')}>
          <h4 className="sr-only">Stats</h4>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-[3px] @[17.5rem]:grid-cols-2">
            <Line label="Hands played">{formatChips(s.handsPlayed)}</Line>
            <Line label="Win rate">{s.handsPlayed ? formatPercent(s.winRate) : '–'}</Line>
            <Line label="Net profit">
              <span className={s.netProfit > 0 ? 'text-baize' : s.netProfit < 0 ? 'text-chip-dark' : undefined}>{formatSigned(s.netProfit)}</span>
            </Line>
            <Line label="Biggest pot">{formatChips(s.biggestPotWon)}</Line>
            <Line label="Best hand shown" wide>{s.bestHand ? CATEGORY_NAME[s.bestHand] : 'None yet'}</Line>
            <Line label="VPIP">{s.handsPlayed ? formatPercent(s.vpip) : '–'}</Line>
            <Line label="PFR">{s.handsPlayed ? formatPercent(s.pfr) : '–'}</Line>
            <Line label="Aggression">{s.handsPlayed ? s.aggressionFactor.toFixed(1) : '–'}</Line>
            <Line label="Showdown wins">{s.handsPlayed ? formatPercent(s.showdownWinRate) : '–'}</Line>
            <Line label="Sessions">{formatChips(s.sessionsPlayed)}</Line>
            <Line label="Time played">{formatDuration(s.totalPlayMs)}</Line>
            <Line label="Items owned">{formatChips(card.itemsOwned)}</Line>
          </dl>

          <section className="mt-4" aria-labelledby="form-heading">
            <div className="flex items-baseline justify-between gap-2">
              <h4 id="form-heading" className="font-display text-[15px] text-ink">Recent form</h4>
              {card.recentForm.length > 0 && (
                <p className="tabular font-condensed text-[14px] font-semibold text-ink-soft">
                  {form.up} won, {form.down} lost
                  <span className={cx('ml-2 font-bold', form.net > 0 ? 'text-baize' : form.net < 0 ? 'text-chip-dark' : 'text-ink')}>{formatSigned(form.net)}</span>
                </p>
              )}
            </div>
            {card.recentForm.length > 0 ? (
              <FormTally results={card.recentForm} className="mt-1 h-10 w-full" />
            ) : (
              <p className="mt-1 text-sm text-ink-soft">No hands played yet.</p>
            )}
          </section>

          <TrophySection trophies={card.trophies} landscape={landscape} />
        </div>
      </div>
    </div>
  );
}

function Vital({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-1 px-1.5">
      <dt className="font-condensed text-[13px] font-semibold text-ink-soft">{label}</dt>
      <dd className="w-full text-ink">{children}</dd>
    </div>
  );
}

function XpBar({ into, needed }: { into: number; needed: number }) {
  const frac = levelFraction({ level: 0, into, needed });
  return (
    <span className="flex flex-col items-center gap-1">
      <span className="block h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-ink/15" aria-hidden="true">
        <span className="block h-full rounded-full bg-brass-dark" style={{ width: `${frac * 100}%` }} />
      </span>
      <span className="tabular font-condensed text-[12px] font-semibold leading-none text-ink-soft">
        {needed > 0 ? `${formatChips(into)} / ${formatChips(needed)} XP` : 'Max level'}
      </span>
    </span>
  );
}

/** One engraved stat line with a dotted leader between label and value. */
function Line({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('flex items-baseline gap-1.5 font-condensed text-[15px] leading-6 short:text-[14px] short:leading-5', wide && '@[17.5rem]:col-span-2')}>
      <dt className="shrink-0 font-semibold text-ink-soft">{label}</dt>
      <span className="min-w-3 flex-1 translate-y-[-4px] border-b-2 border-dotted border-ink/25" aria-hidden="true" />
      <dd className="tabular shrink-0 text-right font-bold text-ink">{children}</dd>
    </div>
  );
}

const unlockedFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Unlocked Sep 24, 2026" for a tooltip. */
function unlockedOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unlocked' : `Unlocked ${unlockedFmt.format(d)}`;
}

/** The trophy cabinet: the player's showcase on a walnut shelf, and everything they've unlocked. */
function TrophySection({ trophies, landscape }: { trophies: ProfileTrophies; landscape: boolean }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const tierOf = new Map(trophies.unlocked.map((u) => [u.id, u.tier]));
  const shelf = trophies.showcase.filter((id) => getAchievement(id) && tierOf.has(id)).map((id) => ({ id, tier: tierOf.get(id)! }));
  const unlocked = trophies.unlocked.filter((u) => getAchievement(u.id));
  return (
    <section className="mt-3" aria-labelledby="trophies-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h4 id="trophies-heading" className="font-display text-[15px] text-ink">Trophy cabinet</h4>
        {trophies.emblems > 0 && (
          <p className="tabular font-condensed text-[14px] font-semibold text-ink-soft">{trophies.emblems} of {trophies.total} emblems</p>
        )}
      </div>
      {unlocked.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">No emblems yet. They come from career challenges and feats.</p>
      ) : (
        <>
          <TrophyShelf label="Showcase" items={shelf} size={landscape ? 46 : 44} className="mt-1.5" />
          <button
            type="button"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((v) => !v)}
            className="mt-1.5 inline-flex h-8 items-center rounded-md px-2 text-[13px] font-semibold text-ink ring-1 ring-inset ring-ink/30 hover:bg-ink/8"
          >
            {all ? 'Show fewer' : 'See all'}
          </button>
          {all && (
            <ul id={listId} aria-label="Every unlocked emblem" className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1.5 @[17.5rem]:grid-cols-2">
              {unlocked.map((u) => {
                const def = getAchievement(u.id)!;
                return (
                  <li key={u.id} className="flex min-w-0 items-center gap-2" title={unlockedOn(u.unlockedAt)}>
                    <Emblem achievementId={u.id} tier={u.tier} size={32} decorative />
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate font-condensed text-[15px] font-bold text-ink">{achievementLabel(def, u.tier)}</span>
                      <span className="block text-[12px] text-ink-soft">
                        {def.kind === 'feat' ? `${RARITY_NAME[def.rarity]} feat` : `${tierInfo(u.tier).name} · tier ${tierInfo(u.tier).roman}`}
                        <span className="sr-only">. {unlockedOn(u.unlockedAt)}</span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
