import type { SoundSettings } from './soundStore';
import { DEFAULT_SOUND_SETTINGS } from './soundStore';

export type SoundName = 'bet' | 'check' | 'deal' | 'fold' | 'suspense' | 'win';

const FILES: Record<SoundName, string> = {
  bet: '/audio/bet.mp3',
  check: '/audio/check.mp3',
  deal: '/audio/muck-deal.mp3',
  fold: '/audio/fold.wav',
  suspense: '/audio/suspense.wav',
  win: '/audio/win.wav',
};

export interface SoundManager {
  /** Resume the AudioContext after a user gesture (browser autoplay policy). */
  unlock(): void;
  setSettings(s: SoundSettings): void;
  play(name: SoundName, opts?: { rate?: number }): void;
}

type Ctx = AudioContext;

function getAudioContextCtor(): (new () => Ctx) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createSoundManager(): SoundManager {
  let ctx: Ctx | null = null;
  let settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };
  const buffers = new Map<SoundName, AudioBuffer>();
  const loading = new Map<SoundName, Promise<AudioBuffer | null>>();

  function ensureCtx(): Ctx | null {
    if (ctx) return ctx;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  async function loadBuffer(name: SoundName): Promise<AudioBuffer | null> {
    const c = ensureCtx();
    if (!c) return null;
    if (buffers.has(name)) return buffers.get(name)!;
    if (loading.has(name)) return loading.get(name)!;
    const p = (async () => {
      try {
        const res = await fetch(FILES[name]);
        const arr = await res.arrayBuffer();
        const buf = await c.decodeAudioData(arr);
        buffers.set(name, buf);
        return buf;
      } catch {
        return null;
      } finally {
        loading.delete(name);
      }
    })();
    loading.set(name, p);
    return p;
  }

  return {
    unlock() {
      const c = ensureCtx();
      if (c && c.state === 'suspended') void c.resume();
    },
    setSettings(s: SoundSettings) {
      settings = s;
    },
    play(name: SoundName, opts?: { rate?: number }) {
      if (settings.muted || settings.volume <= 0) return;
      const c = ensureCtx();
      if (!c) return;
      void loadBuffer(name).then((buf) => {
        if (!buf) return;
        const source = c.createBufferSource();
        source.buffer = buf;
        if (opts?.rate && opts.rate > 0) source.playbackRate.value = opts.rate;
        const gain = c.createGain();
        gain.gain.value = settings.volume;
        source.connect(gain).connect(c.destination);
        source.start();
      });
    },
  };
}
