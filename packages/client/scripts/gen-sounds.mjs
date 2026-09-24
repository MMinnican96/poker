#!/usr/bin/env node
/**
 * Synthesizes every table and app sound into packages/client/public/audio/.
 *
 *   npm run sounds:generate -w @poker/client
 *
 * No dependencies and no audio tools: each clip is built from physically
 * motivated pieces (damped modes for chips, knocks and bells, filtered noise
 * for cards and felt), seeded so the output is the same on every run, then
 * loudness-normalized so the set sits together. Writes 16-bit mono WAV at
 * 32 kHz and prints duration, peak, RMS and short-term loudness per clip.
 *
 * To audition a change, regenerate and play the files; to replace one clip
 * with a recording, see public/audio/CREDITS.md.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 32000;
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/audio');
const TAU = Math.PI * 2;
const PEAK_CEILING_DB = -1;

// ---------------------------------------------------------------------------
// Randomness (deterministic)
// ---------------------------------------------------------------------------

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [lo, hi). */
const between = (rng, lo, hi) => lo + (hi - lo) * rng();
/** `x` scaled by up to ±`spread` (a fraction). */
const vary = (rng, x, spread) => x * (1 + (rng() * 2 - 1) * spread);

// ---------------------------------------------------------------------------
// Buffers and building blocks
// ---------------------------------------------------------------------------

const samples = (sec) => Math.max(1, Math.round(sec * SR));
const buf = (sec) => new Float64Array(samples(sec));

/** Mix `src` into `dst` starting at `at` seconds (clipped to `dst`). */
function mix(dst, src, at = 0, gain = 1) {
  const o = Math.round(at * SR);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * gain;
  return dst;
}

function scale(x, g) {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

function noise(rng, sec) {
  const x = buf(sec);
  for (let i = 0; i < x.length; i++) x[i] = rng() * 2 - 1;
  return x;
}

/**
 * A damped sine: one resonant mode of a struck object. `glideTo` bends the
 * frequency exponentially towards that value with time constant `glideTau`
 * (a thump's pitch drop).
 */
function mode(freq, tau, amp, sec, { phase = 0, glideTo = null, glideTau = 0.03, attack = 0.0005 } = {}) {
  const x = buf(sec);
  let ph = phase;
  const atk = Math.max(1, attack * SR);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const f = glideTo === null ? freq : glideTo + (freq - glideTo) * Math.exp(-t / glideTau);
    ph += (TAU * f) / SR;
    const a = amp * Math.exp(-t / tau) * Math.min(1, i / atk);
    x[i] = a * Math.sin(ph);
  }
  return x;
}

/** Multiply by an attack ramp (raised cosine) and exponential decay. */
function envelope(x, attack, tau, delay = 0) {
  const a0 = delay * SR;
  const a1 = Math.max(1, attack * SR);
  for (let i = 0; i < x.length; i++) {
    const n = i - a0;
    if (n < 0) {
      x[i] = 0;
      continue;
    }
    const rise = n < a1 ? 0.5 - 0.5 * Math.cos((Math.PI * n) / a1) : 1;
    const fall = n < a1 ? 1 : Math.exp(-(n - a1) / SR / tau);
    x[i] *= rise * fall;
  }
  return x;
}

/** Multiply by an arbitrary gain curve g(t in seconds). */
function shape(x, g) {
  for (let i = 0; i < x.length; i++) x[i] *= g(i / SR);
  return x;
}

/**
 * Topology-preserving state-variable filter (Zavalishin). `fc` may be a
 * number or a function of time, so sweeps are smooth and stable.
 */
function svf(x, type, fc, q = 0.707) {
  const out = new Float64Array(x.length);
  const k = 1 / q;
  let ic1 = 0;
  let ic2 = 0;
  const fixed = typeof fc === 'number';
  let g = fixed ? Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR) : 0;
  for (let i = 0; i < x.length; i++) {
    if (!fixed) g = Math.tan((Math.PI * Math.min(fc(i / SR), SR * 0.45)) / SR);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x[i] - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    out[i] = type === 'low' ? v2 : type === 'band' ? v1 : x[i] - k * v1 - v2;
  }
  return out;
}

