/**
 * The shop catalog. Static data shared by server (prices, ownership rules) and
 * client (rendering). Items with price 0 are owned by everyone.
 */

import { getAchievementTitle } from './achievements.js';

export type ItemCategory = 'felt' | 'card-back' | 'frame' | 'title' | 'celebration' | 'emote-pack' | 'throwable';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface FeltVisual { kind: 'felt'; base: string; deep: string; line: string; rail: string }
export interface CardBackVisual { kind: 'card-back'; pattern: 'lattice' | 'stripes' | 'cheese' | 'grid' | 'sunburst'; primary: string; secondary: string }
export interface FrameVisual { kind: 'frame'; style: 'none' | 'brass' | 'chip' | 'crown' | 'flames' | 'cheese'; color: string }
export interface TitleVisual { kind: 'title'; text: string }
export interface CelebrationVisual { kind: 'celebration'; style: 'confetti' | 'cheese' | 'fireworks' | 'money'; colors: string[] }
export interface EmotePackVisual { kind: 'emote-pack'; emotes: string[] }
export interface ThrowableVisual { kind: 'throwable'; glyph: string; splat: string }

export type ItemVisual =
  | FeltVisual | CardBackVisual | FrameVisual | TitleVisual
  | CelebrationVisual | EmotePackVisual | ThrowableVisual;

export interface ShopItem {
  id: string;
  category: ItemCategory;
  name: string;
  description: string;
  price: number;
  rarity: Rarity;
  /** Consumables: how many a purchase grants. Absent for permanent items. */
  quantity?: number;
  /** Player level required to buy. */
  minLevel?: number;
  visual: ItemVisual;
}

