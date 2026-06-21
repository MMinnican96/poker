import { describe, it, expect } from 'vitest';
import type { DiscordIdentity, TableConfig } from '@poker/shared';
import { LobbyRoom } from './lobby.js';

function fakeIo() {
  const emits: { event: string; args: unknown[] }[] = [];
  const io = { to: () => ({ emit: (event: string, ...args: unknown[]) => emits.push({ event, args }) }) };
  return { io, emits };
}
const id = (i: string, chips: number): DiscordIdentity => ({ discordUserId: i, displayName: i, avatarUrl: '', chipBalance: chips });
const cfg = (buyIn = 3000): TableConfig => ({ buyIn, smallBlind: 25, bigBlind: 50, maxPlayers: 9, turnSeconds: 30 });
function room() {
  const { io } = fakeIo();
  return new LobbyRoom('I', io as never, { countdownMs: 100 });
}

describe('LobbyRoom host model', () => {
  it('has no host until a game is created', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    expect(r.toState().hostId).toBeNull();
  });

  it('createGame sets the host and config', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.createGame('sa', cfg(1000));
    const st = r.toState();
    expect(st.hostId).toBe('a');
    expect(st.config.buyIn).toBe(1000);
  });

  it('rejects createGame from an underfunded player', () => {
    const r = room();
    r.addPlayer(id('a', 100), 'sa');
    r.createGame('sa', cfg(3000));
    expect(r.toState().hostId).toBeNull();
  });

  it('rejects a second createGame while a host exists', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg(1000));
    r.createGame('sb', cfg(2000));
    expect(r.toState().hostId).toBe('a');
  });

  it('cancelGame clears the host and ready flags', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg());
    r.setReady('sb', true);
    r.cancelGame('sa');
    const st = r.toState();
    expect(st.hostId).toBeNull();
    expect(st.players.every((p) => !p.isReady)).toBe(true);
  });

  it('ignores cancelGame from a non-host', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg());
    r.cancelGame('sb');
    expect(r.toState().hostId).toBe('a');
  });

  it('transfers host to the next player when the host leaves', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg());
    r.removeBySocket('sa');
    expect(r.toState().hostId).toBe('b');
  });

  it('clears the host when the last player leaves', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.createGame('sa', cfg());
    r.removeBySocket('sa');
    expect(r.toState().hostId).toBeNull();
  });

  it('only lets the host edit config while forming', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg(1000));
    r.updateConfig('sb', { buyIn: 99 });   // non-host: ignored
    r.updateConfig('sa', { buyIn: 2000 });  // host: applies
    expect(r.toState().config.buyIn).toBe(2000);
  });

  it('resetAfterGame clears host, ready and status', () => {
    const r = room();
    r.addPlayer(id('a', 5000), 'sa');
    r.addPlayer(id('b', 5000), 'sb');
    r.createGame('sa', cfg());
    r.setReady('sb', true);
    r.resetAfterGame();
    const st = r.toState();
    expect(st.hostId).toBeNull();
    expect(st.status).toBe('waiting');
    expect(st.players.every((p) => !p.isReady)).toBe(true);
  });
});

describe('LobbyRoom chip balances', () => {
  it('updateChipBalance updates the stored balance', () => {
    const r = room();
    r.addPlayer(id('a', 3000), 'sa');
    r.updateChipBalance('a', 1500);
    expect(r.toState().players.find((p) => p.discordUserId === 'a')!.chipBalance).toBe(1500);
  });

  it('addPlayer preserves a live balance across a rejoin', () => {
    const r = room();
    r.addPlayer(id('a', 3000), 'sa');
    r.updateChipBalance('a', 500);
    r.addPlayer(id('a', 3000), 'sa2'); // rejoin with a stale identity balance
    expect(r.toState().players.find((p) => p.discordUserId === 'a')!.chipBalance).toBe(500);
  });

  it('getChipBalance returns the live tracked balance, or undefined for unknown players', () => {
    const r = room();
    r.addPlayer(id('a', 3000), 'sa');
    expect(r.getChipBalance('a')).toBe(3000);
    r.updateChipBalance('a', 1200);
    expect(r.getChipBalance('a')).toBe(1200);
    expect(r.getChipBalance('nobody')).toBeUndefined();
  });
});