const lowpass = (x, fc, q) => svf(x, 'low', fc, q);
const highpass = (x, fc, q) => svf(x, 'high', fc, q);
const bandpass = (x, fc, q) => svf(x, 'band', fc, q);

/** Slowly wandering gain in [1 - depth, 1]: the grain of something rubbing on felt. */
function grain(rng, sec, rate, depth) {
  const x = lowpass(noise(rng, sec), rate, 0.5);
  let peak = 1e-9;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < x.length; i++) x[i] = 1 - depth * (0.5 + 0.5 * (x[i] / peak));
  return x;
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

/**
 * One set of clay chips: the resonances they share (each chip in a stack
 * differs a little). Clay composite chips ring in the 2 to 7 kHz range and
 * die in tens of milliseconds.
 */
function chipSet(rng) {
  return [
    { f: between(rng, 2150, 2550), tau: 0.02, a: 1 },
    { f: between(rng, 2950, 3350), tau: 0.013, a: 0.65 },
    { f: between(rng, 3900, 4400), tau: 0.01, a: 0.5 },
    { f: between(rng, 5100, 5600), tau: 0.007, a: 0.35 },
    { f: between(rng, 6300, 6900), tau: 0.005, a: 0.22 },
  ];
}

/** One chip striking another: inharmonic damped partials plus a short noise tick. */
function clack(rng, set, amp = 1, bright = 1) {
  const sec = 0.08;
  const x = buf(sec);
  for (const p of set) {
    const a = p.a * between(rng, 0.55, 1.2) * (p.f > 4500 ? bright : 1);
    mix(x, mode(vary(rng, p.f, 0.03), vary(rng, p.tau, 0.25), a, sec, { phase: rng() * TAU }));
  }
  const tick = envelope(noise(rng, 0.006), 0.0002, 0.0009);
  mix(x, bandpass(tick, between(rng, 3200, 4200), 0.9), 0, 1.4);
  // A little body from the chip's mass.
  mix(x, mode(vary(rng, 900, 0.1), 0.006, 0.18, sec));
  return scale(x, amp);
}

/** A soft thump: a chip stack or a hand landing on padded felt. */
function thud(rng, freq, tau, amp, sec = 0.12) {
  const x = mode(vary(rng, freq, 0.06), tau, 1, sec, { glideTo: freq * 0.8, glideTau: 0.04, attack: 0.002 });
  const n = envelope(noise(rng, 0.02), 0.001, 0.004);
  mix(x, lowpass(n, 700, 0.7), 0, 0.6);
  return scale(x, amp);
}

/**
 * Chips landing one after another. `gaps` is [min, max] seconds between
 * chips; `decay` lets later chips settle more softly.
 */
function chipRun(rng, set, count, gaps, { amp = 1, decay = 0.9, bright = 1, jitterAmp = 0.35 } = {}) {
  const sec = count * gaps[1] + 0.1;
  const x = buf(sec);
  let t = 0;
  let a = amp;
  for (let i = 0; i < count; i++) {
    mix(x, clack(rng, set, a * between(rng, 1 - jitterAmp, 1), bright), t);
    t += between(rng, gaps[0], gaps[1]);
    a *= decay;
  }
  return x;
}

/** Felt friction: something being pushed across the table. */
function feltSlide(rng, sec, { center = 900, q = 0.6, amp = 1, attack = 0.05, release = 0.08 } = {}) {
  const n = noise(rng, sec);
  let x = bandpass(n, center, q);
  x = lowpass(x, 2600, 0.7);
  const g = grain(rng, sec, 40, 0.6);
  for (let i = 0; i < x.length; i++) x[i] *= g[i];
  shape(x, (t) => Math.min(1, t / attack) * Math.min(1, Math.max(0, (sec - t) / release)));
  return scale(x, amp);
}

/**
 * A card leaving the deck and landing: a band-passed swish sweeping down
 * from `from` to `to` Hz over `len` seconds, then a soft snap on the felt.
 */
