/**
 * Thin wrappers around the Discord HTTP API used during Activity auth.
 * All calls happen server-side so the bot token and client secret never reach
 * the browser, and the resulting identity is trusted by the rest of the app.
 */

const DISCORD_API = 'https://discord.com/api/v10';

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface GuildMember {
  nick: string | null;
  avatar: string | null;
  user?: DiscordUser;
}

export interface ResolvedIdentity {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
}

/** Exchange an OAuth2 authorization code for a user access token. */
export async function exchangeCode(code: string): Promise<string> {
  const clientId = requireEnv('DISCORD_CLIENT_ID');
  const clientSecret = requireEnv('DISCORD_CLIENT_SECRET');

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
  });

  if (!res.ok) {
    throw new Error(`Discord token exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Discord token response missing access_token');
  return data.access_token;
}

/** Fetch the authenticated user with their own access token. */
export async function fetchUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord /users/@me failed (${res.status})`);
  return (await res.json()) as DiscordUser;
}

/** Fetch a guild member (for server nickname + guild avatar) using the bot token. */
export async function fetchGuildMember(
  guildId: string,
  userId: string,
): Promise<GuildMember | null> {
  const botToken = requireEnv('DISCORD_BOT_TOKEN');
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Discord guild member fetch failed (${res.status})`);
  return (await res.json()) as GuildMember;
}

/**
 * Resolve the display name + avatar URL we show in-game, preferring the
 * per-guild nickname/avatar and falling back to the global user profile.
 */
export function resolveIdentity(
  user: DiscordUser,
  member: GuildMember | null,
  guildId: string | undefined,
): ResolvedIdentity {
  const displayName = member?.nick ?? user.global_name ?? user.username;

  let avatarUrl: string;
  if (member?.avatar && guildId) {
    avatarUrl = `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png?size=128`;
  } else if (user.avatar) {
    avatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  } else {
    const idx = (BigInt(user.id) >> 22n) % 6n;
    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  }

  return { discordUserId: user.id, displayName, avatarUrl };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
