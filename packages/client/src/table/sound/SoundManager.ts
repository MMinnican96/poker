import { SOUNDS, ALL_SOUND_FILES, type SoundName } from './catalog';
import { DEFAULT_SOUND_SETTINGS, SOUND_CATEGORIES, clamp01, type SoundCategory, type SoundSettings } from './soundStore';

export type { SoundName } from './catalog';

export interface PlayOptions {
  /** Playback rate (pitch); 1 = normal. */
  rate?: number;
  /** Extra loudness 0..1 on top of the settings (quieter variants of a cue). */
  gain?: number;
  /** Seconds from now (staggering several cues from one change). */
  delay?: number;
  /** Asked for by the player ("Play a sample"): play even if the clip is slow to load. */
  requested?: boolean;
}

export interface SoundManager {
  /** Resume audio after a user gesture (browser autoplay policy) and preload every clip (unless muted). */
  unlock(): void;
  /** Apply new settings; volume changes ramp smoothly on sounds already playing. */
  setSettings(s: SoundSettings): void;
  play(name: SoundName, opts?: PlayOptions): void;
}

export interface SoundManagerDeps {
  /** Builds the AudioContext; null when Web Audio isn't available. */
  createContext?: () => AudioContext | null;
  /** Fetches a clip's bytes. */
  load?: (url: string) => Promise<ArrayBuffer>;
  /** Random source for variant choice and pitch jitter. */
  random?: () => number;
  /** Wall clock in ms (lateness and throttling). */
  now?: () => number;
}

/** Slider position to gain: an audio taper, so the slider feels even across its range. */
export function volumeToGain(v: number): number {
  const c = clamp01(v);
  return c * c;
}

/** The gains the mixer applies for these settings. */
export function busGains(s: SoundSettings): { master: number; categories: Record<SoundCategory, number> } {
  const categories = {} as Record<SoundCategory, number>;
  for (const c of SOUND_CATEGORIES) categories[c] = volumeToGain(s.categories[c]);
  return { master: s.muted ? 0 : volumeToGain(s.master), categories };
}

/** Time constant (s) for volume ramps: fast, but no zipper noise. */
export const RAMP_TC = 0.03;
/** The same sound asked for twice within this many ms plays once. */
export const THROTTLE_MS = 45;
/** A cue that can't start within this many ms (clip still loading, audio waking) is dropped. */
export const LATE_MS = 350;

/** Brick-wall-ish limiter settings: the mix never clips however many sounds overlap. */
export const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.15 } as const;

/**
 * The Web Audio spec gives DynamicsCompressorNode a fixed makeup gain of
 * (1 / curve(1.0))^0.6, where curve(1.0) is the compression curve's output for
 * a 0 dBFS input. With a hard knee that output is T + (0 - T) / R dB, so the
 * makeup is 0.6 * -T * (1 - 1/R) dB: +0.57 dB for T = -1, R = 20 (and it was
 * +3.4 dB at T = -6). A gain stage after the limiter takes it back off, so a
 * signal below the threshold comes out exactly as loud as it went in.
 */
export function limiterMakeupDb(threshold: number = LIMITER.threshold, ratio: number = LIMITER.ratio): number {
  const curveAtFullScaleDb = threshold + (0 - threshold) / ratio;
  return -0.6 * curveAtFullScaleDb;
}

/** Linear gain that cancels the limiter's makeup gain. */
export function limiterCompensation(threshold: number = LIMITER.threshold, ratio: number = LIMITER.ratio): number {
  return 10 ** (-limiterMakeupDb(threshold, ratio) / 20);
}

function defaultContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

async function defaultLoad(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.arrayBuffer();
}

interface Bus {
  master: GainNode;
  categories: Record<SoundCategory, GainNode>;
}

/**
 * Plays the app's sounds through one mixer:
 * source → (cue gain) → category gain → master gain → limiter → makeup trim → speakers.
 * Everything is created lazily, so it's safe to construct where Web Audio is
 * missing (it then does nothing).
 */
