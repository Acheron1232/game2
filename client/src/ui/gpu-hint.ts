// Windows hint for PCs that run the game on built-in graphics.
//
// Chrome and Edge on Windows draw every page with one GPU: the one Windows gives the browser
// (usually the built-in chip). WebGPU uses that same adapter and WebGL ignores
// `powerPreference` there, so a page can not pick the NVIDIA/AMD card itself. The browser
// switch `--force-high-performance-gpu` moves the whole browser to that card. The launcher
// starts a separate app window with that switch and its own profile (switches are ignored
// when they are given to a browser that is already running).

import { el, setText } from './dom';
import { S } from './strings';

const HIDE_KEY = 'tw.gpuHintHidden';

/** True when the adapter looks like built-in graphics on Windows. Intel Arc cards are not built in. */
export function isWindowsBuiltInGpu(adapter: string, userAgent: string): boolean {
  if (!/Windows/i.test(userAgent)) return false;
  const a = adapter.toLowerCase();
  if (/\barc\b/.test(a)) return false;
  return /\bintel\b/.test(a) || /radeon\(tm\) graphics|radeon graphics|vega \d+ graphics/.test(a);
}

const BROWSERS = [
  '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
  '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
  '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe',
  '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe',
  '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe',
];

/** A Windows .cmd file that opens `url` in a Chrome or Edge app window on the strong GPU. */
export function windowsLauncherScript(url: string): string {
  if (!/^https?:\/\/[^\s"%&^|<>]+$/.test(url)) throw new Error('Unsafe launcher URL.');
  const lines = [
    '@echo off',
    'rem Temple Wars launcher: opens the game in its own window on the gaming graphics card.',
    `set "URL=${url}"`,
    'set "PROFILE=%LocalAppData%\\TempleWars\\Browser"',
    'set "FLAGS=--force-high-performance-gpu --force_high_performance_gpu --no-first-run --no-default-browser-check --start-maximized"',
    ...BROWSERS.map((path) => `if exist "${path}" (start "" "${path}" --app="%URL%" --user-data-dir="%PROFILE%" %FLAGS% & exit /b 0)`),
    'echo Chrome or Edge was not found. Please install Google Chrome, then start this file again.',
    'pause',
  ];
  return lines.join('\r\n') + '\r\n';
}

function downloadLauncher(): void {
  const url = `${location.origin}/?from=launcher`;
  const blob = new Blob([windowsLauncherScript(url)], { type: 'application/octet-stream' });
  const link = el('a', { href: URL.createObjectURL(blob), download: 'Temple Wars.cmd' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** A small notice for the main menu, or null when it is not needed or was hidden. */
export function createGpuHint(adapter: string): HTMLElement | null {
  if (!isWindowsBuiltInGpu(adapter, navigator.userAgent)) return null;
  const fromLauncher = new URLSearchParams(location.search).get('from') === 'launcher';
  try {
    if (!fromLauncher && localStorage.getItem(HIDE_KEY)) return null;
  } catch {
    // storage blocked: show the hint
  }
  const text = el('p', {});
  setText(text, fromLauncher ? S.gpuHintStill : S.gpuHint);
  const hide = el('button', { class: 'btn tiny', onclick: () => close() }, S.gpuHintHide);
  const node = el(
    'aside',
    { class: 'panel gpu-hint', role: 'note' },
    el('strong', {}, S.gpuHintTitle),
    text,
    el('div', { class: 'row' }, fromLauncher ? null : el('button', { class: 'btn tiny', onclick: downloadLauncher }, S.gpuHintGet), hide),
    fromLauncher ? null : el('p', { class: 'muted' }, S.gpuHintHow),
  );
  node.title = adapter;
  const close = () => {
    node.remove();
    try {
      localStorage.setItem(HIDE_KEY, '1');
    } catch {
      // hidden for this visit only
    }
  };
  return node;
}
