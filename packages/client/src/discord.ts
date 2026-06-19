import { DiscordSDK } from '@discord/embedded-app-sdk';
import type { DiscordIdentity } from '@poker/shared';

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

export interface DiscordSession {
  /** Present only for the real Discord handshake; absent in dev mock mode. */
  sdk?: DiscordSDK;
  instanceId: string;
  identity: DiscordIdentity;
}

/**
 * Dev-only mock: bypasses the Discord SDK + auth call so the app can run in a
 * plain browser tab. Enabled only in `vite dev` and only when `?mock` is in the
 * URL (or VITE_MOCK_DISCORD=1). Open multiple tabs with distinct `?name=` to
 * simulate several players in the same lobby (`?room=` controls the lobby).
 *
 *   http://localhost:5173/?mock=1&name=Alice
 *   http://localhost:5173/?mock=1&name=Bob
 */
function isMockMode(): boolean {
  if (!import.meta.env.DEV) return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('mock') || import.meta.env.VITE_MOCK_DISCORD === '1';
}

function mockSession(): DiscordSession {
  const p = new URLSearchParams(window.location.search);
  const name = p.get('name') ?? `Player-${Math.random().toString(36).slice(2, 6)}`;
  const userId = p.get('user') ?? `mock-${name}`;
  const instanceId = p.get('room') ?? 'dev-room';
  const chipBalance = Number(p.get('chips') ?? '10000');

  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  const avatarUrl = `https://cdn.discordapp.com/embed/avatars/${Math.abs(hash) % 6}.png`;

  console.info(`[mock] Discord auth bypassed — ${name} (${userId}) in ${instanceId}`);
  return { instanceId, identity: { discordUserId: userId, displayName: name, avatarUrl, chipBalance } };
}

/**
/**
 * The handshake must run exactly once per page load. React StrictMode and Vite
 * HMR re-run the mount effect, and a second `authorize()` while the first is
 * pending makes the SDK reject with "Already authing". Caching the promise makes
 * repeat callers share the single in-flight handshake.
 */
let sessionPromise: Promise<DiscordSession> | null = null;

export function setupDiscord(): Promise<DiscordSession> {
  if (!sessionPromise) sessionPromise = runSetup();
  return sessionPromise;
}

/**
 * Full Discord Activity handshake:
 *  1. wait for the SDK to be ready inside the Discord iframe
 *  2. authorize → receive an OAuth code
 *  3. hand the code to our backend, which exchanges it, resolves the server
 *     nickname/avatar, and returns the access token + trusted identity
 *  4. authenticate the SDK with that access token
 */
async function runSetup(): Promise<DiscordSession> {
  if (isMockMode()) return mockSession();
  if (!CLIENT_ID) throw new Error('VITE_DISCORD_CLIENT_ID is not set');

  const sdk = new DiscordSDK(CLIENT_ID);
  await sdk.ready();

  // Minimal scope: we only need the user's identity here. The server reads each
  // player's server nickname + guild avatar with the BOT token (REST), so the
  // user does not need to grant `guilds.members.read`. We also avoid
  // `rpc.activities.write`, which requires allowlisting and otherwise makes
  // authorize() reject.
  const { code } = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  const res = await fetch('/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code, guildId: sdk.guildId }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const { access_token, identity } = (await res.json()) as {
    access_token: string;
    identity: DiscordIdentity;
  };

  await sdk.commands.authenticate({ access_token });

  return { sdk, instanceId: sdk.instanceId, identity };
}
