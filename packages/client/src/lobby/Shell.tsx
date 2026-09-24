import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useAppState } from '../app/client';
import { useMediaQuery } from '../app/hooks';
import { ErrorBoundary } from '../app/ErrorBoundary';
import { lazyNamed, preloadWhenIdle } from '../app/lazy';
import { useNav, type Section } from '../app/nav';
import { CloseIcon, Drawer, IconButton, Spinner, cx } from '../ui';
import { Header } from './Header';
import { NavBar } from './NavBar';
import { RoomPanel, useUnseenRoomMessages, type RoomTab } from './RoomPanel';
import { TableHome } from './TableHome';

// Feature screens load on first visit (each is its own chunk), and are fetched
// in the background once the lobby has settled.
const LeaderboardScreen = lazyNamed(() => import('../features/leaderboard/LeaderboardScreen'), 'LeaderboardScreen');
const StatsScreen = lazyNamed(() => import('../features/stats/StatsScreen'), 'StatsScreen');
const ChallengesScreen = lazyNamed(() => import('../features/challenges/ChallengesScreen'), 'ChallengesScreen');
const ShopScreen = lazyNamed(() => import('../features/shop/ShopScreen'), 'ShopScreen');
const MessagesScreen = lazyNamed(() => import('../features/messages/MessagesScreen'), 'MessagesScreen');
export const FEATURE_SCREENS = [LeaderboardScreen, StatsScreen, ChallengesScreen, ShopScreen, MessagesScreen] as const;

/** Holds the section's space while its chunk loads, so nothing around it moves. */
function SectionFallback() {
  return (
    <div className="grid h-full min-h-40 place-items-center">
      <Spinner size={28} label="Loading" className="text-brass" />
    </div>
  );
}

/** The screen for each section (the table section shows the lobby home here). */
function SectionView({ section, messagesPartner }: { section: Section; messagesPartner?: string }): ReactNode {
  switch (section) {
    case 'table': return <TableHome />;
    case 'leaderboard': return <LeaderboardScreen />;
    case 'stats': return <StatsScreen />;
    case 'challenges': return <ChallengesScreen />;
    case 'shop': return <ShopScreen />;
    case 'messages': return <MessagesScreen key={messagesPartner ?? ''} initialPartnerId={messagesPartner} />;
  }
}

/** Connection problems, shown as a strip under the header. */
function StatusStrip() {
  const connection = useAppState((s) => s.connection);
  const roomError = useAppState((s) => s.roomError);
  const text =
    connection === 'offline' ? 'Lost the connection. Reconnecting.'
    : connection === 'unauthorized' ? 'Your session expired. Reload the activity to sign in again.'
    : roomError ? `Couldn't join this room: ${roomError}`
    : null;
  if (!text) return null;
  return (
    <p role="status" className="shrink-0 bg-chip-dark px-3 py-1 text-center text-[13px] font-semibold text-stock">
      {text}
    </p>
  );
}

/**
 * The app frame around every non-table screen: header, navigation, the
 * section, and the room sidebar (a drawer below 1024px).
 */
export function Shell() {
  const nav = useNav();
  const wide = useMediaQuery('(min-width: 1024px)');
  const phone = !useMediaQuery('(min-width: 640px)');
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<RoomTab>('chat');
  const chatVisible = tab === 'chat' && (wide || drawer);
  const unseen = useUnseenRoomMessages(chatVisible);
  useEffect(() => preloadWhenIdle(FEATURE_SCREENS), []);

  return (
    <div className="flex h-dvh flex-col bg-walnut-900">
      <Header showRoomButton={!wide} onOpenRoom={() => setDrawer(true)} unseenChat={unseen} />
      <StatusStrip />
      <div className="flex min-h-0 flex-1">
        {!phone && <NavBar orientation="rail" />}
        <main className={cx('@container min-w-0 flex-1 overflow-x-hidden overflow-y-auto', nav.section === 'table' && 'lamp-glow')} id="main">
          {/* Keyed by section, so moving to another section clears a failure. */}
          <ErrorBoundary key={nav.section} layout="section">
            <Suspense fallback={<SectionFallback />}>
              <SectionView section={nav.section} messagesPartner={nav.messagesPartner} />
            </Suspense>
          </ErrorBoundary>
        </main>
        {wide && (
          <aside aria-label="Room" className="flex w-80 shrink-0 flex-col border-l border-walnut-950 bg-walnut-800 tex-wood xl:w-[22rem]">
            <RoomPanel tab={tab} onTab={setTab} />
          </aside>
        )}
      </div>
      {phone && <NavBar orientation="bar" />}
      {!wide && (
        <Drawer open={drawer} onClose={() => setDrawer(false)} label="Room">
          <div className="flex items-center justify-between px-3 pt-2">
            <h2 className="text-lg">Room</h2>
            <IconButton label="Close" size="sm" onClick={() => setDrawer(false)}>
              <CloseIcon size={18} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1">
            <RoomPanel tab={tab} onTab={setTab} />
          </div>
        </Drawer>
      )}
    </div>
  );
}
