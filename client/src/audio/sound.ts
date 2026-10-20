// The game's sound engine (Web Audio): sounds from files (audio/audio.json) and sounds made by
// code (synth.ts), four volume groups from Settings, quieter with distance from the camera,
// a limit on copies of the same sound, and one music loop.

import type { GameAssets } from '../loader/assets';
import { renderSynth } from './synth';

export type SoundGroup = 'sfx' | 'voice' | 'ui';

interface SoundDef {
  buffers: AudioBuffer[];
  volume: number;
}

interface AudioManifest {
  sounds: Record<string, { files: string[]; volume: number }>;
  music: Record<string, { file: string; volume: number }>;
}

/** Copies of one sound that may play at the same time (a big fight has many hits). */
const MAX_SAME = 4;
/** Sounds playing at once in total. */
const MAX_TOTAL = 24;
/** Same sound again sooner than this: skipped. */
const MIN_GAP_MS = 35;
/** Game units from the camera center where a world sound fades out. */
const HEARING = 48;

/** Volume for a sound at distance d (0..1). Pure, for tests. */
export function distanceGain(d: number, hearing = HEARING): number {
  if (d <= hearing * 0.25) return 1;
  if (d >= hearing) return 0;
  const t = (d - hearing * 0.25) / (hearing * 0.75);
  return (1 - t) * (1 - t);
}

/** Left / right from the camera center, -1..1. Pure, for tests. */
export function panFor(dx: number, hearing = HEARING): number {
  return Math.max(-1, Math.min(1, dx / (hearing * 0.6)));
}

export class GameSound {
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null = null;
  private readonly groups = new Map<SoundGroup | 'music', GainNode>();
  private readonly sounds = new Map<string, SoundDef>();
  private readonly music = new Map<string, SoundDef>();
  private readonly playing = new Map<string, number>();
  private readonly lastAt = new Map<string, number>();
  private total = 0;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private musicId = '';
  private listenerX = 128;
  private listenerY = 128;

  constructor() {
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      // No Web Audio (very old browser, tests): the game runs silent.
    }
    this.ctx = ctx;
    if (!ctx) return;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const g of ['sfx', 'voice', 'ui', 'music'] as const) {
      const node = ctx.createGain();
      node.connect(this.master);
      this.groups.set(g, node);
    }
    // Browsers start audio only after the player clicks or presses a key.
    const resume = () => {
      if (ctx.state === 'suspended') void ctx.resume();
    };
    window.addEventListener('pointerdown', resume, { capture: true });
    window.addEventListener('keydown', resume, { capture: true });
  }

  /** Decodes the downloaded files and renders the code-made sounds (while loading). */
  async load(assets: GameAssets): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !assets.has('audio/audio.json')) return;
    const manifest = (await (await fetch(assets.url('audio/audio.json'))).json()) as AudioManifest;
    const decode = async (path: string) => ctx.decodeAudioData(await (await fetch(assets.url(path))).arrayBuffer());
    await Promise.all([
      ...Object.entries(manifest.sounds).map(async ([id, s]) => {
        this.sounds.set(id, { buffers: await Promise.all(s.files.map(decode)), volume: s.volume });
      }),
      ...Object.entries(manifest.music).map(async ([id, m]) => {
        this.music.set(id, { buffers: [await decode(m.file)], volume: m.volume });
      }),
    ]);
    for (const [id, buf] of await renderSynth(ctx.sampleRate)) this.sounds.set(id, { buffers: [buf], volume: 1 });
  }

  /** Settings: 0..1 each. */
  setVolumes(master: number, music: number, sfx: number, voice: number): void {
    if (!this.master) return;
    this.master.gain.value = master;
    this.groups.get('music')!.gain.value = music;
    this.groups.get('sfx')!.gain.value = sfx;
    this.groups.get('ui')!.gain.value = sfx;
    this.groups.get('voice')!.gain.value = voice;
  }

  /** The camera center in game units: world sounds are loud near it. */
  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  /** Plays a sound; with x, y it is a world sound (distance and left / right). */
  play(id: string, group: SoundGroup = 'sfx', x?: number, y?: number, volume = 1): void {
    const ctx = this.ctx;
    const def = this.sounds.get(id);
    if (!ctx || !def || ctx.state !== 'running') return;
    const now = performance.now();
    if ((this.playing.get(id) ?? 0) >= MAX_SAME || this.total >= MAX_TOTAL || now - (this.lastAt.get(id) ?? -1e9) < MIN_GAP_MS) return;
    let gain = def.volume * volume;
    let pan = 0;
    if (x !== undefined && y !== undefined) {
      gain *= distanceGain(Math.hypot(x - this.listenerX, y - this.listenerY));
      pan = panFor(x - this.listenerX);
    }
    if (gain < 0.02) return;
    this.lastAt.set(id, now);
    const src = ctx.createBufferSource();
    src.buffer = def.buffers[Math.floor(Math.random() * def.buffers.length)]!;
    // A little pitch change, so ten hits in a row do not sound like one machine.
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node: AudioNode = src.connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.groups.get(group)!);
    this.playing.set(id, (this.playing.get(id) ?? 0) + 1);
    this.total++;
    src.onended = () => {
      this.playing.set(id, (this.playing.get(id) ?? 1) - 1);
      this.total--;
    };
    src.start();
  }

  /** Loops one music track (fades in); the same track again does nothing. */
  playMusic(id: string): void {
    const ctx = this.ctx;
    const def = this.music.get(id);
    if (!ctx || !def || this.musicId === id) return;
    this.stopMusic();
    const src = ctx.createBufferSource();
    src.buffer = def.buffers[0]!;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(def.volume, ctx.currentTime + 3);
    src.connect(g).connect(this.groups.get('music')!);
    src.start();
    this.musicSource = src;
    this.musicGain = g;
    this.musicId = id;
  }

  /** Fades the music out. */
  stopMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicSource || !this.musicGain) return;
    const src = this.musicSource;
    this.musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    setTimeout(() => src.stop(), 2000);
    this.musicSource = null;
    this.musicGain = null;
    this.musicId = '';
  }
}
