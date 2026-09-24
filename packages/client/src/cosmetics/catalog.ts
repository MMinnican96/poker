import {
  CATALOG,
  getItem,
  type CardBackVisual,
  type CelebrationVisual,
  type FeltVisual,
  type FrameVisual,
  type ItemVisual,
  type ShopItem,
} from '@poker/shared';

function visualOf<K extends ItemVisual['kind']>(id: string, kind: K, fallbackId: string): Extract<ItemVisual, { kind: K }> {
  const v = getItem(id)?.visual;
  if (v && v.kind === kind) return v as Extract<ItemVisual, { kind: K }>;
  return getItem(fallbackId)!.visual as Extract<ItemVisual, { kind: K }>;
}

/** Catalog visuals with safe fallbacks to the free default item. */
export const feltVisual = (id: string): FeltVisual => visualOf(id, 'felt', 'felt-classic');
export const cardBackVisual = (id: string): CardBackVisual => visualOf(id, 'card-back', 'back-classic');
export const frameVisual = (id: string): FrameVisual => visualOf(id, 'frame', 'frame-none');
export const celebrationVisual = (id: string): CelebrationVisual => visualOf(id, 'celebration', 'cele-confetti');

/** Does the player own this item (free items are owned by everyone)? */
export function owns(owned: Record<string, number>, id: string): boolean {
  const item = getItem(id);
  return !!item && (item.price === 0 || (owned[id] ?? 0) > 0);
}

/** Catalog items of one category the player owns. */
export function ownedOfCategory(owned: Record<string, number>, category: ShopItem['category']): ShopItem[] {
  return CATALOG.filter((i) => i.category === category && owns(owned, i.id));
}
