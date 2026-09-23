import { and, desc, eq, gt, like, lt, ne, or, sql } from 'drizzle-orm';
import {
  CHAT_MAX_LENGTH,
  dmPartner,
  type ChannelId,
  type ChatMessage,
  type Conversation,
} from '@poker/shared';
import type { Db } from '../db/client.js';
import { chatMessages, chatReads, players } from '../db/schema.js';

export type ChatResult = { ok: true; message: ChatMessage } | { ok: false; error: string };

/** Control, zero-width and bidi-override code points that never belong in chat. */
const STRIPPED: [number, number][] = [
  [0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069],
];

const NEWLINE = String.fromCharCode(10);

function allowed(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return !STRIPPED.some(([lo, hi]) => code >= lo && code <= hi);
}

/** Strip unwanted characters and collapse runs of blank lines; trims. */
export function cleanMessage(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  const lines = [...body].filter(allowed).join('').split(NEWLINE);
  const kept: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    blanks = line.trim() === '' ? blanks + 1 : 0;
    if (blanks <= 1) kept.push(line);
  }
  const cleaned = kept.join(NEWLINE).trim();
  if (cleaned.length === 0 || cleaned.length > CHAT_MAX_LENGTH) return null;
  return cleaned;
}

/** Room chat and direct messages, persisted. */
export class ChatService {
  constructor(private readonly db: Db) {}

  async send(channel: ChannelId, senderId: string, body: unknown): Promise<ChatResult> {
    const text = cleanMessage(body);
    if (text === null) return { ok: false, error: `Messages must be 1–${CHAT_MAX_LENGTH} characters.` };
    const [row] = await this.db.insert(chatMessages).values({ channel, senderId, body: text }).returning();
    const [sender] = await this.db.select().from(players).where(eq(players.discordUserId, senderId));
    return {
      ok: true,
      message: {
        id: row.id,
        channel,
        senderId,
        senderName: sender?.displayName ?? 'Unknown',
        senderAvatar: sender?.avatarUrl ?? '',
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      },
    };
  }

  /** Latest messages in a channel, oldest first. `before` pages backwards. */
  async history(channel: ChannelId, opts: { limit?: number; before?: string } = {}): Promise<ChatMessage[]> {
    const limit = Math.min(opts.limit ?? 50, 100);
    const before = opts.before ? new Date(opts.before) : null;
    const rows = await this.db
      .select({ m: chatMessages, name: players.displayName, avatar: players.avatarUrl })
      .from(chatMessages)
      .innerJoin(players, eq(players.discordUserId, chatMessages.senderId))
      .where(before && !Number.isNaN(before.getTime())
        ? and(eq(chatMessages.channel, channel), lt(chatMessages.createdAt, before))
        : eq(chatMessages.channel, channel))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);
    return rows.reverse().map(({ m, name, avatar }) => ({
      id: m.id,
      channel: m.channel,
      senderId: m.senderId,
      senderName: name,
      senderAvatar: avatar ?? '',
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async markRead(playerId: string, channel: ChannelId): Promise<void> {
    await this.db.insert(chatReads).values({ playerId, channel, lastReadAt: new Date() })
      .onConflictDoUpdate({ target: [chatReads.playerId, chatReads.channel], set: { lastReadAt: new Date() } });
  }

  /** The player's DM conversations, most recent first, with unread counts. */
  async conversations(playerId: string): Promise<Conversation[]> {
    const mine = or(like(chatMessages.channel, `dm:${playerId}:%`), like(chatMessages.channel, `dm:%:${playerId}`));
    const latest = await this.db
      .selectDistinctOn([chatMessages.channel], { m: chatMessages })
      .from(chatMessages)
      .where(mine)
      .orderBy(chatMessages.channel, desc(chatMessages.createdAt));
    const out: Conversation[] = [];
    for (const { m } of latest) {
      const partnerId = dmPartner(m.channel, playerId);
      if (!partnerId) continue;
      const [partner] = await this.db.select().from(players).where(eq(players.discordUserId, partnerId));
      const [sender] = m.senderId === partnerId ? [partner] : await this.db.select().from(players).where(eq(players.discordUserId, m.senderId));
      out.push({
        channel: m.channel,
        partner: { id: partnerId, name: partner?.displayName ?? 'Unknown', avatarUrl: partner?.avatarUrl ?? '' },
        last: {
          id: m.id, channel: m.channel, senderId: m.senderId,
          senderName: sender?.displayName ?? 'Unknown', senderAvatar: sender?.avatarUrl ?? '',
          body: m.body, createdAt: m.createdAt.toISOString(),
        },
        unread: await this.unreadIn(playerId, m.channel),
      });
    }
    return out.sort((a, b) => (b.last!.createdAt > a.last!.createdAt ? 1 : -1));
  }

  /** Unread DMs across all conversations. */
  async unreadTotal(playerId: string): Promise<number> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` })
      .from(chatMessages)
      .leftJoin(chatReads, and(eq(chatReads.channel, chatMessages.channel), eq(chatReads.playerId, playerId)))
      .where(and(
        or(like(chatMessages.channel, `dm:${playerId}:%`), like(chatMessages.channel, `dm:%:${playerId}`)),
        ne(chatMessages.senderId, playerId),
        or(sql`${chatReads.lastReadAt} is null`, gt(chatMessages.createdAt, chatReads.lastReadAt)),
      ));
    return Number(row?.n ?? 0);
  }

  private async unreadIn(playerId: string, channel: ChannelId): Promise<number> {
    const [read] = await this.db.select().from(chatReads)
      .where(and(eq(chatReads.playerId, playerId), eq(chatReads.channel, channel)));
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(chatMessages).where(and(
      eq(chatMessages.channel, channel),
      ne(chatMessages.senderId, playerId),
      read ? gt(chatMessages.createdAt, read.lastReadAt) : undefined,
    ));
    return Number(row?.n ?? 0);
  }
}
