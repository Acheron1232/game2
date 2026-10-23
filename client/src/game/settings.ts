// Player settings (UI.md section 8), kept in this browser (localStorage). Plain data plus key
// binds; main.ts applies them to the engine, camera, HUD and input.

import { GAME_FPS } from '../render/render-budget';

export const MIN_FPS = 10;
export const MAX_FPS = 500;
export function normalizeFps(value: number, fallback = GAME_FPS): number {
  return Number.isFinite(value) ? Math.round(Math.min(MAX_FPS, Math.max(MIN_FPS, value))) : fallback;
}

export type Quality = 'low' | 'medium' | 'high';

/** Actions a key can be bound to. */
export const ACTIONS = [
  'ability1',
  'ability2',
  'ability3',
  'ability4',
  'ability5',
  'ability6',
  'item1',
  'item2',
  'item3',
  'item4',
  'item5',
  'item6',
  'attack',
  'stop',
  'hold',
  'hero',
] as const;
export type Action = (typeof ACTIONS)[number];

export interface Settings {
  quality: Quality;
  /** 0.5 .. 1 of the native resolution */
  renderScale: number;
  shadows: boolean;
  effects: 'low' | 'high';
  showFps: boolean;
  fpsLimit: number;
  /** 0 .. 1 */
  master: number;
  music: number;
  sfx: number;
  voice: number;
  /** cast at the mouse at once, no aiming click */
  quickCast: boolean;
  edgeScroll: boolean;
  /** 0.5 .. 2 */
  cameraSpeed: number;
  damageNumbers: boolean;
  healthBars: 'always' | 'hurt';
  /** action -> KeyboardEvent.code */
  keys: Record<Action, string>;
}

export const DEFAULT_KEYS: Record<Action, string> = {
  ability1: 'KeyQ',
  ability2: 'KeyW',
  ability3: 'KeyE',
  ability4: 'KeyR',
  ability5: 'KeyD',
  ability6: 'KeyF',
  item1: 'Digit1',
  item2: 'Digit2',
  item3: 'Digit3',
  item4: 'Digit4',
  item5: 'Digit5',
  item6: 'Digit6',
  attack: 'KeyA',
  stop: 'KeyS',
  hold: 'KeyH',
  hero: 'Space',
};

/** The other item key row from UI.md: Z X C V B N. */
export const ITEM_KEYS_LETTERS = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN'];

/** What each quality preset sets (the player can still change single options after). */
export const QUALITY_PRESETS: Record<Quality, Pick<Settings, 'renderScale' | 'shadows' | 'effects'>> = {
  low: { renderScale: 0.6, shadows: false, effects: 'low' },
  medium: { renderScale: 0.8, shadows: true, effects: 'low' },
  high: { renderScale: 1, shadows: true, effects: 'high' },
};

export function defaultSettings(): Settings {
  return {
    quality: 'high',
    ...QUALITY_PRESETS.high,
    showFps: true,
    fpsLimit: GAME_FPS,
    master: 0.8,
    music: 0,
    sfx: 0.8,
    voice: 0.8,
    quickCast: false,
    edgeScroll: true,
    cameraSpeed: 1,
    damageNumbers: true,
    healthBars: 'hurt',
    keys: { ...DEFAULT_KEYS },
  };
}

const STORE_KEY = 'tw-settings';
const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Reads saved settings; anything missing or broken falls back to the default. */
export function parseSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const keys = { ...DEFAULT_KEYS };
  const rk = r['keys'];
  if (rk && typeof rk === 'object')
    for (const a of ACTIONS) {
      const k = (rk as Record<string, unknown>)[a];
      if (typeof k === 'string' && k.length <= 24) keys[a] = k;
    }
  return {
    quality: pick(r['quality'], ['low', 'medium', 'high'], d.quality),
    renderScale: clamp(r['renderScale'], 0.5, 1, d.renderScale),
    shadows: bool(r['shadows'], d.shadows),
    effects: pick(r['effects'], ['low', 'high'], d.effects),
    showFps: bool(r['showFps'], d.showFps),
    fpsLimit: typeof r['fpsLimit'] === 'number' ? normalizeFps(r['fpsLimit']) : d.fpsLimit,
    master: clamp(r['master'], 0, 1, d.master),
    music: r['soundVersion'] === 2 ? clamp(r['music'], 0, 1, d.music) : 0,
    sfx: clamp(r['sfx'], 0, 1, d.sfx),
    voice: clamp(r['voice'], 0, 1, d.voice),
    quickCast: bool(r['quickCast'], d.quickCast),
    edgeScroll: bool(r['edgeScroll'], d.edgeScroll),
    cameraSpeed: clamp(r['cameraSpeed'], 0.5, 2, d.cameraSpeed),
    damageNumbers: bool(r['damageNumbers'], d.damageNumbers),
    healthBars: pick(r['healthBars'], ['always', 'hurt'], d.healthBars),
    keys,
  };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...s, soundVersion: 2 }));
  } catch {
    // private window or full storage: the settings still work for this visit
  }
}

/** The action bound to a key, or null. */
export function actionOf(s: Settings, code: string): Action | null {
  for (const a of ACTIONS) if (s.keys[a] === code) return a;
  return null;
}

/** "KeyQ" -> "Q", "Digit1" -> "1", "Space" -> "Space". */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** Binds a key to an action; an action that had this key before gets the old key of this one. */
export function bindKey(s: Settings, action: Action, code: string): void {
  const other = actionOf(s, code);
  if (other && other !== action) s.keys[other] = s.keys[action];
  s.keys[action] = code;
}
