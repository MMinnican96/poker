import type { ReactNode } from 'react';
import { Button, Spinner } from '../ui';
import { SessionError } from './session';

function BootFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-dvh place-items-center overflow-y-auto bg-walnut-900 tex-wood p-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center short:gap-2">
        <span className="relative size-32 overflow-hidden rounded-full bg-walnut-950 ring-2 ring-walnut-600 short:size-20">
          <img src="/brand/logo.png" alt="Ratbag Poker Night" className="absolute inset-0 h-full w-full scale-[1.2] object-cover" />
        </span>
        {children}
      </div>
    </div>
  );
}

/** Shown while signing in and connecting. */
export function ConnectingScreen() {
  return (
    <BootFrame>
      <h1 className="text-2xl">Pulling up a chair</h1>
      <p className="flex items-center gap-2 text-muted">
        <Spinner size={18} label="Signing in" className="text-brass" />
        Signing you in
      </p>
    </BootFrame>
  );
}

function copyFor(error: unknown, dev: boolean): { title: string; body: ReactNode; retry: boolean } {
  const kind = error instanceof SessionError ? error.kind : 'network';
  const message = error instanceof Error ? error.message : String(error);
  switch (kind) {
    case 'outside-discord':
      return {
        title: 'Open this from Discord',
        body: (
          <>
            Ratbag Poker Night runs as a Discord Activity. Join a voice channel, open Activities and pick Ratbag Poker Night.
            {dev && (
              <span className="mt-3 block text-sm">
                Testing locally? Add <code className="rounded bg-walnut-950 px-1.5 py-0.5 text-brass-light">?mock=1&amp;name=Alice</code> to the address, e.g.{' '}
                <a className="font-semibold text-brass-light underline" href="/?mock=1&name=Alice">sign in as Alice</a>.
              </span>
            )}
          </>
        ),
        retry: false,
      };
    case 'config':
      return { title: "This build isn't set up for Discord", body: message, retry: false };
    case 'auth':
      return { title: "Sign-in didn't go through", body: `${message} Try again, or relaunch the activity.`, retry: true };
    default:
      return { title: "Can't reach the club", body: `${message} Check your connection, then try again.`, retry: true };
  }
}

/** Sign-in failed: say what happened and what to do next. */
export function BootErrorScreen({ error, onRetry, dev = import.meta.env.DEV }: { error: unknown; onRetry(): void; dev?: boolean }) {
  const copy = copyFor(error, dev);
  return (
    <BootFrame>
      <h1 className="text-2xl">{copy.title}</h1>
      <div className="text-muted">{copy.body}</div>
      {copy.retry && <Button onClick={onRetry}>Try again</Button>}
    </BootFrame>
  );
}

/** The session expired mid-game (socket refused the token). */
export function ExpiredScreen() {
  return (
    <BootFrame>
      <h1 className="text-2xl">Your session expired</h1>
      <p className="text-muted">Reload the activity to sign in again. Your chips are safe.</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </BootFrame>
  );
}

