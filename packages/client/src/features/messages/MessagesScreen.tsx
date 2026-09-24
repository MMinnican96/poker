import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CHAT_MAX_LENGTH,
  dmChannel,
  dmPartner,
  type ChatMessage,
  type Conversation,
} from '@poker/shared';
import { useApi, useAppState, useChannel, useCommands, useLobby, useMe, useStore } from '../../app/client';
import { timeAgo, useElementWidth, useNow } from '../../app/hooks';
import { useProfileCard } from '../../app/nav';
import {
  ArrowLeftIcon,
  Avatar,
  Button,
  CountBadge,
  EmptyState,
  IconButton,
  Modal,
  PlusIcon,
  SendIcon,
  Spinner,
  cx,
} from '../../ui';
import { LoadError } from '../common/Screen';
import { errorText, useAsync } from '../common/useAsync';

export interface MessagesScreenProps {
  /** Open straight into a DM with this player. */
  initialPartnerId?: string;
}

/** The server returns up to this many messages per history page. */
export const PAGE_SIZE = 50;
/** Below this width the list and the thread share one pane. */
const TWO_PANE_MIN = 620;

type Partner = Conversation['partner'];

const EMPTY_DMS: Record<string, ChatMessage[]> = {};

/**
 * Conversations from the server, updated with DMs that arrived live. A new
 * conversation's partner comes from their own messages, else from `people`
 * (the partner you opened, or a room member), so it isn't "Player" until they reply.
 */
function useConversationList(base: Conversation[] | undefined, meId: string, extra: Partner | null, people: readonly Partner[] = []): Conversation[] {
  const chat = useAppState((s) => s.chat) ?? EMPTY_DMS;
  return useMemo(() => {
    const byChannel = new Map<string, Conversation>((base ?? []).map((c) => [c.channel, c]));
    for (const [channel, msgs] of Object.entries(chat)) {
      const partnerId = dmPartner(channel, meId);
      const latest = msgs[msgs.length - 1];
      if (!partnerId || !latest) continue;
      const known = byChannel.get(channel);
      if (known) {
        if (!known.last || latest.createdAt > known.last.createdAt) byChannel.set(channel, { ...known, last: latest });
      } else {
        const fromThem = msgs.find((m) => m.senderId === partnerId);
        const who = extra?.id === partnerId ? extra : people.find((p) => p.id === partnerId);
        byChannel.set(channel, {
          channel,
          partner: fromThem
            ? { id: partnerId, name: fromThem.senderName, avatarUrl: fromThem.senderAvatar }
            : { id: partnerId, name: who?.name ?? 'Player', avatarUrl: who?.avatarUrl ?? '' },
          last: latest,
          unread: 0,
        });
      }
    }
    if (extra && !byChannel.has(dmChannel(meId, extra.id))) {
      byChannel.set(dmChannel(meId, extra.id), { channel: dmChannel(meId, extra.id), partner: extra, last: null, unread: 0 });
    }
    return [...byChannel.values()].sort((a, b) => {
      if (!a.last) return -1;
      if (!b.last) return 1;
      return a.last.createdAt < b.last.createdAt ? 1 : -1;
    });
  }, [base, chat, meId, extra, people]);
}

