import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

/**
 * Material the surface is made of:
 * - walnut: the default panel on the room background (wood rail)
 * - well: a recessed deep-walnut well for lists and inputs
 * - baize: felt, for game-related areas
 * - paper: card stock with ink text (profile cards, receipts, placards)
 */
export type SurfaceTone = 'walnut' | 'well' | 'baize' | 'paper';

const TONE: Record<SurfaceTone, string> = {
  walnut: 'bg-walnut-800 tex-wood text-stock ring-1 ring-inset ring-walnut-600/70 shadow-panel',
  well: 'bg-walnut-950/70 text-stock ring-1 ring-inset ring-black/40 shadow-inset-well',
  baize: 'bg-baize tex-grain text-stock ring-1 ring-inset ring-black/25 shadow-felt',
  paper: 'bg-stock tex-grain text-ink ring-1 ring-inset ring-stock-edge shadow-card',
};

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  tone?: SurfaceTone;
  /** Element to render (default `div`). */
  as?: ElementType;
  /** Rounded corners; default true. */
  rounded?: boolean;
  padded?: boolean;
}

/** A material-backed box. Everything in the app sits on one of these. */
export function Surface({ tone = 'walnut', as: As = 'div', rounded = true, padded = false, className, ...rest }: SurfaceProps) {
  return <As className={cx(TONE[tone], rounded && 'rounded-xl', padded && 'p-4', className)} {...rest} />;
}

export interface PanelProps extends Omit<SurfaceProps, 'title'> {
  /** Heading shown at the top-left. */
  title?: ReactNode;
  /** Controls on the right of the heading row. */
  actions?: ReactNode;
  /** Heading element level (default h2). */
  headingLevel?: 'h2' | 'h3';
  bodyClassName?: string;
}

/** A Surface with a heading row. Use for sidebar blocks and content sections. */
export function Panel({ title, actions, headingLevel: H = 'h2', children, bodyClassName, className, ...rest }: PanelProps) {
  return (
    <Surface as="section" className={cx('flex min-h-0 flex-col', className)} {...rest}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
          {title && <H className="text-[17px] text-stock">{title}</H>}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cx('min-h-0 flex-1', bodyClassName ?? 'px-4 pb-4')}>{children}</div>
    </Surface>
  );
}
