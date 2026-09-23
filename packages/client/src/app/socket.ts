import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@poker/shared';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Connect to the game server with the session token. The client is always
 * served from the same origin as the server (Vite proxies `/socket.io` in dev;
 * the server serves the built client in production), so the URL is empty.
 */
export function connectSocket(token: string): ClientSocket {
  return io('', { auth: { token }, transports: ['websocket', 'polling'] });
}
