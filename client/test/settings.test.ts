import { describe, expect, it } from 'vitest';
import { actionOf, bindKey, defaultSettings, keyLabel, normalizeFps, parseSettings } from '../src/game/settings';

describe('settings', () => {
  it('defaults old settings to 120 FPS and validates saved custom limits', () => {
    expect(parseSettings({}).fpsLimit).toBe(120);
    expect(parseSettings({ fpsLimit: 165 }).fpsLimit).toBe(165);
    expect(parseSettings({ fpsLimit: Infinity }).fpsLimit).toBe(120);
    expect(parseSettings({ fpsLimit: 'bad' }).fpsLimit).toBe(120);
    expect(normalizeFps(0)).toBe(10);
    expect(normalizeFps(900)).toBe(500);
    expect(normalizeFps(144.4)).toBe(144);
    expect(normalizeFps(NaN, 90)).toBe(90);
  });
  it('starts silent, migrates old loud music once, and keeps an explicit new choice', () => {
    expect(defaultSettings().music).toBe(0);
    expect(parseSettings({ music: 0.6 }).music).toBe(0);
    expect(parseSettings({ soundVersion: 2, music: 0.15 }).music).toBe(0.15);
  });
  it('fills missing or broken values with defaults', () => {
    const s = parseSettings({ quality: 'ultra', renderScale: 9, shadows: 'yes', master: 0.3, keys: { ability1: 'KeyZ', nope: 'KeyY' } });
    expect(s.quality).toBe('high');
    expect(s.renderScale).toBe(1);
    expect(s.shadows).toBe(true);
    expect(s.master).toBe(0.3);
    expect(s.keys.ability1).toBe('KeyZ');
    expect(s.keys.stop).toBe('KeyS');
    expect(parseSettings(null)).toEqual(defaultSettings());
  });

  it('binding a used key swaps the two actions', () => {
    const s = defaultSettings();
    bindKey(s, 'ability1', 'KeyS');
    expect(s.keys.ability1).toBe('KeyS');
    expect(s.keys.stop).toBe('KeyQ');
    expect(actionOf(s, 'KeyS')).toBe('ability1');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('KeyQ')).toBe('Q');
  });
});