function cardFlick(rng, { len = 0.07, from = 5200, to = 2400, q = 1.1, snap = 0.5, amp = 1 } = {}) {
  const sec = len + 0.07;
  const x = buf(sec);
  const sw = bandpass(noise(rng, len), (t) => from * Math.pow(to / from, Math.min(1, t / len)), q);
  shape(sw, (t) => {
    const u = t / len;
    return u < 0.3 ? Math.sin((Math.PI / 2) * (u / 0.3)) ** 2 : Math.exp(-(u - 0.3) * 4.5);
  });
  mix(x, lowpass(sw, 6500, 0.6));
  if (snap > 0) {
    const s = lowpass(envelope(noise(rng, 0.02), 0.0003, 0.0018), 2200, 0.8);
    mix(s, mode(vary(rng, 330, 0.08), 0.01, 0.5, 0.02));
    mix(x, s, len * 0.85, snap * 2.2);
  }
  return scale(x, amp);
}

/** A knuckle on the padded wooden rail: a low thump with a pitch drop and some wood. */
function knock(rng, amp = 1) {
  const sec = 0.14;
  const x = buf(sec);
  const f0 = between(rng, 140, 165);
  mix(x, mode(f0, 0.032, 1, sec, { glideTo: f0 * 0.72, glideTau: 0.025, attack: 0.0015 }));
  const wood = [
    [between(rng, 360, 420), 0.024, 0.8],
    [between(rng, 690, 780), 0.015, 0.55],
    [between(rng, 1100, 1260), 0.009, 0.32],
    [between(rng, 1580, 1760), 0.006, 0.16],
  ];
  for (const [f, tau, a] of wood) mix(x, mode(f, tau, a, sec, { phase: rng() * TAU, attack: 0.001 }));
  mix(x, lowpass(envelope(noise(rng, 0.01), 0.0003, 0.0015), 2000, 0.7), 0, 0.5);
  return scale(lowpass(x, 3000, 0.6), amp);
}

/** A soft mallet tone: harmonics that decay faster the higher they are. */
function mallet(freq, sec, amp = 1, tau = 0.45, { bell = false } = {}) {
  const x = buf(sec);
  const partials = bell
    ? [[1, 1, 1], [2, 0.22, 0.5], [2.76, 0.12, 0.35], [5.4, 0.05, 0.2]]
    : [[1, 1, 1], [2, 0.3, 0.5], [3, 0.12, 0.33], [4, 0.05, 0.25]];
  for (const [ratio, a, tr] of partials) mix(x, mode(freq * ratio, tau * tr, a, sec, { attack: 0.004 }));
  return scale(x, amp);
}

/** A few odd and even harmonics under a low-pass: a warm, reedy tone. */
function warmTone(freq, sec, cutoff = 1200) {
  const x = buf(sec);
  for (let h = 1; h <= 8; h++) mix(x, mode(freq * h, 10, 1 / h, sec, { phase: 0 }));
  return lowpass(x, cutoff, 0.7);
}

// ---------------------------------------------------------------------------
// The sounds
// ---------------------------------------------------------------------------

/** Hole cards: two quick flicks. */
function deal(rng) {
  const x = buf(0.3);
  mix(x, cardFlick(rng, { len: between(rng, 0.055, 0.07), from: vary(rng, 5400, 0.06), to: vary(rng, 2600, 0.08), snap: 0.45 }));
  mix(x, cardFlick(rng, { len: between(rng, 0.055, 0.07), from: vary(rng, 5000, 0.06), to: vary(rng, 2400, 0.08), snap: 0.4, amp: 0.85 }), between(rng, 0.085, 0.1));
  return x;
}

/** The flop: the three-card packet slides out, then is spread (three soft snaps). */
function flop(rng) {
  const x = buf(0.5);
  mix(x, cardFlick(rng, { len: 0.11, from: 4200, to: 1900, q: 0.9, snap: 0.55 }));
  let t = 0.16;
  for (let i = 0; i < 3; i++) {
    mix(x, cardFlick(rng, { len: between(rng, 0.035, 0.045), from: 3600, to: 2200, q: 1.2, snap: 0.32, amp: 0.55 }), t);
    t += between(rng, 0.055, 0.07);
  }
  return x;
}

/** The turn or river: one card slid out and set down firmly. */
function streetCard(rng) {
  const x = buf(0.3);
  mix(x, cardFlick(rng, { len: between(rng, 0.09, 0.11), from: vary(rng, 4400, 0.06), to: vary(rng, 2000, 0.08), q: 0.95, snap: 0.7 }));
  return x;
}

