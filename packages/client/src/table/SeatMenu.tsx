import { useEffect, useRef, type RefObject } from 'react';
import type { SeatPlayer } from '@poker/shared';
import { useCommands, useMe } from '../app/client';
import { useNav, useProfileCard } from '../app/nav';
import { TitleTag, ownedOfCategory } from '../cosmetics';
import { Button, ShopIcon, cx } from '../ui';
import { useDismiss, useMenuKeys, useRun } from './hooks';
import type { Point } from './layout';

export interface SeatMenuProps {
  player: SeatPlayer;
  at: Point;
  stage: { width: number; height: number };
  avatar: number;
  /** Throwables can only target seated players other than you. */
  canThrow: boolean;
  onClose(): void;
  /** The seat button that opened the menu: clicking it again closes the menu (instead of close-then-reopen). */
  anchor?: RefObject<HTMLElement | null>;
}

const MENU_W = 232;

/** A small card over another player's seat: their profile, and things to throw at them. */
export function SeatMenu({ player, at, stage, avatar, canThrow, onClose, anchor }: SeatMenuProps) {
  const me = useMe();
  const commands = useCommands();
  const profile = useProfileCard();
  const nav = useNav();
  const [run, busy] = useRun();
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, ref, onClose, anchor);
  const onKeyDown = useMenuKeys(ref);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  const throwables = ownedOfCategory(me.owned, 'throwable').filter((i) => (me.owned[i.id] ?? 0) > 0);
  const below = at.y < stage.height * 0.45;
  const left = Math.max(8, Math.min(stage.width - MENU_W - 8, at.x - MENU_W / 2));
  const style = below ? { left, top: at.y + avatar * 0.75 } : { left, bottom: stage.height - at.y + avatar * 0.75 };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${player.name}`}
      onKeyDown={onKeyDown}
      className="absolute z-40 flex max-h-[80%] flex-col overflow-y-auto rounded-xl bg-stock p-3 text-ink shadow-lift ring-1 ring-stock-edge tex-grain motion-safe:animate-rise"
      style={{ width: MENU_W, ...style }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <p className="truncate font-display text-lg leading-tight">{player.name}</p>
        {player.cosmetics.title && <TitleTag title={player.cosmetics.title} className="border-brass-dark! bg-brass/25! text-ink!" />}
      </div>
      <Button
        role="menuitem"
        size="sm"
        variant="brass"
        onClick={() => {
          onClose();
          profile.open(player.id);
        }}
      >
        View profile
      </Button>
      {canThrow && (
        <div className="mt-3">
          <p className="mb-1.5 text-[13px] font-semibold text-ink-soft">Throw something</p>
          {throwables.length > 0 ? (
            <ul className="grid gap-1.5">
              {throwables.map((item) => {
                const v = item.visual.kind === 'throwable' ? item.visual : null;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy !== null}
                      onClick={async () => {
                        const ack = await run(item.id, () => commands.throwItem(item.id, player.id));
                        if (ack.ok) onClose();
                      }}
                      className={cx(
                        'flex w-full items-center gap-1.5 rounded-lg bg-ink/6 px-2 py-1.5 text-left ring-1 ring-ink/10 transition-colors hover:bg-ink/12 disabled:opacity-50',
                      )}
                      aria-label={`Throw ${item.name.toLowerCase()} at ${player.name}, ${me.owned[item.id]} left`}
                    >
                      <span className="text-xl leading-none" aria-hidden="true">{v?.glyph}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{item.name}</span>
                      <span className="tabular text-[12px] font-bold text-ink-soft" aria-hidden="true">{me.owned[item.id]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[13px] text-ink-soft">You have nothing to throw. Tomatoes and cheese are in the shop.</p>
              <Button
                size="sm"
                variant="ghost"
                role="menuitem"
                icon={<ShopIcon size={16} />}
                className="text-ink! ring-ink/30!"
                onClick={() => {
                  onClose();
                  nav.go('shop');
                }}
              >
                Go to the shop
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
