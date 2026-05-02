/**
 * FlappyGame — browser fixed version
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js?module";

console.log("🐦 flappyGame.js loaded");

export class FlappyGame {

  constructor(world, agents) {

    this.world = world;

    this.agents = agents;

    this.active = false;

    this.name = "flappy";

    this.pipes = [];

    this.best = {
      red: 0,
      blue: 0
    };

    this.time = 0;
  }

  setup() {

    console.log("✅ Flappy setup");

    this.active = true;

    this.time = 0;

    this.agents.red.position.set(
      -2,
      2,
      0
    );

    this.agents.blue.position.set(
      2,
      2,
      0
    );

    this.spawnPipe();
  }

  teardown() {

    this.active = false;

    for (const p of this.pipes) {

      p.parent?.remove(p);

    }

    this.pipes = [];
  }

  spawnPipe() {

    const pipe =
      new THREE.Mesh(

        new THREE.BoxGeometry(
          1,
          4,
          1
        ),

        new THREE.MeshToonMaterial({
          color: 0x55ff88
        })
      );

    pipe.position.set(
      8,
      Math.random() * 4,
      0
    );

    this.world.scene.add(pipe);

    this.pipes.push(pipe);
  }

  step(dt) {

    if (!this.active) return;

    this.time += dt;

    for (const pipe of this.pipes) {

      pipe.position.x -= dt * 4;

    }

    if (
      this.time > 2
    ) {

      this.time = 0;

      this.spawnPipe();
    }

    this.agents.red.moveTo3(
      -2,
      2 + Math.sin(Date.now()*0.003),
      0
    );

    this.agents.blue.moveTo3(
      2,
      2 + Math.cos(Date.now()*0.003),
      0
    );

    this.best.red++;

    this.best.blue++;
  }

  getHUD() {

    return `
      <div class="game-hud">
        <h3>🐦 Flappy</h3>

        <div>
          Red:
          <b>${this.best.red}</b>
        </div>

        <div>
          Blue:
          <b>${this.best.blue}</b>
        </div>
      </div>
    `;
  }
}
