import type { ShopItem } from '@poker/shared';
import { cx } from '../ui/cx';
import { AvatarFrame } from './AvatarFrame';
import { CardBack } from './CardBack';
import { CelebrationPreview } from './celebration';
import { Felt } from './Felt';
import { TitleTag } from './TitleTag';

export interface ItemPreviewProps {
  item: ShopItem;
  /** Box size in px (square). */
  size?: number;
  className?: string;
}

/** Renders any catalog item's visual in a square box — for shop tiles, pickers and receipts. */
export function ItemPreview({ item, size = 96, className }: ItemPreviewProps) {
  const v = item.visual;
  const box = cx('relative grid shrink-0 place-items-center overflow-hidden rounded-lg', className);
  const style = { width: size, height: size };
  switch (v.kind) {
    case 'felt':
      return (
        <div className={box} style={style}>
          <Felt feltId={item.id} shape="rect" crestScale={0.62} className="absolute inset-0" />
        </div>
      );
    case 'card-back':
      return (
        <div className={cx(box, 'bg-walnut-900')} style={style}>
          <CardBack backId={item.id} width={Math.round(size * 0.5)} />
        </div>
      );
    case 'frame':
      return (
        <div className={cx(box, 'bg-walnut-900')} style={style}>
          <AvatarFrame frameId={item.id} size={Math.round(size * 0.62)}>
            <span className="grid h-full w-full place-items-center bg-walnut-600 font-display text-stock-dim" style={{ fontSize: size * 0.2 }}>R</span>
          </AvatarFrame>
        </div>
      );
    case 'title':
      return (
        <div className={cx(box, 'bg-walnut-900 px-2')} style={style}>
          {v.text ? <TitleTag title={v.text} size="md" /> : <span className="text-sm text-muted">No title</span>}
        </div>
      );
    case 'celebration':
      return (
        <div className={cx(box, 'bg-baize-deep')} style={style}>
          <CelebrationPreview celebrationId={item.id} className="h-full w-full" />
        </div>
      );
    case 'emote-pack':
      return (
        <div className={cx(box, 'bg-walnut-900')} style={style}>
          <div className="grid grid-cols-3 gap-0.5 text-center" style={{ fontSize: size * 0.2 }} aria-hidden="true">
            {v.emotes.slice(0, 6).map((e) => <span key={e}>{e}</span>)}
          </div>
        </div>
      );
    case 'throwable':
      return (
        <div className={cx(box, 'bg-walnut-900')} style={style}>
          <span className="absolute rounded-full opacity-35 blur-[2px]" style={{ width: size * 0.62, height: size * 0.5, background: v.splat }} />
          <span className="relative" style={{ fontSize: size * 0.42 }} aria-hidden="true">{v.glyph}</span>
        </div>
      );
  }
}
