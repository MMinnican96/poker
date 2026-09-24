import { describe, it, expect } from 'vitest';
import { ALL_SOUND_FILES, SOUNDS } from './catalog';
import { LATE_MS, LIMITER, RAMP_TC, THROTTLE_MS, busGains, createSoundManager, limiterCompensation, limiterMakeupDb, volumeToGain } from './SoundManager';
import { DEFAULT_SOUND_SETTINGS, SOUND_CATEGORIES, type SoundSettings } from './soundStore';

class FakeParam {
  value: number;
  targets: { v: number; t: number; c: number }[] = [];
  constructor(v = 1) {
    this.value = v;
  }
  setTargetAtTime(v: number, t: number, c: number) {
    this.targets.push({ v, t, c });
    this.value = v;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  out: FakeNode[] = [];
  disconnected = false;
  connect<T extends FakeNode>(n: T): T {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  playbackRate = new FakeParam(1);
  startedAt: number | null = null;
  onended: (() => void) | null = null;
  start(t = 0) {
    this.startedAt = t;
  }
}

class FakeContext {
  state: 'running' | 'suspended' = 'running';
  currentTime = 10;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  compressors: FakeCompressor[] = [];
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createDynamicsCompressor() {
    const c = new FakeCompressor();
    this.compressors.push(c);
    return c;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  failDecode = false;
  decodeAudioData(bytes: ArrayBuffer) {
    return this.failDecode ? Promise.reject(new Error('bad data')) : Promise.resolve({ decodedFrom: bytes });
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { random?: () => number; settings?: SoundSettings; loadDelay?: () => Promise<void>; failLoad?: boolean } = {}) {
  const ctx = new FakeContext();
  const loads: string[] = [];
  let clock = 1000;
  const manager = createSoundManager({
    createContext: () => ctx as unknown as AudioContext,
    load: async (url) => {
      loads.push(url);
      if (opts.loadDelay) await opts.loadDelay();
      if (opts.failLoad) throw new Error('404');
      return new TextEncoder().encode(url).buffer as ArrayBuffer;
    },
    random: opts.random ?? (() => 0.5),
    now: () => clock,
  });
  manager.setSettings(opts.settings ?? DEFAULT_SOUND_SETTINGS);
  return {
    ctx,
    loads,
    manager,
    advance(ms: number) {
      clock += ms;
    },
  };
}

/** Gains are created in order: the limiter's makeup trim, master, then each category. */
function bus(ctx: FakeContext) {
  const [trim, master, ...cats] = ctx.gains;
  return { trim, master, categories: Object.fromEntries(SOUND_CATEGORIES.map((c, i) => [c, cats[i]])) as Record<string, FakeGain> };
}

describe('gain maths', () => {
  it('uses an audio taper and silences the master when muted', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(2)).toBe(1);
    const s = { ...DEFAULT_SOUND_SETTINGS, master: 0.6, categories: { ...DEFAULT_SOUND_SETTINGS.categories, cards: 0.5 } };
    expect(busGains(s).master).toBeCloseTo(0.36);
    expect(busGains(s).categories.cards).toBeCloseTo(0.25);
    expect(busGains({ ...s, muted: true }).master).toBe(0);
  });

  it("cancels the compressor's spec makeup gain, (1 / curve(1))^0.6", () => {
    // Hard knee: 0 dBFS in comes out at T + (0 - T) / R dB.
    expect(limiterMakeupDb(-6, 20)).toBeCloseTo(3.42, 2);
    expect(limiterMakeupDb(-1, 20)).toBeCloseTo(0.57, 2);
    expect(limiterMakeupDb(LIMITER.threshold, LIMITER.ratio)).toBeLessThan(1);
    // Makeup gain times compensation is unity.
    expect(10 ** (limiterMakeupDb() / 20) * limiterCompensation()).toBeCloseTo(1, 10);
    expect(limiterCompensation(-1, 20)).toBeCloseTo(0.9366, 3);
  });
});

describe('SoundManager', () => {
  it('no-ops without Web Audio', () => {
    const m = createSoundManager({ createContext: () => null });
    m.setSettings(DEFAULT_SOUND_SETTINGS);
    expect(() => m.unlock()).not.toThrow();
    expect(() => m.play('bet')).not.toThrow();
  });

  it('constructs in jsdom (no AudioContext) without throwing', () => {
    const m = createSoundManager();
    expect(() => m.play('suspense', { rate: 1.2 })).not.toThrow();
  });

  it('builds category gains into a master gain into a limiter into the speakers', () => {
    const { ctx, manager } = setup();
    manager.unlock();
    const [limiter] = ctx.compressors;
    const { trim, master, categories } = bus(ctx);
    expect(limiter.out).toEqual([trim]);
    expect(trim.out).toEqual([ctx.destination]);
    expect(trim.gain.value).toBeCloseTo(limiterCompensation());
    expect(limiter.threshold.value).toBe(LIMITER.threshold);
    expect(limiter.knee.value).toBe(0);
    expect(limiter.ratio.value).toBe(LIMITER.ratio);
    expect(master.out).toEqual([limiter]);
    const g = busGains(DEFAULT_SOUND_SETTINGS);
    expect(master.gain.value).toBeCloseTo(g.master);
    for (const c of SOUND_CATEGORIES) {
      expect(categories[c].out).toEqual([master]);
      expect(categories[c].gain.value).toBeCloseTo(g.categories[c]);
    }
  });

  it('ramps volume changes smoothly on the live bus', () => {
    const { ctx, manager } = setup();
    manager.unlock();
    const { master, categories } = bus(ctx);
    manager.setSettings({ ...DEFAULT_SOUND_SETTINGS, master: 0.5, categories: { ...DEFAULT_SOUND_SETTINGS.categories, alerts: 0.2 } });
    expect(master.gain.targets.at(-1)).toEqual({ v: 0.25, t: ctx.currentTime, c: RAMP_TC });
    expect(categories.alerts.gain.targets.at(-1)!.v).toBeCloseTo(0.04);
    manager.setSettings({ ...DEFAULT_SOUND_SETTINGS, muted: true });
    expect(master.gain.targets.at(-1)!.v).toBe(0);
  });

  it('routes a sound into its category, with cue gain, rate and pitch jitter', async () => {
    const { ctx, manager } = setup({ random: () => 0.75 });
    manager.unlock();
    await flush();
    manager.play('turn');
    manager.play('raise', { gain: 0.5, rate: 1.2 });
    await flush();
    const [turn, raise] = ctx.sources;
    const { categories } = bus(ctx);
    expect(turn.out).toEqual([categories.alerts]);
    // Musical cues stay in tune.
    expect(turn.playbackRate.value).toBe(1);
    const cue = raise.out[0] as FakeGain;
    expect(cue.gain.value).toBe(0.5);
    expect(cue.out).toEqual([categories.actions]);
    expect(raise.playbackRate.value).toBeCloseTo(1.2 * (1 + 0.5 * SOUNDS.raise.jitter));
  });

  it('plays nothing while muted or with its group at zero', async () => {
    const { ctx, manager } = setup({ settings: { ...DEFAULT_SOUND_SETTINGS, muted: true } });
    manager.play('bet');
    manager.setSettings({ ...DEFAULT_SOUND_SETTINGS, categories: { ...DEFAULT_SOUND_SETTINGS.categories, cards: 0 } });
    manager.play('deal');
    await flush();
    expect(ctx.sources).toHaveLength(0);
    manager.play('bet');
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('throttles a burst of the same sound, not different ones', async () => {
    const { ctx, manager, advance } = setup();
    manager.play('call');
    manager.play('call');
    manager.play('check');
    await flush();
    expect(ctx.sources).toHaveLength(2);
    advance(THROTTLE_MS + 1);
    manager.play('call');
    await flush();
    expect(ctx.sources).toHaveLength(3);
  });

  it('never picks the same variant twice in a row', async () => {
    const { ctx, manager, advance } = setup({ random: () => 0 });
    for (let i = 0; i < 4; i++) {
      manager.play('check');
      await flush();
      advance(100);
    }
    await flush();
    const files = ctx.sources.map((s) => new TextDecoder().decode((s.buffer as { decodedFrom: ArrayBuffer }).decodedFrom));
    expect(files).toHaveLength(4);
    for (let i = 1; i < files.length; i++) expect(files[i]).not.toBe(files[i - 1]);
  });

  it('staggers a delayed cue on the audio clock', async () => {
    const { ctx, manager } = setup();
    manager.unlock();
    await flush();
    manager.play('flip', { delay: 0.2 });
    await flush();
    expect(ctx.sources[0].startedAt).toBeCloseTo(ctx.currentTime + 0.2);
  });

  it('preloads every clip on unlock, once', async () => {
    const { loads, manager } = setup();
    manager.unlock();
    manager.unlock();
    await flush();
    expect([...loads].sort()).toEqual([...ALL_SOUND_FILES].sort());
  });

  it("doesn't preload while muted, and preloads once sound is turned on", async () => {
    const { loads, manager } = setup({ settings: { ...DEFAULT_SOUND_SETTINGS, muted: true } });
    manager.unlock();
    await flush();
    expect(loads).toEqual([]);
    manager.setSettings(DEFAULT_SOUND_SETTINGS);
    await flush();
    expect(loads).toHaveLength(ALL_SOUND_FILES.length);
  });

  it('shrugs off a clip that fails to load or decode, and tries again next time', async () => {
    const failing = setup({ failLoad: true });
    failing.manager.play('bet');
    await flush();
    await flush();
    expect(failing.ctx.sources).toHaveLength(0);

    const { ctx, manager, advance } = setup({ random: () => 0 });
    ctx.failDecode = true;
    manager.play('message');
    await flush();
    await flush();
    expect(ctx.sources).toHaveLength(0);
    ctx.failDecode = false;
    advance(100);
    manager.play('message');
    await flush();
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('plays a sample the player asked for even if the clip was slow to arrive', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { ctx, manager, advance } = setup({ loadDelay: () => gate });
    manager.play('bet', { requested: true });
    advance(LATE_MS + 500);
    release();
    await flush();
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });

  it('drops a cue whose clip arrives too late to fit the moment', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { ctx, manager, advance } = setup({ loadDelay: () => gate });
    manager.play('bet');
    advance(LATE_MS + 50);
    release();
    await flush();
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });

  it('wakes a suspended context before playing', async () => {
    const { ctx, manager } = setup();
    ctx.state = 'suspended';
    manager.play('bet');
    await flush();
    await flush();
    expect(ctx.state).toBe('running');
    expect(ctx.sources).toHaveLength(1);
  });
});
