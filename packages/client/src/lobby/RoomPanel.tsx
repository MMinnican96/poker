import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, type ActivityEvent, type ChatMessage, type RoomMember } from '@poker/shared';
import { useActivity, useAppState, useCommands, useLobby, useMe, useRoomChat, useStore } from '../app/client';
import { timeAgo, useNow } from '../app/hooks';
import { useProfileCard } from '../app/nav';
import { TitleTag } from '../cosmetics';
import {
  Avatar,
  ChipAmount,
  EmptyState,
  IconButton,
  LevelBadge,
  PRESENCE_LABEL,
  SendIcon,
  Tabs,
  cx,
  tabPanelProps,
} from '../ui';

export type RoomTab = 'chat' | 'people' | 'activity';

const PRESENCE_ORDER = { playing: 0, watching: 1, lobby: 2 } as const;

/** Who's here, room chat and the activity feed, in tabs. Used as the sidebar and the small-screen drawer. */
export function RoomPanel({ tab, onTab }: { tab: RoomTab; onTab(tab: RoomTab): void }) {
  const lobby = useLobby();
  const count = lobby?.members.length ?? 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-3 pb-2">
        <Tabs
          idBase="room"
          label="Room"
          fill
          value={tab}
          onChange={onTab}
          tabs={[
            { id: 'chat', label: 'Chat' },
            { id: 'people', label: `Here (${count})` },
            { id: 'activity', label: 'Activity' },
          ]}
        />
      </div>
      <div {...tabPanelProps('room', tab)} className="flex min-h-0 flex-1 flex-col outline-none">
        {tab === 'chat' && <RoomChat />}
        {tab === 'people' && <MemberList members={lobby?.members ?? []} />}
        {tab === 'activity' && <ActivityFeed />}
      </div>
    </div>
  );
}

export function MemberList({ members }: { members: RoomMember[] }) {
  const profile = useProfileCard();
  const me = useMe();
  const sorted = [...members].sort((a, b) => PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence] || a.name.localeCompare(b.name));
  if (sorted.length === 0) return <EmptyState compact title="Nobody's here" body="Invite friends into the voice channel." />;
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {sorted.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            onClick={() => profile.open(m.id)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-walnut-700/60"
          >
            <Avatar src={m.avatarUrl} name={m.name} frameId={m.cosmetics.frame} size={38} presence={m.presence} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-semibold text-stock">{m.name}</span>
                {m.id === me.id && <span className="text-[13px] text-muted">(you)</span>}
              </span>
              <span className="flex items-center gap-1.5 text-[13px] text-muted">
                {PRESENCE_LABEL[m.presence]}
                {m.cosmetics.title && <TitleTag title={m.cosmetics.title} className="hidden xs:inline-flex" />}
              </span>
            </span>
            <span className="flex flex-col items-end gap-0.5">
              <LevelBadge level={m.level} size={22} />
              <ChipAmount value={m.balance} short size="sm" className="text-stock-dim" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Messages from the same sender within 3 minutes are grouped under one header. */
function groupStarts(messages: ChatMessage[]): boolean[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    return !prev || prev.senderId !== m.senderId || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > 180_000;
  });
}

export function RoomChat() {
  const messages = useRoomChat();
  const commands = useCommands();
  const profile = useProfileCard();
  const now = useNow();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const starts = groupStarts(messages);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const ack = await commands.sendChat({ room: true }, body);
    setSending(false);
    if (ack.ok) {
      setDraft('');
      stick.current = true;
    } else setError(ack.error);
  };

  const left = CHAT_MAX_LENGTH - draft.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol
        ref={listRef}
        aria-label="Room chat"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3"
      >
        {messages.length === 0 && (
          <li><EmptyState compact title="Quiet in here" body="Say hello to the room. Messages stay for the next session too." /></li>
        )}
        {messages.map((m, i) => (
          <li key={m.id} className={cx('flex gap-2.5', starts[i] ? 'mt-3' : 'mt-0.5')}>
            <span className="w-8 shrink-0">
              {starts[i] && (
                <button type="button" onClick={() => profile.open(m.senderId)} aria-label={`${m.senderName}'s profile`} className="rounded-full">
                  <Avatar src={m.senderAvatar} name={m.senderName} size={32} />
                </button>
              )}
            </span>
            <div className="min-w-0 flex-1">
              {starts[i] && (
                <p className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-bold text-brass-light">{m.senderName}</span>
                  <time className="shrink-0 text-[12px] text-muted" dateTime={m.createdAt}>{timeAgo(m.createdAt, now)}</time>
                </p>
              )}
              <p className="text-[15px] leading-snug break-words whitespace-pre-wrap text-stock">{m.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <form
        className="border-t border-walnut-700 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="flex items-center gap-1.5">
          <input
            className="input h-10 flex-1"
            placeholder="Message the room"
            aria-label="Message the room"
            maxLength={CHAT_MAX_LENGTH}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
          />
          <IconButton type="submit" label="Send" variant="brass" disabled={!draft.trim() || sending}>
            <SendIcon size={18} />
          </IconButton>
        </div>
        {(error || left < 40) && (
          <p className={cx('mt-1 px-1 text-[12px]', error ? 'font-medium text-negative' : 'text-muted')} role={error ? 'alert' : undefined}>
            {error ?? `${left} ${left === 1 ? 'character' : 'characters'} left`}
          </p>
        )}
      </form>
    </div>
  );
}

const KIND_MARK: Record<ActivityEvent['kind'], string> = {
  'big-win': 'bg-brass',
  'rare-hand': 'bg-chip',
  'level-up': 'bg-positive',
  challenge: 'bg-positive',
  achievement: 'bg-brass-light',
  purchase: 'bg-stock-dim',
  table: 'bg-walnut-400',
};

export function ActivityFeed() {
  const events = useActivity();
  const profile = useProfileCard();
  const now = useNow();
  if (events.length === 0) {
    return <EmptyState compact title="Nothing yet" body="Big wins, rare hands, level-ups and feats in this room show up here." />;
  }
  return (
    <ol className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {events.map((e) => (
        <li key={e.id} className="flex gap-2.5 border-b border-walnut-700/70 py-2 last:border-0">
          <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', KIND_MARK[e.kind])} aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm leading-snug text-stock-dim">
            {e.playerName && e.playerId ? (
              <button type="button" className="font-bold text-stock hover:underline" onClick={() => profile.open(e.playerId!)}>
                {e.playerName}
              </button>
            ) : null}
            {e.playerName ? ' ' : ''}
            {e.text}
            <time className="ml-2 text-[12px] whitespace-nowrap text-muted">{timeAgo(e.at, now)}</time>
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * Room messages from others that arrived while the chat wasn't visible. The
 * history sent on join counts as seen; everything after it (including the
 * first message in a room with no history) counts as new.
 */
export function useUnseenRoomMessages(visible: boolean): number {
  const messages = useRoomChat();
  const me = useMe();
  const store = useStore();
  const loaded = useAppState((s) => !!s.chatLoaded[store.roomChannel]);
  const last = messages[messages.length - 1]?.createdAt ?? null;
  // What you've seen: everything up to `at` (null: nothing yet). Unset until the history arrives.
  const [seen, setSeen] = useState<{ at: string | null } | null>(() => (loaded ? { at: last } : null));
  useEffect(() => {
    if ((visible || (!seen && loaded)) && (!seen || seen.at !== last)) setSeen({ at: last });
  }, [visible, loaded, last, seen]);
  if (visible || !seen) return 0;
  return messages.filter((m) => m.senderId !== me.id && (seen.at === null || m.createdAt > seen.at)).length;
}
