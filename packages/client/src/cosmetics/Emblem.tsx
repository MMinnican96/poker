import { useId } from 'react';
import {
  RARITY_COLOURS,
  RARITY_NAME,
  RARITY_ORDER,
  TIER_INFO,
  achievementLabel,
  emblemColours,
  getAchievement,
  tierInfo,
  type AchievementDef,
  type MetalColours,
} from '@poker/shared';
import { cx } from '../ui/cx';
import { EMBLEM_GLYPHS } from './emblemGlyphs';

export interface EmblemProps {
  /** Achievement id from the shared catalog. Unknown ids render nothing. */
  achievementId: string;
  /** Tier reached: 1..5 for career challenges, 1 for feats, 0 = locked. */
  tier: number;
  /** Rendered size in px (24 to 112 read well). */
  size?: number;
  /** Hide from assistive tech when the name is written next to it. */
  decorative?: boolean;
  className?: string;
}

/**
 * Spoken name of an emblem: "Grinder III, gold", "Royalty, legendary feat",
 * "Grinder, locked", "Secret feat, locked".
 */
export function emblemName(def: AchievementDef, tier: number): string {
  if (tier < 1) return def.kind === 'feat' && def.secret ? 'Secret feat, locked' : `${def.name}, locked`;
  if (def.kind === 'feat') return `${def.name}, ${RARITY_NAME[def.rarity].toLowerCase()} feat`;
  return `${achievementLabel(def, tier)}, ${tierInfo(tier).name.toLowerCase()}`;
}

/** Shield outline for feats, in the 100×100 box. */
const SHIELD = 'M50 4 L87 13 V45 C87 69 71 85 50 96 C29 85 13 69 13 45 V13 Z';
/** Five tier pips along the lower rim of a medallion (degrees; 90 = bottom). */
const PIP_ANGLES = [130, 110, 90, 70, 50];

/**
 * An achievement's emblem as SVG. Career challenges are round medallions struck
 * in the tier's metal (bronze .. diamond) with tier pips on the rim; feats are
 * crests in their rarity colour with a ribbon (legendary ones catch the light
 * when they appear and on hover or focus).
 * Locked emblems are a dark walnut silhouette with a faint glyph, and secret
 * feats show "?" until unlocked. Metal and rarity colours come from the shared
 * catalog (`TIER_INFO`, `RARITY_COLOURS`).
 */
export function Emblem({ achievementId, tier, size = 48, decorative, className }: EmblemProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const def = getAchievement(achievementId);
  if (!def) return null;
  const locked = tier < 1;
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': emblemName(def, tier) };
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cx('group/emblem shrink-0 overflow-visible', className)}
      data-emblem={def.id}
      data-tier={Math.max(0, tier)}
      {...a11y}
    >
      {def.kind === 'career' ? (
        <Medallion def={def} tier={tier} locked={locked} uid={uid} />
      ) : (
        <Crest def={def} locked={locked} uid={uid} />
      )}
    </svg>
  );
}

function Glyph({ def, cx: x, cy: y, size, fill, className, secret }: {
  def: AchievementDef; cx: number; cy: number; size: number; fill?: string; className?: string; secret?: boolean;
}) {
  if (secret) {
    return (
      <text x={x} y={y + size * 0.36} textAnchor="middle" fontSize={size} className={cx('font-display', className)} fill={fill}>
        ?
      </text>
    );
  }
  const Icon = EMBLEM_GLYPHS[def.glyph];
  return <Icon x={x - size / 2} y={y - size / 2} size={size} fill={fill} stroke="none" className={className} aria-hidden="true" focusable="false" />;
}

/** Diagonal metal: highlight top-left to shadow bottom-right. */
function MetalGradient({ id, c, reverse }: { id: string; c: MetalColours; reverse?: boolean }) {
  const stops = [c.light, c.base, c.dark];
  if (reverse) stops.reverse();
  return (
    <linearGradient id={id} x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stopColor={stops[0]} />
      <stop offset="0.5" stopColor={stops[1]} />
      <stop offset="1" stopColor={stops[2]} />
    </linearGradient>
  );
}

/** A soft pool of the metal's highlight, for the recessed field. */
function FieldGlow({ id, c }: { id: string; c: MetalColours }) {
  return (
    <radialGradient id={id} cx="0.5" cy="0.35" r="0.65">
      <stop offset="0" stopColor={c.light} stopOpacity="0.32" />
      <stop offset="1" stopColor={c.light} stopOpacity="0" />
    </radialGradient>
  );
}