export function MessagesScreen({ initialPartnerId }: MessagesScreenProps) {
  const api = useApi();
  const me = useMe();
  const lobby = useLobby();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const twoPane = width >= TWO_PANE_MIN;
  const convos = useAsync(() => api.conversations(), [api]);
  const [partnerId, setPartnerId] = useState<string | null>(initialPartnerId && initialPartnerId !== me.id ? initialPartnerId : null);
  const [picking, setPicking] = useState(false);
  const [draftPartner, setDraftPartner] = useState<Partner | null>(null);

  // Unread counts are pushed on `me`; refresh the list when they change.
  const unread = me.unreadMessages;
  const first = useRef(true);
  const { reload } = convos;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [unread, reload]);

  const inList = partnerId ? convos.data?.find((c) => c.partner.id === partnerId)?.partner : undefined;
  const member = partnerId ? lobby?.members.find((m) => m.id === partnerId) : undefined;
  const needsLookup = !!partnerId && !inList && !member && !convos.loading && draftPartner?.id !== partnerId;

  // Someone we have no conversation with and who isn't in the room: look them up.
  useEffect(() => {
    if (!needsLookup || !partnerId) return;
    let live = true;
    api.profile(partnerId).then(
      (p) => live && setDraftPartner({ id: p.id, name: p.name, avatarUrl: p.avatarUrl }),
      () => live && setDraftPartner({ id: partnerId, name: 'Player', avatarUrl: '' }),
    );
    return () => { live = false; };
  }, [needsLookup, partnerId, api]);

  const partner: Partner | null = partnerId
    ? inList ?? (member ? { id: member.id, name: member.name, avatarUrl: member.avatarUrl } : draftPartner?.id === partnerId ? draftPartner : null)
    : null;
  // Everyone we can name: people in the room, and partners opened here (who may have left since).
  const [opened, setOpened] = useState<Partner[]>([]);
  useEffect(() => {
    if (partner && partner.name !== 'Player') setOpened((list) => (list.some((p) => p.id === partner.id) ? list : [...list, partner]));
  }, [partner]);
  const knownPeople = useMemo<Partner[]>(
    () => [...(lobby?.members ?? []).map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl })), ...opened],
    [lobby?.members, opened],
  );
  const list = useConversationList(convos.data, me.id, partner && !inList ? partner : null, knownPeople);

  const open = (id: string) => {
    setPartnerId(id);
    setPicking(false);
  };
  const markedRead = (channel: string) =>
    convos.setData((prev) => prev?.map((c) => (c.channel === channel ? { ...c, unread: 0 } : c)));

  const showList = twoPane || !partnerId;
  const showThread = twoPane || !!partnerId;

  return (
    <section aria-labelledby="messages-heading" className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3 p-4 sm:p-6 short:gap-2 short:p-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 id="messages-heading" className="text-3xl text-stock short:text-2xl">Messages</h1>
          <p className="mt-1 text-[15px] text-muted short:hidden">Private notes to other players. Only the two of you can read them.</p>
        </div>
        <Button variant="brass" size="sm" icon={<PlusIcon size={16} />} onClick={() => setPicking(true)}>New message</Button>
      </header>

      <div
        ref={ref}
        className="flex min-h-[22rem] flex-1 overflow-hidden rounded-xl bg-walnut-800 tex-wood ring-1 ring-inset ring-walnut-600/70 shadow-panel short:min-h-0"
      >
        {showList && (
          <nav aria-label="Conversations" className={cx('flex min-h-0 flex-col', twoPane ? 'w-72 shrink-0 border-r border-walnut-950' : 'w-full')}>
            {!convos.data && convos.loading ? (
              <div className="grid flex-1 place-items-center"><Spinner label="Loading conversations" className="text-brass" /></div>
            ) : !convos.data && convos.error ? (
              <LoadError compact what="conversations" error={convos.error} onRetry={convos.reload} />
            ) : list.length === 0 ? (
              <EmptyState
                compact
                className="flex-1 px-4"
                title="No messages yet"
                body="Start a conversation with someone in the room, or use Message on anyone's profile card."
                action={<Button size="sm" onClick={() => setPicking(true)}>Start a conversation</Button>}
              />
            ) : (
              <ConversationList list={list} activeId={partnerId} meId={me.id} onOpen={open} />
            )}
          </nav>
        )}
        {showThread && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {partner ? (
              <Thread
                key={partner.id}
                partner={partner}
                showBack={!twoPane}
                onBack={() => setPartnerId(null)}
                onRead={markedRead}
              />
            ) : partnerId ? (
              <div className="grid flex-1 place-items-center"><Spinner label="Opening conversation" className="text-brass" /></div>
            ) : (
              <EmptyState compact className="flex-1 px-4" title="Pick a conversation" body="Or start a new one with someone in the room." />
            )}
          </div>
        )}
      </div>

      {picking && (
        <PickPartner
          onClose={() => setPicking(false)}
          onPick={open}
          members={(lobby?.members ?? []).filter((m) => m.id !== me.id)}
        />
      )}
    </section>
  );
}

