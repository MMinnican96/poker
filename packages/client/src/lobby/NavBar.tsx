import type { ComponentType } from 'react';
import { useMe, useTable } from '../app/client';
import { useNav, type Section } from '../app/nav';
import { ChartIcon, ChatIcon, CountBadge, ShopIcon, TableIcon, TargetIcon, TrophyIcon, cx, type IconProps } from '../ui';

interface NavItem {
  id: Section;
  label: string;
  Icon: ComponentType<IconProps>;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'table', label: 'Table', Icon: TableIcon },
  { id: 'leaderboard', label: 'Leaderboard', Icon: TrophyIcon },
  { id: 'stats', label: 'Stats', Icon: ChartIcon },
  { id: 'challenges', label: 'Challenges', Icon: TargetIcon },
  { id: 'shop', label: 'Shop', Icon: ShopIcon },
  { id: 'messages', label: 'Messages', Icon: ChatIcon },
];

/**
 * Main navigation: a vertical rail from 640px up, a bottom tab bar on phones.
 * The active item gets the clay-chip edge ring.
 */
export function NavBar({ orientation }: { orientation: 'rail' | 'bar' }) {
  const nav = useNav();
  const me = useMe();
  const atTable = useTable() !== null;
  const badges: Partial<Record<Section, { count: number; label: readonly [string, string] }>> = {
    messages: { count: me.unreadMessages, label: ['unread message', 'unread messages'] },
    challenges: { count: me.unclaimedChallenges, label: ['challenge to claim', 'challenges to claim'] },
  };
  const rail = orientation === 'rail';
  return (
    <nav
      aria-label="Main"
      className={cx(
        rail
          ? 'flex w-[76px] shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-r border-walnut-950 bg-walnut-900 py-2 short:w-16 short:gap-0 short:py-1'
          : 'flex shrink-0 items-stretch justify-around border-t border-walnut-950 bg-walnut-900 px-1 pb-[max(env(safe-area-inset-bottom),4px)]',
      )}
    >
      {NAV_ITEMS.map(({ id, label, Icon }) => {
        const active = nav.section === id;
        const badge = badges[id];
        const shownLabel = id === 'table' && atTable ? 'Your table' : label;
        return (
          <button
            key={id}
            type="button"
            onClick={() => nav.go(id)}
            aria-current={active ? 'page' : undefined}
            title={rail ? shownLabel : undefined}
            className={cx(
              'group relative flex flex-col items-center gap-0.5 rounded-lg px-1 transition-colors',
              rail ? 'py-1.5 short:py-1' : 'min-w-0 flex-1 py-1.5',
              active ? 'text-brass-light' : 'text-stock-dim hover:text-stock',
            )}
          >
            <span className="relative grid size-10 place-items-center short:size-9">
              <svg viewBox="0 0 40 40" className={cx('absolute inset-0 h-full w-full', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40')} aria-hidden="true">
                <circle cx="20" cy="20" r="18" fill="none" className="stroke-brass" strokeWidth="3" strokeDasharray="6.07 3.35" />
                <circle cx="20" cy="20" r="15" className="fill-walnut-700" />
              </svg>
              <Icon size={20} className="relative" />
              {badge && <CountBadge count={badge.count} label={badge.label} className="absolute -top-0.5 -right-1.5" />}
              {id === 'table' && atTable && !active && (
                <span className="absolute right-0 bottom-0.5 size-2.5 rounded-full bg-positive ring-2 ring-walnut-900" aria-hidden="true" />
              )}
            </span>
            <span className={cx('max-w-full truncate font-condensed font-semibold', rail ? 'text-[12px] short:sr-only' : 'text-[11px]')}>
              {shownLabel}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
