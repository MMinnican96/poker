import { useState } from 'react';
import type { Presence } from '@poker/shared';
import { AvatarFrame } from '../cosmetics/AvatarFrame';
import { cx } from './cx';

export const PRESENCE_LABEL: Record<Presence, string> = {
  playing: 'At the table',
  watching: 'Watching',
  lobby: 'In the lobby',
};

const PRESENCE_DOT: Record<Presence, string> = {
  playing: 'bg-positive',
  watching: 'bg-brass',
  lobby: 'bg-walnut-400',
};

export interface AvatarProps {
  src: string | null | undefined;
  /** Used for the alt text and the initials fallback. */
  name: string;
  /** Frame cosmetic item id (e.g. `player.cosmetics.frame`). */
  frameId?: string;
  /** Outer size in px, frame included. */
  size?: number;
  /** Adds a presence dot at the lower right. */
  presence?: Presence;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** A player's picture inside their frame cosmetic, with an initials fallback. Decorative: show the name next to it. */
export function Avatar({ src, name, frameId = 'frame-none', size = 40, presence, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImg = !!src && !failed;
  return (
    <span className={cx('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
      <AvatarFrame frameId={frameId} size={size}>
        {showImg ? (
          <img src={src!} alt="" className="h-full w-full object-cover" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <span
            className="grid h-full w-full place-items-center bg-walnut-600 font-condensed font-bold text-stock-dim"
            style={{ fontSize: Math.max(9, size * 0.34) }}
            aria-hidden="true"
          >
            {initials(name)}
          </span>
        )}
      </AvatarFrame>
      {presence && (
        <span
          title={PRESENCE_LABEL[presence]}
          className={cx('absolute right-0 bottom-0 rounded-full ring-2 ring-walnut-800', PRESENCE_DOT[presence])}
          style={{ width: Math.max(8, size * 0.24), height: Math.max(8, size * 0.24) }}
        />
      )}
    </span>
  );
}
