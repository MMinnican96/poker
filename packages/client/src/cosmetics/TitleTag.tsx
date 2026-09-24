import { getItem, getTitle } from '@poker/shared';
import { cx } from '../ui/cx';

export interface TitleTagProps {
  /** Title text (from `Cosmetics.title`), or a title id (shop `title-*` or earned `ach:*`). Empty/null renders nothing. */
  title: string | null | undefined;
  size?: 'sm' | 'md';
  /** dark (default) = brass on walnut; paper = ink on card stock. */
  tone?: 'dark' | 'paper';
  className?: string;
}

/** Resolve a title id (shop or achievement) to its text; plain text passes through. */
export function titleText(title: string | null | undefined): string | null {
  if (!title) return null;
  const known = getTitle(title);
  if (known) return known.text || null;
  // Another kind of catalog item is not a title.
  if (getItem(title)) return null;
  return title;
}

/** A player's title, stamped like a small brass name plate. */
export function TitleTag({ title, size = 'sm', tone = 'dark', className }: TitleTagProps) {
  const text = titleText(title);
  if (!text) return null;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-sm border font-condensed font-semibold',
        tone === 'paper' ? 'border-ink/45 bg-ink/6 text-ink' : 'border-brass/60 bg-brass/12 text-brass-light',
        size === 'sm' ? 'px-1.5 text-[12px] leading-[18px]' : 'px-2 text-sm leading-6',
        className,
      )}
    >
      {text}
    </span>
  );
}
