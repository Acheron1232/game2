import { describe, expect, it } from 'vitest';
import { builtInGpuSystem, isWindowsBuiltInGpu, linuxLauncherScript, windowsLauncherScript } from '../src/ui/gpu-hint';

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36';

describe('Windows built-in graphics hint', () => {
  it('finds Intel and AMD built-in graphics on Windows only', () => {
    expect(isWindowsBuiltInGpu('intel / gen-12lp', WIN)).toBe(true);
    expect(isWindowsBuiltInGpu('Google Inc. (Intel) / ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN)).toBe(
      true,
    );
    expect(isWindowsBuiltInGpu('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN)).toBe(true);
    expect(isWindowsBuiltInGpu('intel / gen-12lp', MAC)).toBe(false);
  });

  it('does not flag gaming cards', () => {
    expect(isWindowsBuiltInGpu('nvidia / ampere', WIN)).toBe(false);
    expect(isWindowsBuiltInGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN)).toBe(false);
    expect(isWindowsBuiltInGpu('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN)).toBe(false);
    expect(isWindowsBuiltInGpu('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', WIN)).toBe(false);
    expect(isWindowsBuiltInGpu('unavailable', WIN)).toBe(false);
  });

  it('writes a launcher that starts an app window with the GPU switch and its own profile', () => {
    const script = windowsLauncherScript('https://game.example.com/?from=launcher');
    expect(script).toContain('set "URL=https://game.example.com/?from=launcher"');
    expect(script).toContain('--force-high-performance-gpu');
    expect(script).toContain('--user-data-dir="%PROFILE%"');
    expect(script).toContain('--app="%URL%"');
    expect(script).toContain('msedge.exe');
    expect(script.split('\r\n').every((line) => !line.includes('\n'))).toBe(true);
  });

  it('refuses URLs that could break out of the script', () => {
    expect(() => windowsLauncherScript('https://x.com/" & calc & "')).toThrow();
    expect(() => windowsLauncherScript('https://x.com/%PATH%')).toThrow();
    expect(() => windowsLauncherScript('javascript:alert(1)')).toThrow();
  });

  it('finds built-in graphics on desktop Linux too, not on Android or Mac', () => {
    expect(builtInGpuSystem('Mesa Intel(R) UHD Graphics 620 (KBL GT2)', LINUX)).toBe('linux');
    expect(builtInGpuSystem('AMD Radeon Graphics (radeonsi, renoir, LLVM 17.0.6, DRM 3.54)', LINUX)).toBe('linux');
    expect(builtInGpuSystem('NVIDIA GeForce RTX 3060/PCIe/SSE2', LINUX)).toBe(null);
    expect(builtInGpuSystem('intel / gen-12lp', ANDROID)).toBe(null);
    expect(builtInGpuSystem('intel / gen-12lp', MAC)).toBe(null);
    expect(builtInGpuSystem('intel / gen-12lp', WIN)).toBe('windows');
  });

  it('writes a Linux launcher with the PRIME switches, its own profile and an app window', () => {
    const script = linuxLauncherScript('https://game.example.com/?from=launcher');
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain("URL='https://game.example.com/?from=launcher'");
    expect(script).toContain('export DRI_PRIME=1');
    expect(script).toContain('__NV_PRIME_RENDER_OFFLOAD=1');
    expect(script).toContain('--app="$URL"');
    expect(script).toContain('--user-data-dir="$PROFILE"');
    expect(script).not.toContain('\r');
    expect(() => linuxLauncherScript("https://x.com/'; rm -rf ~; '")).toThrow();
    expect(() => linuxLauncherScript('https://x.com/$(id)')).toThrow();
    expect(() => linuxLauncherScript('https://x.com/`id`')).toThrow();
  });
});
