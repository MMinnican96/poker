import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ProfileCardModal } from '../features/profile/ProfileCardModal';

/** Top-level sections of the app. `table` is the lobby home (or the table screen while you're at it). */
export type Section = 'table' | 'leaderboard' | 'stats' | 'challenges' | 'shop' | 'messages';

export interface Nav {
  section: Section;
  go(section: Section): void;
  /** Jump to Messages, optionally straight into a DM with `partnerId`. */
  openMessages(partnerId?: string): void;
  /** Partner requested by the last `openMessages` call (MessagesScreen's `initialPartnerId`). */
  messagesPartner: string | undefined;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ children, initial = 'table' }: { children: ReactNode; initial?: Section }) {
  const [section, setSection] = useState<Section>(initial);
  const [messagesPartner, setPartner] = useState<string | undefined>();
  const go = useCallback((s: Section) => {
    setSection(s);
    if (s !== 'messages') setPartner(undefined);
  }, []);
  const openMessages = useCallback((partnerId?: string) => {
    setPartner(partnerId);
    setSection('messages');
  }, []);
  const value = useMemo(() => ({ section, go, openMessages, messagesPartner }), [section, go, openMessages, messagesPartner]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/** Navigate between sections from anywhere. */
export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav must be used inside <NavProvider>');
  return n;
}

interface ProfileCardApi {
  /** Open a player's profile card over the current screen. */
  open(playerId: string): void;
  close(): void;
}

const ProfileContext = createContext<ProfileCardApi | null>(null);

/** Hosts the single ProfileCardModal; any component can open it with `useProfileCard().open(id)`. */
export function ProfileCardProvider({ children }: { children: ReactNode }) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const close = useCallback(() => setPlayerId(null), []);
  const value = useMemo(() => ({ open: (id: string) => setPlayerId(id), close }), [close]);
  return (
    <ProfileContext.Provider value={value}>
      {children}
      {playerId && <ProfileCardModal key={playerId} playerId={playerId} onClose={close} />}
    </ProfileContext.Provider>
  );
}

export function useProfileCard(): ProfileCardApi {
  const p = useContext(ProfileContext);
  if (!p) throw new Error('useProfileCard must be used inside <ProfileCardProvider>');
  return p;
}