/** A card turned face up: a small lift, then the slap of it landing. */
function flip(rng) {
  const x = buf(0.16);
  mix(x, cardFlick(rng, { len: 0.03, from: 3600, to: 2800, q: 1.4, snap: 0, amp: 0.45 }));
  const slap = lowpass(envelope(noise(rng, 0.04), 0.0004, 0.0035), vary(rng, 3400, 0.08), 0.7);
  mix(slap, mode(vary(rng, 430, 0.08), 0.008, 0.35, 0.04));
  mix(slap, mode(vary(rng, 1150, 0.08), 0.005, 0.2, 0.04));
  mix(x, slap, between(rng, 0.04, 0.05), 1.3);
  return x;
}

/** Cards tossed into the muck: a slower, duller slide and a soft landing. */
function fold(rng) {
  const len = between(rng, 0.17, 0.2);
  const x = buf(0.34);
  const sw = bandpass(noise(rng, len), (t) => 1700 * Math.pow(0.55, t / len), 0.8);
  shape(sw, (t) => Math.min(1, t / 0.04) * Math.exp(-Math.max(0, t - 0.04) / 0.06));
  mix(x, lowpass(sw, 3000, 0.7));
  const tap = lowpass(envelope(noise(rng, 0.02), 0.0005, 0.003), 1300, 0.7);
  mix(x, tap, len * 0.8, 0.9);
  mix(x, tap, len * 0.8 + between(rng, 0.02, 0.03), 0.5);
  return x;
}

/** Check: two knocks on the rail, the second a little softer. */
function check(rng) {
  const x = buf(0.32);
  mix(x, knock(rng, 1));
  mix(x, knock(rng, between(rng, 0.72, 0.85)), between(rng, 0.115, 0.14));
  return x;
}

/** Call: a couple of chips set down lightly. */
function call(rng) {
  const set = chipSet(rng);
  const x = buf(0.3);
  mix(x, thud(rng, 220, 0.012, 0.25));
  mix(x, chipRun(rng, set, 2 + Math.floor(rng() * 2), [0.035, 0.06], { amp: 0.8, decay: 0.8 }), 0.004);
  return x;
}

/** Bet: a short stack placed with a soft thud, chips settling. */
function bet(rng) {
  const set = chipSet(rng);
  const x = buf(0.34);
  mix(x, thud(rng, 190, 0.016, 0.45));
  mix(x, chipRun(rng, set, 4 + Math.floor(rng() * 2), [0.012, 0.028], { amp: 1, decay: 0.82 }), 0.003);
  return x;
}

/** Raise: a stack placed, then more chips tossed on top. */
function raise(rng) {
  const set = chipSet(rng);
  const x = buf(0.5);
  mix(x, thud(rng, 190, 0.016, 0.5));
  mix(x, chipRun(rng, set, 4, [0.012, 0.024], { amp: 1, decay: 0.85 }), 0.003);
  mix(x, chipRun(rng, set, 4, [0.028, 0.045], { amp: 0.95, decay: 0.85, bright: 1.25 }), between(rng, 0.17, 0.2));
  return x;
}

/** All-in: the whole stack shoved forward, chips cascading. */
function allIn(rng) {
  const set = chipSet(rng);
  const x = buf(0.8);
  mix(x, feltSlide(rng, 0.3, { center: 650, amp: 0.55, attack: 0.04, release: 0.12 }));
  mix(x, thud(rng, 120, 0.035, 0.8, 0.2), 0.02);
  const n = 16;
  let t = 0.06;
  for (let i = 0; i < n; i++) {
    mix(x, clack(rng, set, between(rng, 0.55, 1) * Math.pow(0.93, i), 1.1), t);
    t += between(rng, 0.008, 0.02) + i * 0.0025;
  }
  mix(x, thud(rng, 150, 0.02, 0.4), t + 0.02);
  return x;
}

/** The pot pushed to the winner: stacks slide across the felt and bunch up. */
function pot(rng) {
  const set = chipSet(rng);
  const x = buf(0.72);
  mix(x, feltSlide(rng, 0.38, { center: 750, amp: 0.7, attack: 0.08, release: 0.1 }));
  let t = 0.2;
  for (let i = 0; i < 11; i++) {
    mix(x, clack(rng, set, between(rng, 0.45, 0.9), 0.9), t);
    t += between(rng, 0.015, 0.035);
  }
  mix(x, thud(rng, 170, 0.02, 0.35), t);
  return x;
}

