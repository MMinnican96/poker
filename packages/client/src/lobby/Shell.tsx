import { useState, type ReactNode } from 'react';
import { useAppState } from '../app/client';
import { useMediaQuery } from '../app/hooks';
import { useNav, type Section } from '../app/nav';
import { ChallengesScreen } from '../features/challenges/ChallengesScreen';
import { LeaderboardScreen } from '../features/leaderboard/LeaderboardScreen';
import { MessagesScreen } from '../features/messages/MessagesScreen';
import { ShopScreen } from '../features/shop/ShopScreen';
import { StatsScreen } from '../features/stats/StatsScreen';
import { CloseIcon, Drawer, IconButton, cx } from '../ui';
import { Header } from './Header';
import { NavBar } from './NavBar';
import { RoomPanel, useUnseenRoomMessages, type RoomTab } from './RoomPanel';
import { TableHome } from './TableHome';

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

  return (
    <div className="flex h-dvh flex-col bg-walnut-900">
      <Header showRoomButton={!wide} onOpenRoom={() => setDrawer(true)} unseenChat={unseen} />
      <StatusStrip />
      <div className="flex min-h-0 flex-1">
        {!phone && <NavBar orientation="rail" />}
        <main className={cx('@container min-w-0 flex-1 overflow-x-hidden overflow-y-auto', nav.section === 'table' && 'lamp-glow')} id="main">
          <SectionView section={nav.section} messagesPartner={nav.messagesPartner} />
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
