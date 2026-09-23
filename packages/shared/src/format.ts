/** 12,345 */
export function formatChips(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 12.3k / 1.2M — for tight spaces. Exact below 10,000. */
export function formatChipsShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 10_000) return sign + formatChips(abs);
  if (abs < 1_000_000) return `${sign}${trim(abs / 1000)}k`;
  return `${sign}${trim(abs / 1_000_000)}M`;
}

/** +1,200 / -300 / 0 */
export function formatSigned(n: number): string {
  if (n > 0) return `+${formatChips(n)}`;
  if (n < 0) return `-${formatChips(-n)}`;
  return '0';
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** "3h 20m" / "45m" */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function trim(n: number): string {
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, '');
}