/** Your turn: two soft mallet notes, a rising fourth. */
function yourTurn() {
  const x = buf(0.8);
  mix(x, mallet(659.25, 0.8, 0.8, 0.38));
  mix(x, mallet(880, 0.66, 1, 0.42), 0.13);
  return lowpass(x, 4500, 0.7);
}

/** A clock tick: a short dry click with a little wooden body. */
function tick(rng, urgent) {
  const x = buf(urgent ? 0.1 : 0.07);
  const f = urgent ? 2900 : 2100;
  mix(x, mode(f, 0.005, 1, 0.07, { phase: rng() * TAU }));
  mix(x, mode(f * 1.53, 0.0035, 0.5, 0.07));
  mix(x, mode(urgent ? 1050 : 780, 0.008, 0.45, 0.07));
  mix(x, bandpass(envelope(noise(rng, 0.006), 0.0002, 0.0007), 3000, 1), 0, 0.8);
  if (urgent) {
    // A faint second click makes the last seconds feel hurried.
    const echo = mode(f * 0.9, 0.004, 0.35, 0.05);
    mix(x, echo, 0.028);
  }
  return lowpass(x, 6500, 0.7);
}

/** You won: a warm rising arpeggio on C major that rings out. */
function win() {
  const x = buf(1.4);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => mix(x, mallet(f, 1.3, i === 3 ? 1 : 0.8, 0.55), i * 0.085));
  mix(x, mallet(261.63, 1.1, 0.35, 0.6), 0.255);
  mix(x, mallet(392, 1.1, 0.25, 0.6), 0.255);
  return lowpass(x, 5000, 0.7);
}

/** Tension: two low pulses a semitone apart over a tritone, and a faint rising air. */
function suspense(rng) {
  const x = buf(0.85);
  const pulse = (root, at, tau, amp) => {
    const t = warmTone(root, 0.6, 1400);
    mix(t, warmTone(root * Math.SQRT2, 0.6, 1400), 0, 0.6);
    envelope(t, 0.012, tau);
    mix(x, t, at, amp);
  };
  pulse(220, 0, 0.12, 0.9);
  pulse(233.08, 0.26, 0.24, 1);
  const air = bandpass(noise(rng, 0.6), (t) => 500 + 1400 * (t / 0.6), 1.5);
  shape(air, (t) => (t / 0.6) ** 2 * Math.min(1, (0.6 - t) / 0.08));
  mix(x, air, 0.1, 0.35);
  return x;
}

/** A chat message: a small rounded pop. */
function message(rng) {
  const x = buf(0.14);
  mix(x, mode(430, 0.03, 1, 0.14, { glideTo: 760, glideTau: 0.012, attack: 0.002 }));
  mix(x, mode(860, 0.015, 0.2, 0.14, { glideTo: 1520, glideTau: 0.012, attack: 0.002 }));
  mix(x, lowpass(envelope(noise(rng, 0.004), 0.0002, 0.0006), 2500, 0.7), 0, 0.2);
  return x;
}

/** Level up or a challenge done: a quick bright glockenspiel run. */
function achievement() {
  const x = buf(1);
  [783.99, 1046.5, 1318.51, 1567.98].forEach((f, i) => mix(x, mallet(f, 0.9, i === 3 ? 0.9 : 0.7, 0.4, { bell: true }), i * 0.065));
  return lowpass(x, 6000, 0.7);
}

/**
 * Every clip: file stem, variants, loudness target (dB, K-weighted short-term
 * maximum; see `loudness`) and its builder. Targets are set by group so the
 * set sits together: actions around -22, cards a little under, alerts and
 * messages clearly under.
 */
