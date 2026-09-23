import { EmptyState } from '../../ui';

/** Placeholder — replaced in wave 2. */
export function StatsScreen() {
  return (
    <section aria-labelledby="stats-heading" className="p-4 sm:p-6">
      <h1 id="stats-heading" className="text-2xl">Your stats</h1>
      <EmptyState title="Coming up" body="Your hands, win rate and profit curve will live here." />
    </section>
  );
}
