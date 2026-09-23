import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

export interface SessionClaims {
  /** Player (Discord user) id. */
  sub: string;
  name: string;
  avatar: string;
}

export interface Auth {
  sign(claims: SessionClaims): string;
  /** The claims, or null when the token is missing, forged or expired. */
  verify(token: unknown): SessionClaims | null;
}

const TOKEN_TTL = '24h';

export function createAuth(secret: string): Auth {
  return {
    sign: (claims) => jwt.sign(claims, secret, { expiresIn: TOKEN_TTL }),
    verify(token) {
      if (typeof token !== 'string' || token.length === 0) return null;
      try {
        const decoded = jwt.verify(token, secret);
        if (typeof decoded !== 'object' || typeof decoded.sub !== 'string') return null;
        return { sub: decoded.sub, name: String(decoded.name ?? ''), avatar: String(decoded.avatar ?? '') };
      } catch {
        return null;
      }
    },
  };
}

/** JWT_SECRET, or a random per-process secret outside production. */
export function resolveSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (isProduction(env)) throw new Error('JWT_SECRET must be set in production');
  return randomBytes(32).toString('hex');
}

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || !!env.RAILWAY_ENVIRONMENT || !!env.RAILWAY_ENVIRONMENT_NAME;
}

/**
 * Mock sign-in (fake Discord identity) is a development convenience. It is
 * never available in production, and elsewhere can be switched off explicitly.
 */
export function mockAuthAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProduction(env)) return false;
  return env.MOCK_AUTH !== '0';
}

/** A safe display name and a stable id for a mock player. */
export function mockIdentity(rawName: unknown): { id: string; name: string } | null {
  if (typeof rawName !== 'string') return null;
  const name = rawName.replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!name) return null;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
  return { id: `mock-${slug}`, name };
}

/** A deterministic default avatar for mock players. */
export function mockAvatar(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `https://cdn.discordapp.com/embed/avatars/${Math.abs(hash) % 6}.png`;
}