const CLIPS = [
  // Chips & actions
  { name: 'check', variants: 3, target: -23, build: check },
  { name: 'call', variants: 3, target: -23, build: call },
  { name: 'bet', variants: 3, target: -22, build: bet },
  { name: 'raise', variants: 2, target: -21, build: raise },
  { name: 'allin', variants: 2, target: -20, build: allIn },
  // Cards
  { name: 'deal', variants: 3, target: -25, build: deal },
  { name: 'flop', variants: 2, target: -24, build: flop },
  { name: 'card', variants: 2, target: -24, build: streetCard },
  { name: 'flip', variants: 2, target: -25, build: flip },
  { name: 'fold', variants: 2, target: -26, build: fold },
  // Alerts
  { name: 'turn', variants: 1, target: -24, build: yourTurn },
  { name: 'tick', variants: 1, target: -30, build: (rng) => tick(rng, false) },
  { name: 'tick-urgent', variants: 1, target: -26, build: (rng) => tick(rng, true) },
  // Wins & stings
  { name: 'pot', variants: 2, target: -22, build: pot },
  { name: 'win', variants: 1, target: -21, build: win },
  { name: 'suspense', variants: 1, target: -23, build: suspense },
  { name: 'achievement', variants: 1, target: -23, build: achievement },
  // Messages
  { name: 'message', variants: 1, target: -27, build: message },
];

// ---------------------------------------------------------------------------
// Finishing: clean-up, measurement, normalization, WAV
// ---------------------------------------------------------------------------

