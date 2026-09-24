import { formatSigned } from '@poker/shared';

export interface FormTallyProps {
  /** Net result per hand, oldest first. */
  results: number[];
  className?: string;
}

/** Plain-language summary of a run of results, e.g. "7 won, 12 lost, 1 even". */
export function formSummary(results: number[]): { up: number; down: number; even: number; net: number } {
  let up = 0;
  let down = 0;
  let even = 0;
  let net = 0;
  for (const r of results) {
    net += r;
    if (r > 0) up++;
    else if (r < 0) down++;
    else even++;
  }
  return { up, down, even, net };
}

/**
 * Recent form as a row of tally marks on card stock: wins rise above the line,
 * losses drop below it (direction carries the sign, colour repeats it), and
 * the height is the size of the result. Each mark has a native tooltip.
 */
export function FormTally({ results, className }: FormTallyProps) {
  const slots = 20;
  const max = Math.max(1, ...results.map((r) => Math.abs(r)));
  const w = 10;
  const mid = 20;
  const s = formSummary(results);
  const label = `Last ${results.length} ${results.length === 1 ? 'hand' : 'hands'}: ${s.up} won, ${s.down} lost${s.even ? `, ${s.even} even` : ''}. Net ${formatSigned(s.net)} chips.`;
  return (
    <svg
      viewBox={`0 0 ${slots * w} 40`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={label}
    >
      <line x1="0" x2={slots * w} y1={mid} y2={mid} className="stroke-ink/25" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {results.map((r, i) => {
        const x = i * w + 1.5;
        const h = r === 0 ? 0 : Math.max(2.5, (Math.abs(r) / max) * (mid - 2));
        return (
          <g key={i}>
            <title>{`Hand ${i + 1} of ${results.length}: ${formatSigned(r)}`}</title>
            {/* Transparent hit area, taller than the mark. */}
            <rect x={i * w} y="0" width={w} height="40" fill="transparent" />
            {r === 0 ? (
              <rect x={x} y={mid - 1} width={w - 3} height="2" className="fill-ink/35" />
            ) : r > 0 ? (
              <rect x={x} y={mid - h - 0.5} width={w - 3} height={h} rx="1.4" className="fill-baize-light" />
            ) : (
              <rect x={x} y={mid + 0.5} width={w - 3} height={h} rx="1.4" className="fill-chip" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
