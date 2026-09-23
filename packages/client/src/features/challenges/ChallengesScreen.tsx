import { EmptyState } from '../../ui';

/** Placeholder — replaced in wave 2. */
export function ChallengesScreen() {
  return (
    <section aria-labelledby="challenges-heading" className="p-4 sm:p-6">
      <h1 id="challenges-heading" className="text-2xl">Challenges</h1>
      <EmptyState title="Coming up" body="Daily and weekly challenges will show up here." />
    </section>
  );
}
