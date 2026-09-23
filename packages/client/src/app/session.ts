import type { AuthResponse, PlayerSelf } from '@poker/shared';
import type { DiscordSDK } from '@discord/embedded-app-sdk';

/** A signed-in player plus the Activity instance (room) they launched into. */
export interface Session {
  mode: 'mock' | 'discord';
  /** Bearer token for REST (`Authorization`) and the socket handshake (`auth.token`). */
  token: string;
  me: PlayerSelf;
  /** Discord Activity instance id, or `?room=` (default `dev-room`) in mock mode. */
  instanceId: string;
  /** Present only for the real Discord handshake. */
  sdk?: DiscordSDK;
}

export type SessionErrorKind = 'outside-discord' | 'config' | 'auth' | 'network';

/** A sign-in failure with a category the boot screen can explain. */
export class SessionError extends Error {
  constructor(readonly kind: SessionErrorKind, message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionEnv {
  /** `location.search`. */
  search: string;
  /** `import.meta.env.DEV` — mock sign-in only exists in dev builds. */
  dev: boolean;
  clientId: string | undefined;
  fetch: typeof fetch;
  /** Loads the Discord SDK lazily so mock mode never touches it. */
  loadSdk?: () => Promise<typeof DiscordSDK>;
}

/** True when this page should sign in with a made-up identity (dev + `?mock`). */
export function isMockMode(env: Pick<SessionEnv, 'search' | 'dev'>): boolean {
  return env.dev && new URLSearchParams(env.search).has('mock');
}

async function postJson<T>(f: typeof fetch, url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SessionError('network', "Couldn't reach the game server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new SessionError('auth', data.error ?? `Sign-in failed (${res.status}).`);
  }
  return data;
}

async function mockSession(env: SessionEnv): Promise<Session> {
  const p = new URLSearchParams(env.search);
  const name = (p.get('name') ?? '').trim() || `Rat ${Math.random().toString(36).slice(2, 6)}`;
  const instanceId = (p.get('room') ?? '').trim() || 'dev-room';
  const auth = await postJson<AuthResponse>(env.fetch, '/api/auth/mock', { name });
  return { mode: 'mock', token: auth.token, me: auth.me, instanceId };
}

function withTimeout<T>(p: Promise<T>, ms: number, error: SessionError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(error), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function discordSession(env: SessionEnv): Promise<Session> {
  const params = new URLSearchParams(env.search);
  if (!params.has('frame_id') || !params.has('instance_id')) {
    throw new SessionError('outside-discord', 'This page runs inside Discord.');
  }
  if (!env.clientId) {
    throw new SessionError('config', 'VITE_DISCORD_CLIENT_ID is not set for this build.');
  }
  const Sdk = env.loadSdk ? await env.loadSdk() : (await import('@discord/embedded-app-sdk')).DiscordSDK;
  const sdk = new Sdk(env.clientId);
  await withTimeout(sdk.ready(), 15_000, new SessionError('network', 'Discord took too long to respond.'));

  // Only `identify`: the server reads nicknames/avatars with the bot token.
  let code: string;
  try {
    ({ code } = await sdk.commands.authorize({
      client_id: env.clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    }));
  } catch {
    throw new SessionError('auth', 'Discord sign-in was cancelled or refused.');
  }

  const auth = await postJson<AuthResponse>(env.fetch, '/api/auth/token', { code, guildId: sdk.guildId });
  if (auth.accessToken) await sdk.commands.authenticate({ access_token: auth.accessToken });
  return { mode: 'discord', token: auth.token, me: auth.me, instanceId: sdk.instanceId, sdk };
}

/** Sign in without caching. Prefer `startSession()` in the app. */
export function createSession(env: SessionEnv): Promise<Session> {
  return isMockMode(env) ? mockSession(env) : discordSession(env);
}

let inFlight: Promise<Session> | null = null;

/**
 * Sign in once per page load. StrictMode and HMR re-run mount effects, and a
 * second `authorize()` while the first is pending makes the SDK reject, so all
 * callers share the single in-flight promise. A failed attempt can be retried.
 */
export function startSession(env?: Partial<SessionEnv>): Promise<Session> {
  if (!inFlight) {
    const full: SessionEnv = {
      search: window.location.search,
      dev: import.meta.env.DEV,
      clientId: import.meta.env.VITE_DISCORD_CLIENT_ID,
      fetch: (input, init) => window.fetch(input, init),
      ...env,
    };
    inFlight = createSession(full).catch((err: unknown) => {
      inFlight = null;
      throw err;
    });
  }
  return inFlight;
}

/** Test helper: forget the cached session. */
export function resetSessionForTests(): void {
  inFlight = null;
}
