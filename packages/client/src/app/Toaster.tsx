import { Component, Suspense, type ReactNode } from 'react';
import type { Notice } from '@poker/shared';
import { ToastStack } from '../ui';
import { useNotices, useStore } from './client';
import { lazyNamed } from './lazy';

// Emblems carry their icon set, so they load on the first unlock toast rather than with the app.
const Emblem = lazyNamed(() => import('../cosmetics/Emblem'), 'Emblem');

/**
 * Keeps a failed emblem load (a redeploy changed the chunk hashes, a flaky
 * network) inside the toast: the toast shows without its art instead of the
 * error reaching the app's root boundary mid-hand.
 */
export class ArtBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** An unlock notice's emblem, next to its text (the title already names it). */
function noticeArt(n: Notice) {
  if (!n.emblem) return null;
  return (
    <ArtBoundary>
      <Suspense fallback={<span className="block size-12" />}>
        <Emblem achievementId={n.emblem.achievementId} tier={n.emblem.tier} size={48} decorative />
      </Suspense>
    </ArtBoundary>
  );
}

/** Shows the store's notices (server `notice` events + `store.notify`) as toasts. */
export function Toaster() {
  const notices = useNotices();
  const store = useStore();
  return <ToastStack notices={notices} onDismiss={store.dismissNotice} renderArt={noticeArt} />;
}
