// RTS camera: fixed tilt (about 56 degrees down), moves over the map with the screen edges,
// arrow keys and middle-mouse drag; the wheel zooms in a small range. Movement is smoothed:
// scrolling speeds up and slows down over a short time, and the camera height follows hills
// and ramps softly, so the view never jumps.

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { APRON } from './terrain';

export const TILT = (42 * Math.PI) / 180; // from straight down: the camera looks about 48 degrees down
const BASE_RADIUS = 30;
const ZOOM_MIN = 0.62;
const ZOOM_MAX = 1.25;
const EDGE = 32; // pixels from the screen edge that scroll
/** Over HUD buttons only the last few pixels scroll, so reaching for a button does not move the view. */
const EDGE_OVER_HUD = 6;
const SPEED = 36; // units per second at default zoom
/** How fast scrolling reaches full speed and stops (1/s): about 0.1 s to full speed. */
const PAN_ACCEL = 14;
const PAN_STOP = 18;
/** How fast the view catches up with its goal (1/s). Dragging feels like holding the map. */
const FOLLOW_RATE = 12;
const DRAG_RATE = 35;
/** The ground height under the view changes softly (1/s): cliffs and ramps do not shake it. */
const HEIGHT_RATE = 5;
/** Wheel: zoom factor per pixel of scroll (a mouse notch is about 100 px, a touchpad sends small steps). */
const WHEEL_ZOOM = 0.0008;
/**
 * Screen shake ("trauma"): big blows add to it, it fades by SHAKE_FADE per second, and the view
 * moves by trauma squared (small blows barely move it, big ones clearly do), at most SHAKE_MAX
 * units. Blows far from the view shake it less, beyond SHAKE_FAR not at all.
 */
const SHAKE_FADE = 1.7;
const SHAKE_MAX = 0.45;
const SHAKE_NEAR = 18;
const SHAKE_FAR = 45;

