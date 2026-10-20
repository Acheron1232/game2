import { describe, expect, it } from 'vitest';
import { actionOf, bindKey, defaultSettings, keyLabel, parseSettings } from '../src/game/settings';

describe('settings', () => {
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