/** Remove DC and rumble, trim the silent tail, and fade both edges so nothing clicks. */
function finish(x) {
  let y = highpass(x, 45, 0.707);
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  const floor = peak * 10 ** (-58 / 20);
  let end = y.length;
  while (end > 1 && Math.abs(y[end - 1]) < floor) end--;
  end = Math.min(y.length, end + samples(0.01));
  y = y.slice(0, end);
  const fadeIn = samples(0.0015);
  for (let i = 0; i < fadeIn && i < y.length; i++) y[i] *= i / fadeIn;
  // A tail that is still ringing gets a long, gentle release; a decayed one a short fade.
  const tail = y.slice(Math.max(0, y.length - samples(0.02)));
  let tailPeak = 0;
  for (const v of tail) tailPeak = Math.max(tailPeak, Math.abs(v));
  const ringing = tailPeak > peak * 10 ** (-40 / 20);
  const fadeOut = ringing ? Math.min(samples(0.3), Math.floor(y.length * 0.3)) : Math.min(samples(0.03), Math.floor(y.length * 0.2));
  for (let i = 0; i < fadeOut; i++) y[y.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  return y;
}

/** RBJ biquad (for the K-weighting pre-filter only). */
function biquad(x, { b0, b1, b2, a0, a1, a2 }) {
  const out = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

function highShelf(f0, gainDb, q) {
  const A = 10 ** (gainDb / 40);
  const w = (TAU * f0) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const s = 2 * Math.sqrt(A) * alpha;
  return {
    b0: A * (A + 1 + (A - 1) * c + s),
    b1: -2 * A * (A - 1 + (A + 1) * c),
    b2: A * (A + 1 + (A - 1) * c - s),
    a0: A + 1 - (A - 1) * c + s,
    a1: 2 * (A - 1 - (A + 1) * c),
    a2: A + 1 - (A - 1) * c - s,
  };
}

function highPassRbj(f0, q) {
  const w = (TAU * f0) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return { b0: (1 + c) / 2, b1: -(1 + c), b2: (1 + c) / 2, a0: 1 + alpha, a1: -2 * c, a2: 1 - alpha };
}

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/**
 * Loudness proxy for short clips: K-weight the signal (the ITU-R BS.1770
 * pre-filter: +4 dB shelf above ~1.7 kHz, high-pass at 38 Hz), then take the
 * loudest 100 ms window's mean square. The ear integrates short sounds over
 * roughly that span, so a 20 ms click and a 1 s chord compare fairly.
 */
function loudness(x) {
  const k = biquad(biquad(x, highShelf(1681.97, 4, 0.7072)), highPassRbj(38.13, 0.5003));
  const win = samples(0.1);
  let sum = 0;
  let best = 0;
  for (let i = 0; i < k.length; i++) {
    sum += k[i] * k[i];
    if (i >= win) sum -= k[i - win] * k[i - win];
    best = Math.max(best, sum / win);
  }
  return 10 * Math.log10(Math.max(best, 1e-12));
}

function stats(x) {
  let peak = 0;
  let sq = 0;
  for (const v of x) {
    peak = Math.max(peak, Math.abs(v));
    sq += v * v;
  }
  return { peak, rms: Math.sqrt(sq / x.length), loud: loudness(x), dur: x.length / SR, ...spectrum(x) };
}

/** In-place radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2];
        const ai = im[i + k + len / 2];
        const tr = ar * wr - ai * wi;
        const ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - tr;
        im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
      }
    }
  }
}

/** Spectral centroid (Hz) and the share of energy above 8 kHz: a check for harshness. */
function spectrum(x) {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  fft(re, im);
  let total = 0;
  let weighted = 0;
  let high = 0;
  for (let k = 1; k < n / 2; k++) {
    const p = re[k] * re[k] + im[k] * im[k];
    const f = (k * SR) / n;
    total += p;
    weighted += p * f;
    if (f > 8000) high += p;
  }
  return { centroid: total > 0 ? weighted / total : 0, highShare: total > 0 ? high / total : 0 };
}

function toWav(x, rng) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    // TPDF dither at 16-bit.
    const d = (rng() - rng()) / 32768;
    const v = Math.max(-1, Math.min(1, x[i] + d));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const ceiling = 10 ** (PEAK_CEILING_DB / 20);
  const rows = [];
  let bytes = 0;
  const problems = [];
  for (const clip of CLIPS) {
    for (let v = 1; v <= clip.variants; v++) {
      const file = clip.variants > 1 ? `${clip.name}-${v}.wav` : `${clip.name}.wav`;
      const rng = mulberry32(hashSeed(file));
      const raw = finish(clip.build(rng));
      const before = stats(raw);
      let gain = 10 ** ((clip.target - before.loud) / 20);
      let limited = false;
      if (before.peak * gain > ceiling) {
        gain = ceiling / before.peak;
        limited = true;
      }
      const out = scale(raw, gain);
      const s = stats(out);
      const wav = toWav(out, rng);
      writeFileSync(path.join(OUT, file), wav);
      bytes += wav.length;
      rows.push({ file, ...s, target: clip.target, limited });
      if (s.dur > 1.5) problems.push(`${file} is long (${s.dur.toFixed(2)} s)`);
      if (limited && s.loud < clip.target - 1.5) problems.push(`${file} is peak-limited ${(clip.target - s.loud).toFixed(1)} dB under target`);
      if (!Number.isFinite(s.loud)) problems.push(`${file} is silent`);
      if (s.highShare > 0.05) problems.push(`${file} has ${(s.highShare * 100).toFixed(0)}% of its energy above 8 kHz`);
      if (Math.abs(out[0]) > 1e-3 || Math.abs(out[out.length - 1]) > 1e-3) problems.push(`${file} does not start and end at silence`);
    }
  }
  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, n = 6) => v.toFixed(1).padStart(n);
  console.log(`${pad('file', 20)}${pad('dur s', 7)}${pad('peak', 7)}${pad('rms', 7)}${pad('loud', 7)}${pad('centroid', 10)}${pad('>8k', 6)}target`);
  for (const r of rows) {
    console.log(
      `${pad(r.file, 20)}${r.dur.toFixed(2).padStart(5)}  ${num(db(r.peak))} ${num(db(r.rms))} ${num(r.loud)}  ${String(Math.round(r.centroid)).padStart(6)} Hz ${(r.highShare * 100).toFixed(1).padStart(4)}%  ${r.target}${r.limited ? ' (peak-limited)' : ''}`,
    );
  }
  console.log(`\n${rows.length} files, ${(bytes / 1024).toFixed(0)} KiB, ${SR} Hz 16-bit mono -> ${path.relative(process.cwd(), OUT)}`);
  // Files this run didn't write: left over from a renamed or dropped clip, or a
  // recording swapped in by hand. Not deleted, since it may be the latter.
  const written = new Set(rows.map((r) => r.file));
  for (const f of readdirSync(OUT)) {
    if (/.(wav|mp3|ogg)$/i.test(f) && !written.has(f)) {
      problems.push(`${f} was not generated: delete it if stale, or keep it listed in src/table/sound/catalog.ts (catalog.test.ts fails on unreferenced files)`);
    }
  }
  if (problems.length) {
    console.log('\nCheck these:');
    for (const p of problems) console.log(`  - ${p}`);
  }
}

main();
