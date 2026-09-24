import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMe } from '../test/harness';
import { createSession, isMockMode, resetSessionForTests, SessionError, startSession, type SessionEnv } from './session';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const env = (patch: Partial<SessionEnv>): SessionEnv => ({
  search: '',
  dev: true,
  clientId: 'cid',
  fetch: vi.fn(),
  ...patch,
});

beforeEach(() => resetSessionForTests());

describe('isMockMode', () => {
  it('needs both a dev build and ?mock', () => {
    expect(isMockMode({ dev: true, search: '?mock=1' })).toBe(true);
    expect(isMockMode({ dev: false, search: '?mock=1' })).toBe(false);
    expect(isMockMode({ dev: true, search: '?name=Alice' })).toBe(false);
  });
});

describe('mock sign-in', () => {
  it('posts the name and uses ?room', async () => {
    const me = makeMe({ name: 'Alice' });
    const fetch = vi.fn(async () => jsonResponse({ token: 'tok', me }));
    const s = await createSession(env({ search: '?mock=1&name=Alice&room=table-7', fetch }));
    expect(fetch).toHaveBeenCalledWith('/api/auth/mock', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Alice' }) }));
    expect(s).toMatchObject({ mode: 'mock', token: 'tok', me, instanceId: 'table-7' });
  });

  it('defaults the room to dev-room', async () => {
    const fetch = vi.fn(async () => jsonResponse({ token: 't', me: makeMe() }));
    const s = await createSession(env({ search: '?mock=1&name=Bob', fetch }));
    expect(s.instanceId).toBe('dev-room');
  });

  it('surfaces the server error message', async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: 'Pick a name with letters or numbers.' }, 400));
    await expect(createSession(env({ search: '?mock=1&name=!!', fetch }))).rejects.toMatchObject({
      kind: 'auth',
      message: 'Pick a name with letters or numbers.',
    });
  });

  it('reports network failures', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(createSession(env({ search: '?mock=1&name=A', fetch }))).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('Discord sign-in', () => {
  it('explains when the page is opened outside Discord', async () => {
    const err = await createSession(env({ search: '' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionError);
    expect((err as SessionError).kind).toBe('outside-discord');
  });

  it('runs the SDK handshake and exchanges the code', async () => {
    const commands = {
      authorize: vi.fn(async () => ({ code: 'abc' })),
      authenticate: vi.fn(async () => ({})),
    };
    class FakeSdk {
      guildId = '123';
      instanceId = 'inst-9';
      commands = commands;
      constructor(readonly clientId: string) {}
      ready = vi.fn(async () => {});
    }
    const me = makeMe();
    const fetch = vi.fn(async () => jsonResponse({ token: 'tok', accessToken: 'acc', me }));
    const s = await createSession(env({
      search: '?frame_id=f&instance_id=inst-9&platform=desktop',
      fetch,
      loadSdk: async () => FakeSdk as never,
    }));
    expect(commands.authorize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'cid', scope: ['identify'], response_type: 'code' }));
    expect(fetch).toHaveBeenCalledWith('/api/auth/token', expect.objectContaining({ body: JSON.stringify({ code: 'abc', guildId: '123' }) }));
    expect(commands.authenticate).toHaveBeenCalledWith({ access_token: 'acc' });
    expect(s).toMatchObject({ mode: 'discord', token: 'tok', instanceId: 'inst-9' });
  });
});

describe('Discord sign-in failures', () => {
  it('reports a refused authenticate() as an auth error', async () => {
    class FakeSdk {
      guildId = '123';
      instanceId = 'inst-9';
      commands = {
        authorize: vi.fn(async () => ({ code: 'abc' })),
        authenticate: vi.fn(async () => { throw new Error('Invalid token'); }),
      };
      constructor(readonly clientId: string) {}
      ready = vi.fn(async () => {});
    }
    const fetch = vi.fn(async () => jsonResponse({ token: 'tok', accessToken: 'acc', me: makeMe() }));
    const err = await createSession(env({ search: '?frame_id=f&instance_id=inst-9', fetch, loadSdk: async () => FakeSdk as never })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionError);
    expect((err as SessionError).kind).toBe('auth');
  });
});

describe('startSession', () => {
  it('shares one in-flight sign-in between callers (StrictMode double mount)', async () => {
    const fetch = vi.fn(async () => jsonResponse({ token: 't', me: makeMe() }));
    const e = { search: '?mock=1&name=A', dev: true, fetch };
    const [a, b] = await Promise.all([startSession(e), startSession(e)]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after a failure', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('down'))
      .mockResolvedValueOnce(jsonResponse({ token: 't', me: makeMe() }));
    const e = { search: '?mock=1&name=A', dev: true, fetch };
    await expect(startSession(e)).rejects.toBeInstanceOf(SessionError);
    await expect(startSession(e)).resolves.toMatchObject({ token: 't' });
  });
});
