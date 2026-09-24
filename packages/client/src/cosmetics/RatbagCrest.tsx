import { useId } from 'react';

export interface RatbagCrestProps {
  /** Ink colour of the print (defaults to currentColor). */
  color?: string;
  /** Include the "Ratbag / Poker night" ring lettering. */
  lettering?: boolean;
  className?: string;
  title?: string;
}

/**
 * The Ratbag crest as a single-colour print: a clay-chip ring with edge spots
 * and a rat in profile. Used printed on the felt, on card backs and as the
 * favicon. Negative space is masked, so it prints on any background.
 */
export function RatbagCrest({ color = 'currentColor', lettering = true, className, title }: RatbagCrestProps) {
  const id = useId().replace(/:/g, '');
  const top = `crest-top-${id}`;
  const bottom = `crest-bottom-${id}`;
  const mask = `crest-mask-${id}`;
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <path id={top} d="M38 100a62 62 0 0 1 124 0" />
        <path id={bottom} d="M30 100a70 70 0 0 0 140 0" />
        <mask id={mask}>
          <rect width="200" height="200" fill="#fff" />
          {/* eye, inner ear, mouth line */}
          <circle cx="121" cy="93" r="4.2" fill="#000" />
          <ellipse cx="86" cy="74" rx="8" ry="9.5" fill="#000" />
          <path d="M132 114c6 1.5 12 1 17-1.5" stroke="#000" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        </mask>
      </defs>
      {/* chip edge: heavy ring with spots, then a fine inner line */}
      <circle cx="100" cy="100" r="93" fill="none" stroke={color} strokeWidth="9" strokeDasharray="17 12.2" />
      <circle cx="100" cy="100" r="84" fill="none" stroke={color} strokeWidth="2" />
      <circle cx="100" cy="100" r={lettering ? 52 : 70} fill="none" stroke={color} strokeWidth="1.6" strokeDasharray="5 5" />
      {lettering && (
        <g fill={color} fontFamily="Alfa Slab One, Georgia, serif" textAnchor="middle">
          <text fontSize="21" letterSpacing="3">
            <textPath href={`#${top}`} startOffset="50%">RATBAG</textPath>
          </text>
          <text fontSize="14.5" letterSpacing="2.2" dominantBaseline="hanging">
            <textPath href={`#${bottom}`} startOffset="50%">POKER NIGHT</textPath>
          </text>
        </g>
      )}
      {/* the rat: ear, head with snout, nose, whiskers */}
      <g mask={`url(#${mask})`} fill={color} transform={lettering ? 'translate(100 100) scale(0.72) translate(-104 -100)' : undefined}>
        <circle cx="86" cy="74" r="16" />
        <path d="M66 108c0-22 17-35 38-33 16 1.5 30 12 44 25 5 4.5 3.5 10.5-3 12-16 4-32 9-50 10-17 1-29-2-29-14Z" />
        <path d="M70 116c-14 6-22 18-15 27 6 8 19 5 26 11" fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round" />
      </g>
      <g stroke={color} strokeWidth="1.8" strokeLinecap="round" transform={lettering ? 'translate(100 100) scale(0.72) translate(-104 -100)' : undefined}>
        <circle cx="151" cy="104" r="5" fill={color} stroke="none" />
        <path d="M141 106l24-9M142 109l25-1M141 112l22 8" fill="none" />
      </g>
    </svg>
  );
}
