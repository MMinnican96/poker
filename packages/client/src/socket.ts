import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@poker/shared';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Connect to the game server. In dev/Discord the client is served from the same
 * origin and Vite (or the Discord URL mapping) proxies `/socket.io` to the
 * backend, so we connect to the current origin unless VITE_SERVER_URL is set.
 */
export function createSocket(): ClientSocket {
  const url = import.meta.env.VITE_SERVER_URL || '';
  return io(url, { withCredentials: true });
}
