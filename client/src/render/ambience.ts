// Life in the air around the camera: pollen and fireflies that drift in the light, and a few
// leaves that fall and turn. Two small particle systems that follow the view (about 120
// particles in all), so the cost does not grow with the map.

import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import type { Scene } from '@babylonjs/core/scene';
import { fxTexture } from './fx-textures';

export class Ambience {
  private readonly systems: ParticleSystem[] = [];
  private readonly at = new Vector3();

  constructor(scene: Scene) {
    // Pollen and fireflies: tiny warm lights that float up and wander.
    const motes = new ParticleSystem('ambient-motes', 90, scene);
    motes.particleTexture = fxTexture(scene, 'glow');
    motes.blendMode = ParticleSystem.BLENDMODE_ADD;
    motes.emitter = this.at;
    motes.minEmitBox = new Vector3(-30, 0.4, -22);
    motes.maxEmitBox = new Vector3(30, 3.2, 22);
    motes.color1 = new Color4(1, 0.92, 0.55, 0.9);
    motes.color2 = new Color4(0.75, 1, 0.5, 0.8);
    motes.colorDead = new Color4(1, 0.9, 0.5, 0);
    motes.addColorGradient(0, new Color4(1, 0.95, 0.6, 0));
    motes.addColorGradient(0.2, new Color4(1, 0.92, 0.55, 0.85));
    motes.addColorGradient(0.8, new Color4(0.8, 1, 0.55, 0.75));
    motes.addColorGradient(1, new Color4(0.8, 1, 0.55, 0));
    motes.minSize = 0.07;
    motes.maxSize = 0.16;
    motes.minLifeTime = 4;
    motes.maxLifeTime = 8;
    motes.emitRate = 14;
    motes.direction1 = new Vector3(-0.25, 0.08, -0.25);
    motes.direction2 = new Vector3(0.25, 0.25, 0.25);
    motes.minEmitPower = 0.3;
    motes.maxEmitPower = 0.7;
    motes.gravity = new Vector3(0, 0.02, 0);
    motes.updateSpeed = 1 / 60;
    motes.preWarmCycles = 200;
    motes.preWarmStepOffset = 4;
    this.systems.push(motes);

    // A few falling leaves that turn as they fall.
    const leaves = new ParticleSystem('ambient-leaves', 40, scene);
    leaves.particleTexture = fxTexture(scene, 'leaf');
    leaves.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    leaves.emitter = this.at;
    leaves.minEmitBox = new Vector3(-32, 7, -24);
    leaves.maxEmitBox = new Vector3(32, 10, 24);
    leaves.color1 = new Color4(0.85, 0.55, 0.2, 1);
    leaves.color2 = new Color4(0.55, 0.65, 0.22, 1);
    leaves.colorDead = new Color4(0.6, 0.45, 0.2, 0);
    leaves.minSize = 0.16;
    leaves.maxSize = 0.3;
    leaves.minLifeTime = 7;
    leaves.maxLifeTime = 10;
    leaves.emitRate = 3.5;
    leaves.direction1 = new Vector3(0.6, -0.4, 0.2);
    leaves.direction2 = new Vector3(1.2, -0.7, -0.2);
    leaves.minEmitPower = 0.6;
    leaves.maxEmitPower = 1;
    leaves.gravity = new Vector3(0, -0.12, 0);
    leaves.minAngularSpeed = -2.5;
    leaves.maxAngularSpeed = 2.5;
    leaves.updateSpeed = 1 / 60;
    leaves.preWarmCycles = 300;
    leaves.preWarmStepOffset = 4;
    this.systems.push(leaves);

    for (const ps of this.systems) ps.start();
  }

  /** Every frame: the air moves with the view (world position of the camera target). */
  follow(x: number, y: number, z: number): void {
    this.at.set(x, y, z);
  }

  setEnabled(on: boolean): void {
    for (const ps of this.systems) {
      if (on && !ps.isStarted()) ps.start();
      else if (!on && ps.isStarted()) ps.stop();
    }
  }
}
