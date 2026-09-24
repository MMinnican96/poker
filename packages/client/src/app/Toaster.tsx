import { ToastStack } from '../ui';
import { useNotices, useStore } from './client';

/** Shows the store's notices (server `notice` events + `store.notify`) as toasts. */
export function Toaster() {
  const notices = useNotices();
  const store = useStore();
  return <ToastStack notices={notices} onDismiss={store.dismissNotice} />;
}