export class RtsCamera {
  readonly camera: ArcRotateCamera;
  /** Game coordinates the camera looks at (x east, y north). */
  target = { x: 96, y: 96 };
  private goal = { x: 96, y: 96 };
  /** scroll velocity (units per second), eased toward what the keys and edges ask for */
  private pan = { x: 0, y: 0 };
  /** smoothed ground height under the view; NaN = take the real one at once */
  private ground = Number.NaN;
  private zoom = 1;
  private zoomGoal = 1;
  private keys = new Set<string>();
  private mouse = { x: -1, y: -1, inside: false, overHud: false };
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
  /** Dev review fields can frame a wider lineup while retaining normal camera controls. */
  baseRadius = BASE_RADIUS;
  /** Set while following a unit (Space twice). */
  follow: (() => { x: number; y: number }) | null = null;
  /** settings: screen shake on big blows */
  shakeEnabled = true;
  private trauma = 0;
  private shakeTime = 0;

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
      this.mouse.overHud = isHudElement(e.target, canvas);
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
        // Lines (Firefox mouse wheels) count as about 33 px; one big jump is capped at a notch or two.
        const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        const step = Math.max(-240, Math.min(240, px));
        this.zoomGoal = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoomGoal * Math.exp(step * WHEEL_ZOOM)));
      },
      { passive: false },
    );
    scene.onBeforeRenderObservable.add(() => this.update(scene.getEngine().getDeltaTime() / 1000));
    this.apply(0);
  }

  /** Jump (or glide when smooth) to a game position. */
  lookAt(x: number, y: number, smooth = false): void {
    this.goal.x = x;
    this.goal.y = y;
    this.clampGoal();
    if (!smooth) {
      this.target.x = this.goal.x;
      this.target.y = this.goal.y;
      this.pan.x = this.pan.y = 0;
      // A jump (minimap, base button) lands at the real height at once.
      this.ground = Number.NaN;
    }
    this.apply(0);
  }

  /** A big blow at game (x, y): the view shakes, `amount` 0..1 (1 = the biggest). */
  shake(amount: number, x: number, y: number): void {
    if (!this.shakeEnabled || !this.enabled) return;
    const d = Math.hypot(x - this.target.x, y - this.target.y);
    const near = d <= SHAKE_NEAR ? 1 : Math.max(0, 1 - (d - SHAKE_NEAR) / (SHAKE_FAR - SHAKE_NEAR));
    this.trauma = Math.min(1, this.trauma + amount * near);
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
      const edge = this.mouse.overHud ? EDGE_OVER_HUD : EDGE;
      if (this.mouse.x < edge) mx -= 1;
      if (this.mouse.x > this.canvas.clientWidth - edge) mx += 1;
      if (this.mouse.y < edge) my += 1;
      if (this.mouse.y > this.canvas.clientHeight - edge) my -= 1;
    }
    let wantX = 0,
      wantY = 0;
    if (mx || my) {
      this.follow = null;
      const speed = (SPEED * this.speedScale * this.zoom) / Math.hypot(mx, my);
      wantX = mx * speed;
      wantY = my * speed;
    }
    // Ease the scroll speed: a short ramp up, a slightly quicker stop.
    const rate = mx || my ? PAN_ACCEL : PAN_STOP;
    const kp = 1 - Math.exp(-dt * rate);
    this.pan.x += (wantX - this.pan.x) * kp;
    this.pan.y += (wantY - this.pan.y) * kp;
    if (Math.abs(this.pan.x) + Math.abs(this.pan.y) < 0.01) this.pan.x = this.pan.y = 0;
    this.goal.x += this.pan.x * dt;
    this.goal.y += this.pan.y * dt;
    if (this.follow) {
      const p = this.follow();
      this.goal.x = p.x;
      this.goal.y = p.y;
    }
    this.clampGoal();
    const k = 1 - Math.exp(-dt * (this.drag ? DRAG_RATE : FOLLOW_RATE));
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.y += (this.goal.y - this.target.y) * k;
    this.zoom += (this.zoomGoal - this.zoom) * (1 - Math.exp(-dt * 10));
    this.apply(dt);
  }

  /** `dt` 0 = place at once (no easing of the ground height). */
  private apply(dt: number): void {
    const h = this.heightAt(this.target.x, this.target.y);
    if (dt <= 0 || Number.isNaN(this.ground)) this.ground = h;
    else this.ground += (h - this.ground) * (1 - Math.exp(-dt * HEIGHT_RATE));
    this.camera.target.set(this.target.x, this.ground, -this.target.y);
    this.camera.radius = this.baseRadius * this.zoom;
    if (this.trauma > 0 && dt > 0) {
      this.trauma = Math.max(0, this.trauma - dt * SHAKE_FADE);
      this.shakeTime += dt;
      // Smooth noise from a few sines: no jitter from frame to frame, no repeat you can see.
      const t = this.shakeTime,
        s = this.trauma * this.trauma * SHAKE_MAX * this.zoom;
      this.camera.target.x += s * (Math.sin(t * 37.3) * 0.6 + Math.sin(t * 23.1 + 1.7) * 0.4);
      this.camera.target.y += s * 0.5 * Math.sin(t * 41.9 + 0.6);
      this.camera.target.z += s * (Math.sin(t * 31.7 + 2.9) * 0.6 + Math.sin(t * 19.3 + 0.3) * 0.4);
    }
  }

  /** Keep the view inside the rendered mountain apron, without locking cameras out of edge bases. */
  private clampGoal(): void {
    const height = this.baseRadius * Math.max(this.zoom, this.zoomGoal) * Math.cos(TILT);
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

/** The pointer is over a HUD element (a button, the console), not over the game view. */
function isHudElement(target: EventTarget | null, canvas: HTMLCanvasElement): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element) || target === canvas) return false;
  // The floating damage numbers layer lies over the whole view but takes no clicks.
  return !target.closest('.floating-layer');
}

/** Game hotkeys never take keys from chat, rebinding controls or editable text. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}