function ConversationList({ list, activeId, meId, onOpen }: { list: Conversation[]; activeId: string | null; meId: string; onOpen(id: string): void }) {
  const now = useNow();
  const lobby = useLobby();
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {list.map((c) => {
        const active = c.partner.id === activeId;
        const frame = lobby?.members.find((m) => m.id === c.partner.id)?.cosmetics.frame;
        const unread = active ? 0 : c.unread;
        return (
          <li key={c.channel}>
            <button
              type="button"
              onClick={() => onOpen(c.partner.id)}
              aria-current={active ? 'true' : undefined}
              className={cx(
                'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                active ? 'bg-walnut-600/70' : 'hover:bg-walnut-700/60',
              )}
            >
              <Avatar src={c.partner.avatarUrl} name={c.partner.name} frameId={frame} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cx('truncate text-stock', unread ? 'font-bold' : 'font-semibold')}>{c.partner.name}</span>
                  {c.last && <time className="shrink-0 text-[12px] text-muted" dateTime={c.last.createdAt}>{timeAgo(c.last.createdAt, now)}</time>}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={cx('truncate text-[13px]', unread ? 'text-stock' : 'text-muted')}>
                    {c.last ? `${c.last.senderId === meId ? 'You: ' : ''}${c.last.body}` : 'New conversation'}
                  </span>
                  <CountBadge count={unread} label="unread" className="ring-walnut-800" />
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Messages from the same sender within 3 minutes share one timestamp. */
function groupStarts(messages: ChatMessage[]): boolean[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    return !prev || prev.senderId !== m.senderId || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > 180_000;
  });
}

function Thread({ partner, showBack, onBack, onRead }: { partner: Partner; showBack: boolean; onBack(): void; onRead(channel: string): void }) {
  const api = useApi();
  const me = useMe();
  const store = useStore();
  const commands = useCommands();
  const profile = useProfileCard();
  const lobby = useLobby();
  const now = useNow();
  const channel = dmChannel(me.id, partner.id);
  const live = useChannel(channel);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [paging, setPaging] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const restore = useRef<number | null>(null);
  const frame = lobby?.members.find((m) => m.id === partner.id)?.cosmetics.frame;

  const messages = useMemo(() => {
    const seen = new Set(live.map((m) => m.id));
    return older.filter((m) => !seen.has(m.id)).concat(live);
  }, [older, live]);
  const starts = groupStarts(messages);

  useEffect(() => {
    let alive = true;
    setState('loading');
    api.history(channel).then(
      (msgs) => {
        if (!alive) return;
        store.setChannelMessages(channel, msgs);
        setHasMore(msgs.length >= PAGE_SIZE);
        setState('ready');
      },
      (err) => {
        if (!alive) return;
        setLoadErr(errorText(err));
        setState('error');
      },
    );
    return () => { alive = false; };
  }, [api, channel, store, attempt]);

  // Mark the conversation read when it opens and whenever the partner writes.
  const lastFromThem = [...live].reverse().find((m) => m.senderId === partner.id)?.id ?? null;
  useEffect(() => {
    commands.markRead(channel);
    onRead(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, lastFromThem, commands]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, state]);

  const loadOlder = async () => {
    const oldest = messages[0];
    if (!oldest || paging) return;
    setPaging(true);
    try {
      const page = await api.history(channel, oldest.createdAt);
      const el = listRef.current;
      if (el) restore.current = el.scrollHeight - el.scrollTop;
      setOlder((prev) => [...page, ...prev]);
      setHasMore(page.length >= PAGE_SIZE);
    } catch (err) {
      store.notify({ tone: 'bad', title: "Couldn't load older messages", body: errorText(err) });
    } finally {
      setPaging(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendErr(null);
    const ack = await commands.sendChat({ dm: partner.id }, body);
    setSending(false);
    if (ack.ok) {
      setDraft('');
      stick.current = true;
    } else setSendErr(ack.error);
  };

  const left = CHAT_MAX_LENGTH - draft.length;

  return (
    <>
      <header className="flex items-center gap-2 border-b border-walnut-950 px-2 py-2 sm:px-3 short:py-1">
        {showBack && (
          <IconButton label="Back to conversations" size="sm" onClick={onBack}>
            <ArrowLeftIcon size={18} />
          </IconButton>
        )}
        <button type="button" onClick={() => profile.open(partner.id)} className="flex min-w-0 items-center gap-2.5 rounded-full py-0.5 pr-3 pl-0.5 hover:bg-walnut-700/60">
          <Avatar src={partner.avatarUrl} name={partner.name} frameId={frame} size={34} />
          <span className="min-w-0 text-left">
            <h2 className="truncate font-display text-lg leading-tight text-stock">{partner.name}</h2>
            <span className="sr-only">Open profile card</span>
          </span>
        </button>
      </header>

      <ol
        ref={listRef}
        aria-label={`Messages with ${partner.name}`}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2 sm:px-4"
      >
        {state === 'loading' && messages.length === 0 && (
          <li className="grid flex-1 place-items-center"><Spinner label="Loading messages" className="text-brass" /></li>
        )}
        {state === 'error' && (
          <li className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-stock-dim">Couldn't load this conversation. {loadErr}</p>
            <Button variant="ghost" size="sm" onClick={() => setAttempt((a) => a + 1)}>Try again</Button>
          </li>
        )}
        {state === 'ready' && hasMore && (
          <li className="flex justify-center pb-2">
            <Button variant="quiet" size="sm" loading={paging} onClick={loadOlder}>Load older messages</Button>
          </li>
        )}
        {state === 'ready' && messages.length === 0 && (
          <li className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="font-display text-lg text-stock">Say hello to {partner.name}</p>
            <p className="max-w-64 text-sm text-muted">Only the two of you can see this conversation.</p>
          </li>
        )}
        {messages.map((m, i) => {
          const mine = m.senderId === me.id;
          return (
            <li key={m.id} className={cx('flex flex-col', mine ? 'items-end' : 'items-start', starts[i] ? 'mt-3' : 'mt-1')}>
              {starts[i] && (
                <p className="mb-0.5 px-1 text-[12px] text-muted">
                  <span className="font-semibold text-stock-dim">{mine ? 'You' : m.senderName}</span>{' '}
                  <time dateTime={m.createdAt}>{timeAgo(m.createdAt, now)}</time>
                </p>
              )}
              <p
                className={cx(
                  'max-w-[min(34rem,85%)] rounded-2xl px-3 py-1.5 text-[15px] leading-snug break-words whitespace-pre-wrap',
                  mine ? 'rounded-br-md bg-brass/90 text-ink' : 'rounded-bl-md bg-stock text-ink',
                )}
              >
                {m.body}
              </p>
            </li>
          );
        })}
      </ol>

      <form
        className="border-t border-walnut-950 p-2 sm:p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="flex items-center gap-1.5">
          <input
            className="input flex-1"
            placeholder={`Message ${partner.name}`}
            aria-label={`Message ${partner.name}`}
            aria-describedby="dm-counter"
            maxLength={CHAT_MAX_LENGTH}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSendErr(null);
            }}
          />
          <IconButton type="submit" label="Send" variant="brass" disabled={!draft.trim() || sending}>
            <SendIcon size={18} />
          </IconButton>
        </div>
        <div className={cx('mt-1 flex justify-between gap-2 px-1 text-[12px]', !draft && !sendErr && 'short:hidden')}>
          <p role={sendErr ? 'alert' : undefined} className="font-medium text-negative">{sendErr}</p>
          <p id="dm-counter" className={cx('tabular shrink-0', left <= 20 ? 'font-semibold text-brass-light' : 'text-muted')}>
            {left} {left === 1 ? 'character' : 'characters'} left
          </p>
        </div>
      </form>
    </>
  );
}

function PickPartner({ members, onPick, onClose }: { members: { id: string; name: string; avatarUrl: string; cosmetics: { frame: string } }[]; onPick(id: string): void; onClose(): void }) {
  return (
    <Modal open onClose={onClose} size="sm" title="New message" description="Pick someone in this room.">
      {members.length === 0 ? (
        <p className="py-4 text-sm text-muted">
          Nobody else is in the room right now. To message anyone else, open their profile card from the leaderboard and choose Message.
        </p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {members.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onPick(m.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-walnut-700/60">
                <Avatar src={m.avatarUrl} name={m.name} frameId={m.cosmetics.frame} size={36} />
                <span className="truncate font-semibold text-stock">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
