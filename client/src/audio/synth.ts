// Sounds made by code (no files): UI clicks, the error buzz, coins, short tunes and simple spell
// sounds. Each one is rendered once into an AudioBuffer while the game loads (OfflineAudioContext),
// so playing it costs the same as a sound from a file.

type Recipe = { seconds: number; draw: (ctx: OfflineAudioContext, out: AudioNode) => void };

/** One note with an attack / decay envelope. */
function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  start: number,
  length: number,
  gain: number,
  endFreq = freq,
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + length);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.01, length / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(g).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** White noise through a filter whose frequency moves from f0 to f1. */
function noise(
  ctx: BaseAudioContext,
  out: AudioNode,
  start: number,
  length: number,
  gain: number,
  type: BiquadFilterType,
  f0: number,
  f1: number,
): void {
  const n = Math.ceil(ctx.sampleRate * length);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Fixed seed: the same sound every time.
  let s = 12345;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (s / 0x3fffffff - 1) * 0.9;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(f0, start);
  f.frequency.exponentialRampToValueAtTime(f1, start + length);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + length * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, start + length);
  src.connect(f).connect(g).connect(out);
  src.start(start);
}

/** Note number (60 = middle C) to Hz. */
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

export const SYNTH: Record<string, Recipe> = {
  click: { seconds: 0.08, draw: (c, o) => tone(c, o, 'triangle', 1500, 0, 0.06, 0.35, 900) },
  error: {
    seconds: 0.32,
    draw: (c, o) => {
      tone(c, o, 'square', 170, 0, 0.12, 0.18);
      tone(c, o, 'square', 150, 0.15, 0.14, 0.18);
    },
  },
  coin: {
    seconds: 0.45,
    draw: (c, o) => {
      tone(c, o, 'triangle', hz(88), 0, 0.09, 0.3);
      tone(c, o, 'triangle', hz(93), 0.07, 0.35, 0.3);
    },
  },
  level_up: {
    seconds: 1.1,
    draw: (c, o) => {
      [72, 76, 79, 84].forEach((n, i) => tone(c, o, 'triangle', hz(n), i * 0.11, 0.5, 0.28));
      noise(c, o, 0.3, 0.7, 0.05, 'highpass', 6000, 9000);
    },
  },
  cast: { seconds: 0.5, draw: (c, o) => noise(c, o, 0, 0.45, 0.35, 'bandpass', 400, 3200) },
  spell_hit: {
    seconds: 0.6,
    draw: (c, o) => {
      tone(c, o, 'sine', 110, 0, 0.45, 0.6, 40);
      noise(c, o, 0, 0.4, 0.3, 'lowpass', 2500, 300);
    },
  },
  horn: {
    seconds: 1.5,
    draw: (c, o) => {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      f.connect(o);
      for (const start of [0, 0.75]) {
        tone(c, f, 'sawtooth', hz(50), start, 0.6, 0.25);
        tone(c, f, 'sawtooth', hz(57), start, 0.6, 0.18);
      }
    },
  },
  victory: {
    seconds: 2.4,
    draw: (c, o) => {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2200;
      f.connect(o);
      const notes: [number, number, number][] = [
        [60, 0, 0.18],
        [64, 0.18, 0.18],
        [67, 0.36, 0.18],
        [72, 0.54, 1.4],
      ];
      for (const [n, t, l] of notes) {
        tone(c, f, 'sawtooth', hz(n), t, l, 0.22);
        tone(c, f, 'triangle', hz(n - 12), t, l, 0.18);
      }
    },
  },
  defeat: {
    seconds: 2.6,
    draw: (c, o) => {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1200;
      f.connect(o);
      const notes: [number, number, number][] = [
        [55, 0, 0.45],
        [51, 0.45, 0.45],
        [48, 0.9, 1.5],
      ];
      for (const [n, t, l] of notes) tone(c, f, 'sawtooth', hz(n), t, l, 0.2);
    },
  },
};

/** Renders every code-made sound. Runs once while loading. */
export async function renderSynth(sampleRate: number): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  await Promise.all(
    Object.entries(SYNTH).map(async ([id, r]) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * r.seconds), sampleRate);
      r.draw(ctx, ctx.destination);
      out.set(id, await ctx.startRendering());
    }),
  );
  return out;
}
