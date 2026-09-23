import { useCallback, useEffect, useRef, useState } from 'react';
import { BootErrorScreen, ConnectingScreen, ExpiredScreen } from './app/Boot';
import { ClientProvider, createClient, useAppState, useStore, useTable, type Client } from './app/client';
import { NavProvider, ProfileCardProvider, useNav } from './app/nav';
import { startSession } from './app/session';
import { Toaster } from './app/Toaster';
import { Shell } from './lobby/Shell';
import { TableScreen } from './table/TableScreen';

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
  const leftReason = useAppState((s) => s.tableLeftReason);
  const nav = useNav();
  const store = useStore();
  const atTable = table !== null;
  const wasAtTable = useRef(atTable);

  useEffect(() => {
    if (atTable && !wasAtTable.current) nav.go('table');
    if (!atTable && wasAtTable.current && leftReason && leftReason !== 'You left the table.') {
      store.notify({ tone: 'info', title: leftReason });
    }
    wasAtTable.current = atTable;
  }, [atTable, leftReason, nav, store]);

  if (connection === 'unauthorized') return <ExpiredScreen />;
  if (atTable && nav.section === 'table') return <TableScreen />;
  return <Shell />;
}
