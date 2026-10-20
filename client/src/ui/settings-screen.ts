// Settings screen (UI.md section 8): Graphics, Sound, Controls, Game. Changes apply at once
// (onChange) and are saved in this browser. "Back" returns to the screen it came from.

import { ACTIONS, bindKey, DEFAULT_KEYS, keyLabel, QUALITY_PRESETS, type Action, type Quality, type Settings } from '../game/settings';
import { el } from './dom';
import type { Screen } from './router';
import { toggleFullScreen } from './screens';
import { createInstallControls } from './install-controls';
import { S } from './strings';

export interface SettingsScreen extends Screen {
  /** Where "Back" goes. */
  backTo: () => void;
}

type Row = HTMLElement;

export function createSettingsScreen(settings: Settings, onChange: (s: Settings) => void): SettingsScreen {
  const changed = () => onChange(settings);
  const refresh: (() => void)[] = [];

  const row = (label: string, control: HTMLElement): Row => el('label', { class: 'set-row' }, el('span', {}, label), control);
  const select = <T extends string>(options: readonly [T, string][], get: () => T, set: (v: T) => void) => {
    const s = el('select', {}, ...options.map(([v, t]) => el('option', { value: v }, t)));
    s.addEventListener('change', () => {
      set(s.value as T);
      changed();
      for (const r of refresh) r();
    });
    refresh.push(() => (s.value = get()));
    return s;
  };
  const toggle = (get: () => boolean, set: (v: boolean) => void) => {
    const c = el('input', { type: 'checkbox' });
    c.addEventListener('change', () => {
      set(c.checked);
      changed();
      for (const r of refresh) r();
    });
    refresh.push(() => (c.checked = get()));
    return c;
  };
  const slider = (min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
    const r = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const out = el('span', { class: 'set-value' });
    r.addEventListener('input', () => {
      set(Number(r.value));
      out.textContent = fmt(Number(r.value));
      changed();
    });
    refresh.push(() => {
      r.value = String(get());
      out.textContent = fmt(get());
    });
    return el('span', { class: 'set-slider' }, r, out);
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  // Key binds: click a button, then press the new key (Escape keeps the old one).
  let waiting: { action: Action; button: HTMLButtonElement } | null = null;
  const keyButtons = new Map<Action, HTMLButtonElement>();
  const keyRow = (action: Action) => {
    const b = el('button', { class: 'key-bind' });
    b.addEventListener('click', () => {
      if (waiting) waiting.button.classList.remove('waiting');
      waiting = { action, button: b };
      b.classList.add('waiting');
      b.textContent = S.pressKey;
    });
    keyButtons.set(action, b);
    return row(S.actionNames[action] ?? action, b);
  };
  window.addEventListener(
    'keydown',
    (e) => {
      if (!waiting || root.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        bindKey(settings, waiting.action, e.code);
        changed();
      }
      waiting.button.classList.remove('waiting');
      waiting = null;
      for (const r of refresh) r();
    },
    true,
  );
  refresh.push(() => {
    for (const [a, b] of keyButtons) if (!waiting || waiting.action !== a) b.textContent = keyLabel(settings.keys[a]);
  });

  const section = (title: string, ...rows: Row[]) => el('section', { class: 'set-section' }, el('h3', {}, title), ...rows);

  const back = el('button', { class: 'btn', onclick: () => screen.backTo() }, S.back);
  const resetKeys = el(
    'button',
    {
      class: 'btn small',
      onclick: () => {
        settings.keys = { ...DEFAULT_KEYS };
        changed();
        for (const r of refresh) r();
      },
    },
    S.resetKeys,
  );

  const fullScreen = el('button', { class: 'btn small', onclick: toggleFullScreen }, 'Enter full screen');
  const refreshFullscreen = () => {
    fullScreen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Enter full screen';
    fullScreen.setAttribute('aria-label', fullScreen.textContent);
  };
  document.addEventListener('fullscreenchange', refreshFullscreen);
  refresh.push(refreshFullscreen);

  const root = el(
    'section',
    { class: 'screen settings' },
    el(
      'div',
      { class: 'panel ornate settings-panel' },
      el('h1', { class: 'title' }, S.settings),
      el(
        'div',
        { class: 'set-columns' },
        el(
          'div',
          {},
          section(
            S.graphics,
            row('Display', fullScreen),
            row(
              S.quality,
              select<Quality>(
                [
                  ['low', S.low],
                  ['medium', S.medium],
                  ['high', S.high],
                ],
                () => settings.quality,
                (v) => Object.assign(settings, { quality: v }, QUALITY_PRESETS[v]),
              ),
            ),
            row(
              S.renderScale,
              slider(
                0.5,
                1,
                0.05,
                () => settings.renderScale,
                (v) => (settings.renderScale = v),
                pct,
              ),
            ),
            row(
              S.shadows,
              toggle(
                () => settings.shadows,
                (v) => (settings.shadows = v),
              ),
            ),
            row(
              S.effects,
              select(
                [
                  ['low', S.low],
                  ['high', S.high],
                ] as const,
                () => settings.effects,
                (v) => (settings.effects = v),
              ),
            ),
            row(
              S.showFps,
              toggle(
                () => settings.showFps,
                (v) => (settings.showFps = v),
              ),
            ),
          ),
          section(
            S.sound,
            row(
              S.master,
              slider(
                0,
                1,
                0.05,
                () => settings.master,
                (v) => (settings.master = v),
                pct,
              ),
            ),
            row(
              S.music,
              slider(
                0,
                1,
                0.05,
                () => settings.music,
                (v) => (settings.music = v),
                pct,
              ),
            ),
            row(
              S.sfx,
              slider(
                0,
                1,
                0.05,
                () => settings.sfx,
                (v) => (settings.sfx = v),
                pct,
              ),
            ),
            row(
              S.voiceAlerts,
              slider(
                0,
                1,
                0.05,
                () => settings.voice,
                (v) => (settings.voice = v),
                pct,
              ),
            ),
          ),
          section(
            S.gameSection,
            row(
              S.damageNumbers,
              toggle(
                () => settings.damageNumbers,
                (v) => (settings.damageNumbers = v),
              ),
            ),
            row(
              S.healthBars,
              select(
                [
                  ['hurt', S.whenHurt],
                  ['always', S.always],
                ] as const,
                () => settings.healthBars,
                (v) => (settings.healthBars = v),
              ),
            ),
          ),
        ),
        el(
          'div',
          {},
          section(
            S.controls,
            el(
              'p',
              { class: 'control-help' },
              'Camera: arrow keys, screen edges, middle-mouse drag or Alt + left drag. Space: center hero; twice: follow. Drag works inside a browser window.',
            ),
            createInstallControls(),
            row(
              S.quickCast,
              toggle(
                () => settings.quickCast,
                (v) => (settings.quickCast = v),
              ),
            ),
            row(
              S.edgeScroll,
              toggle(
                () => settings.edgeScroll,
                (v) => (settings.edgeScroll = v),
              ),
            ),
            row(
              S.cameraSpeed,
              slider(
                0.5,
                2,
                0.1,
                () => settings.cameraSpeed,
                (v) => (settings.cameraSpeed = v),
                (v) => `×${v.toFixed(1)}`,
              ),
            ),
            ...ACTIONS.map(keyRow),
            el('div', { class: 'row' }, resetKeys),
          ),
        ),
      ),
      el('div', { class: 'row' }, back),
    ),
  );

  const screen: SettingsScreen = {
    root,
    backTo: () => {},
    onShow() {
      for (const r of refresh) r();
    },
  };
  return screen;
}
