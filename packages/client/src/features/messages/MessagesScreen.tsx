import { EmptyState } from '../../ui';

export interface MessagesScreenProps {
  /** Open straight into a DM with this player. */
  initialPartnerId?: string;
}

/** Placeholder — replaced in wave 2. */
export function MessagesScreen({ initialPartnerId }: MessagesScreenProps) {
  return (
    <section aria-labelledby="messages-heading" className="p-4 sm:p-6">
      <h1 id="messages-heading" className="text-2xl">Messages</h1>
      <EmptyState
        title="Coming up"
        body={initialPartnerId ? 'Direct messages open here soon.' : 'Your conversations with other players will live here.'}
      />
    </section>
  );
}
