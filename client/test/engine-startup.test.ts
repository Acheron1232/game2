import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class Engine {
    static instances: Engine[] = [];
    static failWebGPU = false;
    static failDispose = false;
    static IsSupportedAsync = Promise.resolve(true);
    webGLVersion = 2;
    maxFPS = 0;
    renderEvenInBackground = true;
    setHardwareScalingLevel = vi.fn();
    resize = vi.fn();
    dispose = vi.fn(() => {
      if (Engine.failDispose) throw new Error('No timestamp query resource');
    });
    onDisposeObservable = { addOnce: vi.fn<(callback: () => void) => void>() };
    getInfo = () => ({ vendor: 'NVIDIA', renderer: 'RTX 3060', version: 'test' });
    initAsync = async () => {
      if (Engine.failWebGPU) throw new Error('Device unavailable');
    };
    constructor(...publicArgs: unknown[]) {
      Engine.instances.push(this);
      this.args = publicArgs;
    }
    args: unknown[];
  }
  return { Engine };
});
vi.mock('@babylonjs/core/Engines/engine', () => ({ Engine: mocks.Engine }));
vi.mock('@babylonjs/core/Engines/webgpuEngine', () => ({ WebGPUEngine: mocks.Engine }));

import { createEngine } from '../src/render/engine';

afterEach(() => {
  mocks.Engine.instances.length = 0;
  mocks.Engine.failWebGPU = false;
  mocks.Engine.failDispose = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function environment(search = '') {
  const listeners = new Map<string, () => void>();
  const win = {
    devicePixelRatio: 2,
    addEventListener: (name: string, cb: () => void) => listeners.set(name, cb),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('location', { search });
  return { win, listeners };
}

describe('graphics startup and monitor changes', () => {
  const canvas = {} as HTMLCanvasElement;

  it('requests a performance adapter and optional GPU timings without enabling all features', async () => {
    environment();
    const game = await createEngine(canvas);
    expect(game.kind).toBe('WebGPU');
    expect(game.adapter).toContain('RTX 3060');
    expect(mocks.Engine.instances[0]!.args[1]).toMatchObject({
      antialias: false,
      powerPreference: 'high-performance',
      deviceDescriptor: { requiredFeatures: ['timestamp-query'] },
    });
    expect(mocks.Engine.instances[0]!.setHardwareScalingLevel).toHaveBeenLastCalledWith(0.5);
  });

  it('keeps selected resolution through window resize and a move to another DPR monitor', async () => {
    const { win, listeners } = environment();
    const game = await createEngine(canvas);
    const engine = mocks.Engine.instances[0]!;
    game.setRenderScale(0.8);
    listeners.get('resize')!();
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(0.625);
    win.devicePixelRatio = 1;
    listeners.get('resize')!();
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1.25);
    game.setRenderScale(1);
    expect(engine.setHardwareScalingLevel).toHaveBeenLastCalledWith(1);
    engine.onDisposeObservable.addOnce.mock.calls[0]![0]();
    expect(listeners.has('resize')).toBe(false);
  });

  it('honors the WebGL comparison URL and requests the same adapter priority', async () => {
    environment('?webgl');
    const game = await createEngine(canvas);
    expect(game.kind).toBe('WebGL2');
    expect(mocks.Engine.instances).toHaveLength(1);
    expect(mocks.Engine.instances[0]!.args[2]).toMatchObject({ powerPreference: 'high-performance' });
  });

  it('releases a failed WebGPU engine before starting WebGL', async () => {
    environment();
    mocks.Engine.failWebGPU = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const game = await createEngine(canvas);
    expect(game.kind).toBe('WebGL2');
    expect(mocks.Engine.instances).toHaveLength(2);
    expect(mocks.Engine.instances[0]!.dispose).toHaveBeenCalledOnce();
  });

  it('still starts WebGL if Babylon cannot dispose a partially initialized device', async () => {
    environment();
    mocks.Engine.failWebGPU = true;
    mocks.Engine.failDispose = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await createEngine(canvas)).kind).toBe('WebGL2');
  });
});