/** Glyph relief: bright at the top, the body metal at the foot. */
function GlyphGradient({ id, c }: { id: string; c: MetalColours }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={c.light} />
      <stop offset="1" stopColor={c.base} />
    </linearGradient>
  );
}

// Colours for the diamond's prismatic sheen, borrowed from the catalog's own palette.
const PRISM = [RARITY_COLOURS.epic.light, TIER_INFO[3].colours.light, TIER_INFO[5].colours.light, RARITY_COLOURS.rare.light, RARITY_COLOURS.epic.light];

const RING = 'M50 4a46 46 0 1 0 0.01 0Z M50 15a35 35 0 1 1 -0.01 0Z';

function Medallion({ def, tier, locked, uid }: { def: AchievementDef; tier: number; locked: boolean; uid: string }) {
  const c = emblemColours(def, Math.max(1, tier));
  const id = (s: string) => `${uid}-${s}`;
  const pips = PIP_ANGLES.map((deg, i) => {
    const r = (deg * Math.PI) / 180;
    return { x: 50 + 40.5 * Math.cos(r), y: 50 + 40.5 * Math.sin(r), on: i < tier };
  });

  if (locked) {
    return (
      <g>
        <circle cx="50" cy="52" r="46" className="fill-walnut-950" />
        <circle cx="50" cy="50" r="46" className="fill-walnut-800 stroke-walnut-600" strokeWidth="1.5" />
        <circle cx="50" cy="50" r="33" className="fill-walnut-900 stroke-walnut-950" strokeWidth="2" />
        {pips.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.4" className="fill-walnut-950" />)}
        <Glyph def={def} cx={50} cy={50} size={40} className="fill-walnut-600" />
      </g>
    );
  }

  const diamond = tier >= 5;
  return (
    <g>
      <defs>
        <MetalGradient id={id('metal')} c={c} />
        <MetalGradient id={id('bevel')} c={c} reverse />
        <FieldGlow id={id('glow')} c={c} />
        <GlyphGradient id={id('glyph')} c={c} />
        {diamond && (
          <linearGradient id={id('prism')} x1="0" y1="0" x2="1" y2="1">
            {PRISM.map((colour, i) => <stop key={i} offset={i / (PRISM.length - 1)} stopColor={colour} />)}
          </linearGradient>
        )}
      </defs>
      {/* The coin's edge, then the rim, knurling, a bevel into the field. */}
      <circle cx="50" cy="52.5" r="46" fill={c.dark} />
      <circle cx="50" cy="50" r="46" fill={`url(#${id('metal')})`} />
      {diamond && <path d={RING} fillRule="evenodd" fill={`url(#${id('prism')})`} opacity="0.5" style={{ mixBlendMode: 'screen' }} />}
      <circle cx="50" cy="50" r="44" fill="none" stroke={c.dark} strokeOpacity="0.45" strokeWidth="1.4" strokeDasharray="1.1 1.9" />
      <circle cx="50" cy="50" r="35" fill={`url(#${id('bevel')})`} />
      <circle cx="50" cy="50" r="32" fill={c.dark} />
      {/* Deepen the field so light glyphs stand out on the paler metals. */}
      <circle cx="50" cy="50" r="32" className="fill-walnut-950" opacity="0.38" />
      <circle cx="50" cy="50" r="32" fill={`url(#${id('glow')})`} />
      {/* Platinum and diamond: an engraved inner line and a star at the crown of the rim. */}
      {tier >= 4 && (
        <>
          <circle cx="50" cy="50" r="29" fill="none" stroke={c.light} strokeOpacity="0.45" strokeWidth="0.9" />
          <g fill={c.light} stroke={c.dark} strokeWidth="0.6"><Sparkle x={50} y={9.5} r={4.2} /></g>
        </>
      )}
      {pips.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="2.6"
          fill={p.on ? c.light : c.dark}
          fillOpacity={p.on ? 1 : 0.55}
          stroke={c.dark}
          strokeWidth="0.8"
        />
      ))}
      {/* Struck relief: a dark drop under a bright glyph. */}
      <Glyph def={def} cx={50} cy={51.6} size={40} className="fill-walnut-950/60" />
      <Glyph def={def} cx={50} cy={50} size={40} fill={`url(#${id('glyph')})`} />
      {diamond && (
        <g fill={c.light}>
          <Sparkle x={79} y={20} r={6} />
          <Sparkle x={20} y={74} r={4} />
        </g>
      )}
    </g>
  );
}

