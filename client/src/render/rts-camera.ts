// RTS camera: fixed tilt (about 56 degrees down), moves over the map with the screen edges,
// arrow keys and middle-mouse drag; the wheel zooms in a small range. Movement is smoothed.

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { APRON } from './terrain';

export const TILT = (42 * Math.PI) / 180; // from straight down: the camera looks about 48 degrees down
const BASE_RADIUS = 30;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.25;
const EDGE = 32; // pixels from the screen edge that scroll
const SPEED = 36; // units per second at default zoom

export class RtsCamera {
  readonly camera: ArcRotateCamera;
  /** Game coordinates the camera looks at (x east, y north). */
  target = { x: 96, y: 96 };
  private goal = { x: 96, y: 96 };
  private zoom = 1;
  private zoomGoal = 1;
  private keys = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false };
  private drag: { x: number; y: number; tx: number; ty: number } | null = null;
  private active = true;
  get enabled(): boolean {
    return this.active;
  }
  set enabled(value: boolean) {
    this.active = value;
    if (!value) {
      this.keys.clear();
      this.mouse.inside = false;
      this.drag = null;
      globalThis.document?.body?.classList.remove('camera-dragging');
    }
  }
  get dragging(): boolean {
    return this.drag !== null;
  }
  edgeScroll = true;
  /** settings: camera speed multiplier */
  speedScale = 1;
  /** Set while following a unit (Space twice). */
  follow: (() => { x: number; y: number }) | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    private readonly heightAt: (x: number, y: number) => number,
    private readonly mapSize: number,
  ) {
    // Right-handed scene, north is -z: alpha = +90 degrees puts the camera south of the target.
    this.camera = new ArcRotateCamera('rts', Math.PI / 2, TILT, BASE_RADIUS, Vector3.Zero(), scene);
    this.camera.minZ = 1;
    this.camera.maxZ = 400;
    this.camera.fov = 0.78;
    this.camera.inputs.clear();
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || isTextEntry(e.target)) return;
      if (e.key.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.inside = false;
      this.drag = null;
      globalThis.document?.body?.classList.remove('camera-dragging');
    });
    // HUD panels cover the top and bottom edges. Track them too, not just the canvas.
    window.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) * canvas.clientWidth) / Math.max(1, rect.width);
      this.mouse.y = ((e.clientY - rect.top) * canvas.clientHeight) / Math.max(1, rect.height);
      this.mouse.inside = this.mouse.x >= 0 && this.mouse.y >= 0 && this.mouse.x < canvas.clientWidth && this.mouse.y < canvas.clientHeight;
      if (this.drag && this.enabled) {
        const k = (this.camera.radius / canvas.clientHeight) * 1.6;
        if (globalThis.document?.pointerLockElement === canvas) {
          this.goal.x -= e.movementX * k;
          this.goal.y += e.movementY * k;
        } else {
          this.goal.x = this.drag.tx - (e.clientX - this.drag.x) * k;
          this.goal.y = this.drag.ty + (e.clientY - this.drag.y) * k;
        }
      }
    });
    window.addEventListener('pointerout', (e) => {
      if (e.relatedTarget === null) this.mouse.inside = false;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (this.enabled && (e.button === 1 || (e.button === 0 && e.altKey))) {
        e.preventDefault();
        if (!globalThis.document?.pointerLockElement) canvas.setPointerCapture?.(e.pointerId);
        globalThis.document?.body?.classList.add('camera-dragging');
        this.drag = { x: e.clientX, y: e.clientY, tx: this.goal.x, ty: this.goal.y };
        this.follow = null;
      }
    });
    const endDrag = () => {
      this.drag = null;
      globalThis.document?.body?.classList.remove('camera-dragging');
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.enabled) return;
        this.zoomGoal = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoomGoal * (e.deltaY > 0 ? 1.08 : 0.93)));
      },
      { passive: false },
    );
    scene.onBeforeRenderObservable.add(() => this.update(scene.getEngine().getDeltaTime() / 1000));
    this.apply();
  }

  /** Jump (or glide when smooth) to a game position. */
  lookAt(x: number, y: number, smooth = false): void {
    this.goal.x = x;
    this.goal.y = y;
    this.clampGoal();
    if (!smooth) {
      this.target.x = this.goal.x;
      this.target.y = this.goal.y;
    }
    this.apply();
  }

  private update(dt: number): void {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.1);
    let mx = 0,
      my = 0;
    if (this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('ArrowDown')) my -= 1;
    if (this.edgeScroll && this.mouse.inside && !this.drag) {
      if (this.mouse.x < EDGE) mx -= 1;
      if (this.mouse.x > this.canvas.clientWidth - EDGE) mx += 1;
      if (this.mouse.y < EDGE) my += 1;
      if (this.mouse.y > this.canvas.clientHeight - EDGE) my -= 1;
    }
    if (mx || my) {
      this.follow = null;
      const length = Math.hypot(mx, my);
      this.goal.x += (mx / length) * SPEED * this.speedScale * this.zoom * dt;
      this.goal.y += (my / length) * SPEED * this.speedScale * this.zoom * dt;
    }
    if (this.follow) {
      const p = this.follow();
      this.goal.x = p.x;
      this.goal.y = p.y;
    }
    this.clampGoal();
    const k = 1 - Math.exp(-dt * 12);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.y += (this.goal.y - this.target.y) * k;
    this.zoom += (this.zoomGoal - this.zoom) * (1 - Math.exp(-dt * 10));
    this.apply();
  }

  private apply(): void {
    const h = this.heightAt(this.target.x, this.target.y);
    this.camera.target.set(this.target.x, h, -this.target.y);
    this.camera.radius = BASE_RADIUS * this.zoom;
  }

  /** Keep the view inside the rendered mountain apron, without locking cameras out of edge bases. */
  private clampGoal(): void {
    const height = BASE_RADIUS * Math.max(this.zoom, this.zoomGoal) * Math.cos(TILT);
    const halfFov = this.camera.fov / 2;
    const north = height * (Math.tan(TILT + halfFov) - Math.tan(TILT));
    const south = height * (Math.tan(TILT) - Math.tan(TILT - halfFov));
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const side = (height * Math.tan(halfFov) * aspect) / (Math.cos(TILT) - Math.sin(TILT) * Math.tan(halfFov));
    const px = Math.min(this.mapSize / 2, Math.max(8, side + 2 - APRON));
    const pn = Math.min(this.mapSize / 2, Math.max(8, north + 2 - APRON));
    const ps = Math.min(this.mapSize / 2, Math.max(8, south + 2 - APRON));
    this.goal.x = Math.max(px, Math.min(this.mapSize - px, this.goal.x));
    this.goal.y = Math.max(ps, Math.min(this.mapSize - pn, this.goal.y));
  }
}

/** Game hotkeys never take keys from chat, rebinding controls or editable text. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}