export function createSoundManager(deps: SoundManagerDeps = {}): SoundManager {
  const createContext = deps.createContext ?? defaultContext;
  const load = deps.load ?? defaultLoad;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? (() => performance.now());

  let ctx: AudioContext | null = null;
  let bus: Bus | null = null;
  let tried = false;
  let preloaded = false;
  let unlocked = false;
  let settings: SoundSettings = DEFAULT_SOUND_SETTINGS;
  const buffers = new Map<string, AudioBuffer>();
  const loading = new Map<string, Promise<AudioBuffer | null>>();
  const lastAt = new Map<SoundName, number>();
  const lastVariant = new Map<SoundName, number>();

  function setParam(param: AudioParam, value: number, immediate: boolean): void {
    if (immediate || !ctx) {
      param.value = value;
      return;
    }
    const t = ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, RAMP_TC);
  }

  function applyGains(immediate: boolean): void {
    if (!bus) return;
    const g = busGains(settings);
    setParam(bus.master.gain, g.master, immediate);
    for (const c of SOUND_CATEGORIES) setParam(bus.categories[c].gain, g.categories[c], immediate);
  }

  function ensure(): AudioContext | null {
    if (ctx || tried) return ctx;
    tried = true;
    ctx = createContext();
    if (!ctx) return null;
    try {
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = LIMITER.threshold;
      limiter.knee.value = LIMITER.knee;
      limiter.ratio.value = LIMITER.ratio;
      limiter.attack.value = LIMITER.attack;
      limiter.release.value = LIMITER.release;
      const trim = ctx.createGain();
      trim.gain.value = limiterCompensation();
      limiter.connect(trim);
      trim.connect(ctx.destination);
      const master = ctx.createGain();
      master.connect(limiter);
      const categories = {} as Record<SoundCategory, GainNode>;
      for (const c of SOUND_CATEGORIES) {
        const g = ctx.createGain();
        g.connect(master);
        categories[c] = g;
      }
      bus = { master, categories };
      applyGains(true);
    } catch {
      ctx = null;
      bus = null;
    }
    return ctx;
  }

  function loadFile(url: string): Promise<AudioBuffer | null> {
    const have = buffers.get(url);
    if (have) return Promise.resolve(have);
    const pending = loading.get(url);
    if (pending) return pending;
    const c = ensure();
    if (!c) return Promise.resolve(null);
    const p = load(url)
      .then((bytes) => c.decodeAudioData(bytes))
      .then((b) => {
        buffers.set(url, b);
        return b;
      })
      .catch(() => null)
      .finally(() => loading.delete(url));
    loading.set(url, p);
    return p;
  }

  /** A random variant, never the same one twice in a row. */
  function pickFile(name: SoundName): string {
    const files = SOUNDS[name].files;
    if (files.length === 1) return files[0];
    const last = lastVariant.get(name) ?? -1;
    let i = Math.floor(random() * files.length) % files.length;
    if (i === last) i = (i + 1) % files.length;
    lastVariant.set(name, i);
    return files[i];
  }

  /** Fetch every clip once, after a gesture and only while sound is on. */
  function preload(): void {
    if (preloaded || !unlocked || settings.muted || !ctx) return;
    preloaded = true;
    for (const f of ALL_SOUND_FILES) void loadFile(f);
  }

  function awake(c: AudioContext): Promise<void> {
    if (c.state === 'running') return Promise.resolve();
    try {
      return c.resume().catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  }

  return {
    unlock() {
      const c = ensure();
      if (!c) return;
      unlocked = true;
      void awake(c);
      preload();
    },

    setSettings(s) {
      settings = s;
      applyGains(false);
      preload();
    },

    play(name, opts = {}) {
      const def = SOUNDS[name];
      const g = busGains(settings);
      if (g.master <= 0 || g.categories[def.category] <= 0) return;
      const c = ensure();
      if (!c || !bus) return;
      const delayMs = Math.max(0, opts.delay ?? 0) * 1000;
      const requested = now();
      const at = requested + delayMs;
      const prev = lastAt.get(name);
      if (prev !== undefined && Math.abs(at - prev) < THROTTLE_MS) return;
      lastAt.set(name, at);

      const file = pickFile(name);
      const target = bus.categories[def.category];
      const start = (buffer: AudioBuffer) => {
        const elapsed = now() - requested;
        if (!opts.requested && elapsed > LATE_MS + delayMs) return;
        const src = c.createBufferSource();
        src.buffer = buffer;
        const jitter = def.jitter > 0 ? 1 + (random() * 2 - 1) * def.jitter : 1;
        src.playbackRate.value = (opts.rate && opts.rate > 0 ? opts.rate : 1) * jitter;
        const cueGain = clamp01(opts.gain ?? 1);
        let cue: GainNode | null = null;
        if (cueGain < 1) {
          cue = c.createGain();
          cue.gain.value = cueGain;
          src.connect(cue);
          cue.connect(target);
        } else {
          src.connect(target);
        }
        src.onended = () => {
          src.disconnect();
          cue?.disconnect();
        };
        src.start(c.currentTime + Math.max(0, delayMs - elapsed) / 1000);
      };
      const ready = buffers.get(file);
      if (ready && c.state === 'running') {
        start(ready);
        return;
      }
      void Promise.all([loadFile(file), awake(c)]).then(([b]) => {
        if (b && c.state === 'running') start(b);
      });
    },
  };
}