/** A four-point glint. */
function Sparkle({ x, y, r }: { x: number; y: number; r: number }) {
  const k = r * 0.22;
  return <path d={`M${x} ${y - r} L${x + k} ${y - k} L${x + r} ${y} L${x + k} ${y + k} L${x} ${y + r} L${x - k} ${y + k} L${x - r} ${y} L${x - k} ${y - k} Z`} />;
}

/** The legendary glint: once on mount, again while the emblem is hovered or inside a focused control. */
const SHINE =
  'motion-safe:animate-emblem-shine motion-safe:group-hover/emblem:animate-emblem-shine-again motion-safe:in-focus-visible:animate-emblem-shine-again';

const RIBBON_BAND = 'M17 70 Q50 63 83 70 L83 83 Q50 76 17 83 Z';
const RIBBON_TAILS = ['M22 73 L3 75 L9 81 L4 88 L24 85 Z', 'M78 73 L97 75 L91 81 L96 88 L76 85 Z'];

function Crest({ def, locked, uid }: { def: Extract<AchievementDef, { kind: 'feat' }>; locked: boolean; uid: string }) {
  const c = RARITY_COLOURS[def.rarity];
  const id = (s: string) => `${uid}-${s}`;
  const marks = RARITY_ORDER.indexOf(def.rarity) + 1;
  const markXs = Array.from({ length: marks }, (_, i) => 50 + (i - (marks - 1) / 2) * 7);
  const inner = 'translate(50 44) scale(0.8) translate(-50 -44)';

  if (locked) {
    return (
      <g>
        <path d={SHIELD} transform="translate(0 2.5)" className="fill-walnut-950" />
        <path d={SHIELD} className="fill-walnut-800 stroke-walnut-600" strokeWidth="1.5" />
        <path d={SHIELD} transform={inner} className="fill-walnut-900 stroke-walnut-950" strokeWidth="2" />
        <Glyph def={def} cx={50} cy={42} size={38} secret={def.secret} className={def.secret ? 'fill-walnut-500' : 'fill-walnut-600'} />
        {RIBBON_TAILS.map((d) => <path key={d} d={d} className="fill-walnut-950" />)}
        <path d={RIBBON_BAND} className="fill-walnut-700 stroke-walnut-950" strokeWidth="0.8" />
      </g>
    );
  }

  const legendary = def.rarity === 'legendary';
  return (
    <g>
      <defs>
        <MetalGradient id={id('metal')} c={c} />
        <FieldGlow id={id('glow')} c={c} />
        <GlyphGradient id={id('glyph')} c={c} />
        <linearGradient id={id('band')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.base} />
          <stop offset="1" stopColor={c.dark} />
        </linearGradient>
        {legendary && (
          <clipPath id={id('clip')}>
            <path d={SHIELD} />
          </clipPath>
        )}
      </defs>
      <path d={SHIELD} transform="translate(0 2.5)" fill={c.dark} />
      <path d={SHIELD} fill={`url(#${id('metal')})`} />
      <path d={SHIELD} transform={inner} fill={c.dark} stroke={c.light} strokeOpacity="0.55" strokeWidth="1.6" />
      <path d={SHIELD} transform={inner} className="fill-walnut-950" opacity="0.3" />
      <path d={SHIELD} transform={inner} fill={`url(#${id('glow')})`} />
      <Glyph def={def} cx={50} cy={43.6} size={38} className="fill-walnut-950/60" />
      <Glyph def={def} cx={50} cy={42} size={38} fill={`url(#${id('glyph')})`} />
      {legendary && (
        <g clipPath={`url(#${id('clip')})`} aria-hidden="true">
          <rect x="-36" y="-10" width="16" height="120" fill={c.light} opacity="0.5" transform="skewX(-18)" className={SHINE} />
        </g>
      )}
      {RIBBON_TAILS.map((d) => <path key={d} d={d} fill={c.dark} stroke={c.dark} strokeWidth="0.8" />)}
      <path d={RIBBON_BAND} fill={`url(#${id('band')})`} stroke={c.dark} strokeWidth="0.8" />
      <path d="M19 72.2 Q50 65.4 81 72.2" fill="none" stroke={c.light} strokeOpacity="0.6" strokeWidth="0.9" />
      {markXs.map((x) => (
        <path key={x} d={`M${x} 70.4 l2.4 2.6 l-2.4 2.6 l-2.4 -2.6 Z`} fill={c.light} />
      ))}
    </g>
  );
}
