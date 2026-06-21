export interface StatTileProps {
  label: string;
  value: string | null;
  accent?: string;
}

export function StatTile({ label, value, accent }: StatTileProps) {
  return (
    <div className="rounded-2xl border-2 border-black/30 bg-felt-600 p-4">
      <div
        className="font-display text-2xl font-bold text-cream"
        style={accent ? { color: accent } : undefined}
      >
        {value ?? '—'}
      </div>
      <div className="mt-1 text-[11px] font-extrabold tracking-[0.08em] text-sage">{label}</div>
    </div>
  );
}