export const CATALOG: readonly ShopItem[] = [
  // Felts — the host picks one for the table.
  { id: 'felt-classic', category: 'felt', name: 'Back room green', description: 'The house felt. Smells faintly of cheese.', price: 0, rarity: 'common',
    visual: { kind: 'felt', base: '#1f5b3f', deep: '#0f3526', line: '#e8d9ae', rail: '#3b271c' } },
  { id: 'felt-oxblood', category: 'felt', name: 'Oxblood', description: 'Deep red baize for high-stakes grudges.', price: 5000, rarity: 'rare',
    visual: { kind: 'felt', base: '#6e1a1f', deep: '#3a0b0f', line: '#f0cf8a', rail: '#241612' } },
  { id: 'felt-midnight', category: 'felt', name: 'Midnight', description: 'Navy cloth under a brass lamp.', price: 7500, rarity: 'rare',
    visual: { kind: 'felt', base: '#1c3257', deep: '#0c1a33', line: '#d9a441', rail: '#2a1d17' } },
  { id: 'felt-sewer', category: 'felt', name: 'The sewer', description: 'Where the real games happen. Mind the grate.', price: 12000, rarity: 'epic',
    visual: { kind: 'felt', base: '#2c5a55', deep: '#122b28', line: '#9fd3a8', rail: '#35302a' } },
  { id: 'felt-velvet', category: 'felt', name: 'Plum velvet', description: 'Soft, purple, deeply unnecessary.', price: 15000, rarity: 'epic', minLevel: 5,
    visual: { kind: 'felt', base: '#4b2458', deep: '#26102e', line: '#f2c7e0', rail: '#1d1418' } },
  { id: 'felt-high-roller', category: 'felt', name: 'High roller', description: 'Black cloth, gold lines. Only whales.', price: 50000, rarity: 'legendary', minLevel: 10,
    visual: { kind: 'felt', base: '#1b1a17', deep: '#070706', line: '#e3b347', rail: '#5a4214' } },

  // Card backs — what everyone sees on your face-down cards.
  { id: 'back-classic', category: 'card-back', name: 'Club lattice', description: 'Red lattice with the Ratbag crest.', price: 0, rarity: 'common',
    visual: { kind: 'card-back', pattern: 'lattice', primary: '#c8272d', secondary: '#f3e6c8' } },
  { id: 'back-navy', category: 'card-back', name: 'Navy stripe', description: 'A sober back for a sober player.', price: 2000, rarity: 'common',
    visual: { kind: 'card-back', pattern: 'stripes', primary: '#1c3257', secondary: '#e8d9ae' } },
  { id: 'back-cheese', category: 'card-back', name: 'Swiss', description: 'Full of holes, like your bluffs.', price: 6000, rarity: 'rare',
    visual: { kind: 'card-back', pattern: 'cheese', primary: '#f2c14e', secondary: '#c98f1b' } },
  { id: 'back-grid', category: 'card-back', name: 'Blueprint', description: 'Drafted by an engineer who folds too much.', price: 8000, rarity: 'rare',
    visual: { kind: 'card-back', pattern: 'grid', primary: '#16507a', secondary: '#9fd0f0' } },
  { id: 'back-sunburst', category: 'card-back', name: 'Gilded sunburst', description: 'Gold leaf. Obviously.', price: 20000, rarity: 'epic', minLevel: 5,
    visual: { kind: 'card-back', pattern: 'sunburst', primary: '#2a1d17', secondary: '#d9a441' } },

  // Avatar frames.
  { id: 'frame-none', category: 'frame', name: 'No frame', description: 'Just your face.', price: 0, rarity: 'common',
    visual: { kind: 'frame', style: 'none', color: '#00000000' } },
  { id: 'frame-brass', category: 'frame', name: 'Brass ring', description: 'Polished every Tuesday.', price: 3000, rarity: 'common',
    visual: { kind: 'frame', style: 'brass', color: '#d9a441' } },
  { id: 'frame-chip', category: 'frame', name: 'Clay chip', description: 'Your face on a 500 chip.', price: 5000, rarity: 'rare',
    visual: { kind: 'frame', style: 'chip', color: '#c8272d' } },
  { id: 'frame-cheese', category: 'frame', name: 'Cheese wheel', description: 'Aged 24 months.', price: 9000, rarity: 'rare',
    visual: { kind: 'frame', style: 'cheese', color: '#f2c14e' } },
  { id: 'frame-crown', category: 'frame', name: 'Crown', description: 'For the king of the back room.', price: 15000, rarity: 'epic', minLevel: 5,
    visual: { kind: 'frame', style: 'crown', color: '#e3b347' } },
  { id: 'frame-flames', category: 'frame', name: 'On a heater', description: 'Running hot. Everyone can tell.', price: 25000, rarity: 'legendary', minLevel: 8,
    visual: { kind: 'frame', style: 'flames', color: '#ff7a2f' } },

  // Titles shown on profile cards and at your seat.
  { id: 'title-none', category: 'title', name: 'No title', description: 'Keep them guessing.', price: 0, rarity: 'common',
    visual: { kind: 'title', text: '' } },
  { id: 'title-nit', category: 'title', name: 'Nit', description: 'Folds everything but aces. Proudly.', price: 1000, rarity: 'common',
    visual: { kind: 'title', text: 'Nit' } },
  { id: 'title-cheese', category: 'title', name: 'Cheese hoarder', description: 'Never lets go of a pot.', price: 3000, rarity: 'common',
    visual: { kind: 'title', text: 'Cheese hoarder' } },
  { id: 'title-shark', category: 'title', name: 'Card shark', description: 'Smells blood in the water.', price: 5000, rarity: 'rare',
    visual: { kind: 'title', text: 'Card shark' } },
  { id: 'title-bluff', category: 'title', name: 'Bluff merchant', description: 'Selling air since day one.', price: 5000, rarity: 'rare',
    visual: { kind: 'title', text: 'Bluff merchant' } },
  { id: 'title-sewer-king', category: 'title', name: 'Sewer king', description: 'Rules the tunnels beneath the table.', price: 12000, rarity: 'epic',
    visual: { kind: 'title', text: 'Sewer king' } },
  { id: 'title-house', category: 'title', name: 'The house', description: 'The house always wins.', price: 50000, rarity: 'legendary', minLevel: 10,
    visual: { kind: 'title', text: 'The house' } },

  // Win celebrations.
  { id: 'cele-confetti', category: 'celebration', name: 'Brass confetti', description: 'A modest shower of gold.', price: 0, rarity: 'common',
    visual: { kind: 'celebration', style: 'confetti', colors: ['#d9a441', '#f3e6c8', '#c8272d'] } },
  { id: 'cele-cheese', category: 'celebration', name: 'Cheese rain', description: 'Wedges fall from the ceiling.', price: 8000, rarity: 'rare',
    visual: { kind: 'celebration', style: 'cheese', colors: ['#f2c14e', '#e0a92a'] } },
  { id: 'cele-fireworks', category: 'celebration', name: 'Fireworks', description: 'Loud. Bright. Smug.', price: 12000, rarity: 'epic',
    visual: { kind: 'celebration', style: 'fireworks', colors: ['#ff5d5d', '#ffd166', '#7bdff2', '#b388ff'] } },
  { id: 'cele-money', category: 'celebration', name: 'Make it rain', description: 'Banknotes everywhere.', price: 20000, rarity: 'legendary', minLevel: 6,
    visual: { kind: 'celebration', style: 'money', colors: ['#5fa35a', '#3e7a3a'] } },

  // Emote packs — every emote in an owned pack can be sent at the table.
  { id: 'emotes-basic', category: 'emote-pack', name: 'House emotes', description: 'The basics.', price: 0, rarity: 'common',
    visual: { kind: 'emote-pack', emotes: ['👍', '😂', '😮', '😡', '😭', '🔥'] } },
  { id: 'emotes-rat', category: 'emote-pack', name: 'Rat pack', description: 'Speak fluent rodent.', price: 4000, rarity: 'rare',
    visual: { kind: 'emote-pack', emotes: ['🐀', '🧀', '🗑️', '🤫', '😈', '🕳️'] } },
  { id: 'emotes-table', category: 'emote-pack', name: 'Table talk', description: 'Needle your opponents.', price: 4000, rarity: 'rare',
    visual: { kind: 'emote-pack', emotes: ['🃏', '💰', '🫡', '🥶', '🤡', '🍀'] } },
  { id: 'emotes-classy', category: 'emote-pack', name: 'High society', description: 'Monocle not included.', price: 6000, rarity: 'epic',
    visual: { kind: 'emote-pack', emotes: ['🎩', '🍷', '🧐', '🤌', '👑', '💅'] } },

  // Throwables — consumables you lob at another player's seat.
  { id: 'throw-tomato', category: 'throwable', name: 'Tomatoes', description: 'Five ripe ones.', price: 500, rarity: 'common', quantity: 5,
    visual: { kind: 'throwable', glyph: '🍅', splat: '#d6342b' } },
  { id: 'throw-cheese', category: 'throwable', name: 'Cheese wedges', description: 'Five wedges. A peace offering, or not.', price: 750, rarity: 'common', quantity: 5,
    visual: { kind: 'throwable', glyph: '🧀', splat: '#f2c14e' } },
  { id: 'throw-snowball', category: 'throwable', name: 'Snowballs', description: 'Five. For ice-cold folds.', price: 750, rarity: 'common', quantity: 5,
    visual: { kind: 'throwable', glyph: '❄️', splat: '#dff3ff' } },
  { id: 'throw-rose', category: 'throwable', name: 'Roses', description: 'Five. For a hero call.', price: 1000, rarity: 'rare', quantity: 5,
    visual: { kind: 'throwable', glyph: '🌹', splat: '#e0445c' } },
  { id: 'throw-beer', category: 'throwable', name: 'Rounds of beer', description: 'Five rounds on you.', price: 1000, rarity: 'rare', quantity: 5,
    visual: { kind: 'throwable', glyph: '🍺', splat: '#f5b83d' } },
];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

