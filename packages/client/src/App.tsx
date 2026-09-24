import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BootErrorScreen, ConnectingScreen, ExpiredScreen } from './app/Boot';
import { ClientProvider, createClient, useAppState, useStore, useTable, type Client } from './app/client';
import { lazyNamed, preloadWhenIdle } from './app/lazy';
import { NavProvider, ProfileCardProvider, useNav } from './app/nav';
import { startSession } from './app/session';
import { Toaster } from './app/Toaster';
import { Shell } from './lobby/Shell';
import { Spinner } from './ui';

/** The table screen is its own chunk, fetched in the background after sign-in. */
const TableScreen = lazyNamed(() => import('./table/TableScreen'), 'TableScreen');

/** Fills the screen the table will take while its chunk loads. */
function TableFallback() {
  return (
    <div className="grid h-dvh place-items-center bg-walnut-900 tex-wood">
      <Spinner size={32} label="Loading the table" className="text-brass" />
    </div>
  );
}

type Boot = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; client: Client };

/** Signs in, connects, and hands a ready client to the app. */
export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let client: Client | null = null;
    startSession()
      .then((session) => {
        if (cancelled) return;
        client = createClient(session);
        setBoot({ status: 'ready', client });
      })
      .catch((error: unknown) => {
        if (!cancelled) setBoot({ status: 'error', error });
      });
    return () => {
      cancelled = true;
      client?.dispose();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setBoot({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  if (boot.status === 'loading') return <ConnectingScreen />;
  if (boot.status === 'error') return <BootErrorScreen error={boot.error} onRetry={retry} />;
  return (
    <ClientProvider client={boot.client}>
      <NavProvider>
        <ProfileCardProvider>
          <Main />
          <Toaster />
        </ProfileCardProvider>
      </NavProvider>
    </ClientProvider>
  );
}

/**
 * Routing: while you're a table member and on the table section, the table
 * screen takes over; everything else lives in the shell.
 */
export function Main() {
  const table = useTable();
  const connection = useAppState((s) => s.connection);
  const left = useAppState((s) => s.tableLeft);
  const nav = useNav();
  const store = useStore();
  const atTable = table !== null;
  const wasAtTable = useRef(atTable);

  useEffect(() => preloadWhenIdle([TableScreen], 500), []);

  useEffect(() => {
    if (atTable && !wasAtTable.current) nav.go('table');
    // Leaving yourself needs no toast; closures, removals and restarts do.
    if (!atTable && wasAtTable.current && left && left.code !== 'left' && left.reason) {
      store.notify({ tone: 'info', title: left.reason });
    }
    wasAtTable.current = atTable;
  }, [atTable, left, nav, store]);

  if (connection === 'unauthorized') return <ExpiredScreen />;
  if (atTable && nav.section === 'table') {
    return (
      <Suspense fallback={<TableFallback />}>
        <TableScreen />
      </Suspense>
    );
  }
  return <Shell />;
}
