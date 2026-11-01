// Hint for PCs that run the game on built-in graphics (Windows and Linux).
//
// Chrome and Edge on Windows draw every page with one GPU: the one Windows gives the browser
// (usually the built-in chip). WebGPU uses that same adapter and WebGL ignores
// `powerPreference` there, so a page can not pick the NVIDIA/AMD card itself. The browser
// switch `--force-high-performance-gpu` moves the whole browser to that card. The launcher
// starts a separate app window with that switch and its own profile (switches are ignored
// when they are given to a browser that is already running).
//
// Linux laptops with two graphics chips choose the card per program when it starts (PRIME):
// `DRI_PRIME=1` for Mesa drivers (AMD, Intel + AMD), the `__NV_PRIME_RENDER_OFFLOAD` pair for
// NVIDIA. The Linux launcher is a small sh script that starts Chrome or Chromium that way, in
// its own app window and profile like on Windows.

import { el, setText } from './dom';
import { S } from './strings';

const HIDE_KEY = 'tw.gpuHintHidden';

export type LauncherSystem = 'windows' | 'linux';

/** True when the adapter name looks like built-in graphics. Intel Arc cards are not built in. */
function isBuiltInAdapter(adapter: string): boolean {
  const a = adapter.toLowerCase();
  if (/\barc\b/.test(a)) return false;
  return /\bintel\b/.test(a) || /radeon\(tm\) graphics|radeon graphics|vega \d+ graphics/.test(a);
}

/** The system a launcher can help on, when the game runs on built-in graphics there; else null. */
export function builtInGpuSystem(adapter: string, userAgent: string): LauncherSystem | null {
  if (!isBuiltInAdapter(adapter)) return null;
  if (/Windows/i.test(userAgent)) return 'windows';
  // Desktop Linux only: Android and ChromeOS can not run a launcher script.
  if (/Linux/i.test(userAgent) && !/Android|CrOS/i.test(userAgent)) return 'linux';
  return null;
}

/** True when the adapter looks like built-in graphics on Windows. */
export function isWindowsBuiltInGpu(adapter: string, userAgent: string): boolean {
  return builtInGpuSystem(adapter, userAgent) === 'windows';
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

// Program names differ between distributions (Arch: google-chrome-stable from the AUR, brave,
// vivaldi-stable), so the list is long; Flatpak installs have no program in PATH at all.
const LINUX_BROWSERS = [
  'google-chrome',
  'google-chrome-stable',
  'google-chrome-beta',
  'google-chrome-unstable',
  'chromium',
  'chromium-browser',
  'ungoogled-chromium',
  'microsoft-edge',
  'microsoft-edge-stable',
  'brave',
  'brave-browser',
  'vivaldi',
  'vivaldi-stable',
  'thorium-browser',
  // Installed but not linked into PATH (a broken AUR link, a manual unpack).
  '/opt/google/chrome/chrome',
  '/opt/google/chrome-beta/chrome',
  '/opt/chromium/chrome',
  '/opt/brave.com/brave/brave',
  '/opt/brave-bin/brave',
  '/opt/vivaldi/vivaldi',
  '/opt/microsoft/msedge/msedge',
];
const LINUX_FLATPAKS = [
  'com.google.Chrome',
  'org.chromium.Chromium',
  'io.github.ungoogled_software.ungoogled_chromium',
  'com.brave.Browser',
  'com.microsoft.Edge',
  'com.vivaldi.Vivaldi',
];

/**
 * A Linux sh script that opens `url` in a Chrome/Chromium app window on the strong GPU (PRIME).
 * A browser can also be given by hand: sh "Temple Wars.sh" /path/to/browser
 */
export function linuxLauncherScript(url: string): string {
  if (!/^https?:\/\/[^\s'"`$\\;&|<>()]+$/.test(url)) throw new Error('Unsafe launcher URL.');
  const lines = [
    '#!/bin/sh',
    '# Temple Wars launcher: opens the game in its own window on the gaming graphics card.',
    '# Usage: sh "Temple Wars.sh"   or, with your own browser: sh "Temple Wars.sh" /path/to/browser',
    `URL='${url}'`,
    'PROFILE="${XDG_DATA_HOME:-$HOME/.local/share}/TempleWars/Browser"',
    'FLAGS="--no-first-run --no-default-browser-check --start-maximized"',
    '# AMD and Intel + AMD laptops (Mesa drivers).',
    'export DRI_PRIME=1',
    '# NVIDIA laptops (PRIME render offload).',
    'PRIME_ENV="--env=DRI_PRIME=1"',
    'if command -v nvidia-smi >/dev/null 2>&1; then',
    '  export __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia __VK_LAYER_NV_optimus=NVIDIA_only',
    '  PRIME_ENV="$PRIME_ENV --env=__NV_PRIME_RENDER_OFFLOAD=1 --env=__GLX_VENDOR_LIBRARY_NAME=nvidia --env=__VK_LAYER_NV_optimus=NVIDIA_only"',
    'fi',
    'if [ -n "$1" ]; then',
    '  # shellcheck disable=SC2086',
    '  exec "$1" --app="$URL" --user-data-dir="$PROFILE" $FLAGS',
    'fi',
    `for b in ${LINUX_BROWSERS.join(' ')}; do`,
    '  if command -v "$b" >/dev/null 2>&1; then',
    '    # shellcheck disable=SC2086',
    '    exec "$b" --app="$URL" --user-data-dir="$PROFILE" $FLAGS',
    '  fi',
    'done',
    '# Flatpak: the app may write only in its own folder, and gets the graphics settings with --env.',
    'if command -v flatpak >/dev/null 2>&1; then',
    `  for id in ${LINUX_FLATPAKS.join(' ')}; do`,
    '    if flatpak info "$id" >/dev/null 2>&1; then',
    '      # shellcheck disable=SC2086',
    '      exec flatpak run $PRIME_ENV "$id" --app="$URL" --user-data-dir="$HOME/.var/app/$id/data/TempleWars" $FLAGS',
    '    fi',
    '  done',
    'fi',
    `echo "No Chrome-based browser was found (checked: ${LINUX_BROWSERS.join(', ')} and Flatpak)."`,
    'echo "If you have one, start: sh \\"$0\\" /path/to/browser   (for example: sh \\"$0\\" /opt/google/chrome/chrome)"',
  ];
  return lines.join('\n') + '\n';
}

function downloadLauncher(system: LauncherSystem): void {
  const url = `${location.origin}/?from=launcher`;
  const text = system === 'linux' ? linuxLauncherScript(url) : windowsLauncherScript(url);
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const link = el('a', { href: URL.createObjectURL(blob), download: system === 'linux' ? 'Temple Wars.sh' : 'Temple Wars.cmd' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** A small notice for the main menu, or null when it is not needed or was hidden. */
export function createGpuHint(adapter: string): HTMLElement | null {
  const system = builtInGpuSystem(adapter, navigator.userAgent);
  if (!system) return null;
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
    el(
      'div',
      { class: 'row' },
      fromLauncher ? null : el('button', { class: 'btn tiny', onclick: () => downloadLauncher(system) }, S.gpuHintGet),
      hide,
    ),
    fromLauncher ? null : el('p', { class: 'muted' }, system === 'linux' ? S.gpuHintHowLinux : S.gpuHintHow),
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