export function getItem(id: string): ShopItem | undefined {
  return BY_ID.get(id);
}

export function isFree(id: string): boolean {
  return BY_ID.get(id)?.price === 0;
}

/** Loadout slots: one equipped item per permanent cosmetic category. */
export type LoadoutSlot = 'felt' | 'card-back' | 'frame' | 'title' | 'celebration';
export const LOADOUT_SLOTS: readonly LoadoutSlot[] = ['felt', 'card-back', 'frame', 'title', 'celebration'];

export type Loadout = Record<LoadoutSlot, string>;

export const DEFAULT_LOADOUT: Loadout = {
  felt: 'felt-classic',
  'card-back': 'back-classic',
  frame: 'frame-none',
  title: 'title-none',
  celebration: 'cele-confetti',
};

/** The cosmetics other players see on you. */
export interface Cosmetics {
  frame: string;
  cardBack: string;
  /** Title text, or null for none. */
  title: string | null;
  celebration: string;
}

/** An equippable title: bought in the shop (`title-*`) or earned from an achievement (`ach:*`). */
export interface TitleInfo {
  id: string;
  /** Display text ('' for "No title"). */
  text: string;
  source: 'shop' | 'achievement';
  /** Achievement titles: which achievement and tier unlock it. */
  achievementId?: string;
  tier?: number;
}

/** Resolve a title id of either kind; undefined for unknown ids and non-title items. */
export function getTitle(id: string): TitleInfo | undefined {
  const item = BY_ID.get(id);
  if (item) return item.visual.kind === 'title' ? { id, text: item.visual.text, source: 'shop' } : undefined;
  const earned = getAchievementTitle(id);
  if (earned) return { id, text: earned.text, source: 'achievement', achievementId: earned.achievementId, tier: earned.tier };
  return undefined;
}

export function cosmeticsFor(loadout: Loadout): Cosmetics {
  const text = getTitle(loadout.title)?.text ?? '';
  return {
    frame: loadout.frame,
    cardBack: loadout['card-back'],
    title: text || null,
    celebration: loadout.celebration,
  };
}

export const DEFAULT_COSMETICS: Cosmetics = cosmeticsFor(DEFAULT_LOADOUT);

/** Emotes available to a player owning the given items (free packs always). */
export function emotesFor(owned: Record<string, number>): string[] {
  const out: string[] = [];
  for (const item of CATALOG) {
    if (item.visual.kind !== 'emote-pack') continue;
    if (item.price === 0 || (owned[item.id] ?? 0) > 0) out.push(...item.visual.emotes);
  }
  return out;
}

export function isPermanent(item: ShopItem): boolean {
  return item.quantity === undefined;
}

/** Permanent items that cost chips: the most a player can own (the collector's ceiling). */
export function permanentPaidItemCount(): number {
  return CATALOG.filter((i) => isPermanent(i) && i.price > 0).length;
}
