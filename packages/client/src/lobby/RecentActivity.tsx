export function RecentActivity() {
  return (
    <aside className="hidden min-w-[236px] flex-[0_1_300px] flex-col overflow-hidden rounded-3xl border-[2.5px] border-black/30 bg-felt-900/55 shadow-panel rail:flex">
      <div className="flex items-center gap-2.5 px-5 pb-3.5 pt-[18px]">
        <span className="font-display text-lg font-semibold text-white">Recent Activity</span>
        <span className="mt-0.5 h-2 w-2 rounded-pill bg-mint" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-6 text-center">
        <p className="text-sm font-bold text-sage-muted">No recent activity yet.</p>
        <p className="mt-1 text-xs font-semibold text-sage">
          Hands, joins, and chip moves will show up here.
        </p>
      </div>
    </aside>
  );
}
