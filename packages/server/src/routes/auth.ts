import { Router } from 'express';
import jwt from 'jsonwebtoken';
import type { DiscordIdentity } from '@poker/shared';
import { upsertPlayer } from '../db/index.js';
import {
  exchangeCode,
  fetchUser,
  fetchGuildMember,
  resolveIdentity,
} from '../discord.js';

export const authRouter = Router();

const SESSION_COOKIE = 'poker_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24h

interface SessionClaims {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
}

function signSession(claims: SessionClaims): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign(claims, secret, { expiresIn: '24h' });
}

export function verifySession(token: string): SessionClaims {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.verify(token, secret) as SessionClaims;
}

/**
 * POST /api/auth/token
 * Body: { code, guildId? }
 *
 * Exchanges the Discord OAuth2 code for an access token, resolves the player's
 * server nickname + avatar, seeds/refreshes their DB row, and issues a JWT
 * session cookie. Returns the access_token (so the client can complete
 * `discordSdk.commands.authenticate`) plus the trusted identity + chip balance.
 */
authRouter.post('/token', async (req, res) => {
  const { code, guildId } = req.body as { code?: string; guildId?: string };
  if (!code) {
    res.status(400).json({ error: 'Missing code' });
    return;
  }

  try {
    const accessToken = await exchangeCode(code);
    const user = await fetchUser(accessToken);
    const member = guildId ? await fetchGuildMember(guildId, user.id) : null;
    const resolved = resolveIdentity(user, member, guildId);

    const player = await upsertPlayer({
      discordUserId: resolved.discordUserId,
      displayName: resolved.displayName,
      avatarUrl: resolved.avatarUrl,
    });

    const token = signSession(resolved);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: SESSION_MAX_AGE_MS,
    });

    const identity: DiscordIdentity = {
      discordUserId: player.discordUserId,
      displayName: player.displayName,
      avatarUrl: player.avatarUrl ?? resolved.avatarUrl,
      chipBalance: player.chipBalance,
    };
    res.json({ access_token: accessToken, identity });
  } catch (err) {
    console.error('[auth] token exchange failed:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});
