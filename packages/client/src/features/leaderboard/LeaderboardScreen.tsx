import { EmptyState } from '../../ui';

/** Placeholder — replaced in wave 2. */
export function LeaderboardScreen() {
  return (
    <section aria-labelledby="leaderboard-heading" className="p-4 sm:p-6">
      <h1 id="leaderboard-heading" className="text-2xl">Leaderboard</h1>
      <EmptyState title="Coming up" body="Rankings for the whole club will hang here." />
    </section>
  );
}
