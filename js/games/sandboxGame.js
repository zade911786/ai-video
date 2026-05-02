/**
 * SandboxGame — browser fixed version
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js?module";

console.log("🧱 sandboxGame.js loaded");

export class SandboxGame {

  constructor(world, agents) {

    this.world = world;

    this.agents = agents;

    this.name = "sandbox";

    this.active = false;

    this.blocks = [];

    this.placed = {
      red: 0,
      blue: 0
    };

    this.spawnTimer = 0;
  }

  setup() {

    console.log("✅ Sandbox setup");

    this.active = true;

    this.spawnBlocks(20);

    this.agents.red.position.set(
      -4,
      0,
      0
    );

    this.agents.blue.position.set(
      4,
      0,
      0
    );
  }

  teardown() {

    this.active = false;

    for (const b of this.blocks) {

      b.parent?.remove(b);

    }

    this.blocks = [];
  }

  spawnBlocks(n) {

    for (let i = 0; i < n; i++) {

      this.spawnBlock();

    }
  }

  spawnBlock() {

    const cube = new THREE.Mesh(

      new THREE.BoxGeometry(
        0.8,
        0.8,
        0.8
      ),

      new THREE.MeshToonMaterial({
        color:
          Math.random() > 0.5
            ? 0xff6688
            : 0x66ccff
      })
    );

    cube.castShadow = true;

    cube.position.set(
      (Math.random() - 0.5) * 10,
      Math.random() * 3 + 1,
      (Math.random() - 0.5) * 10
    );

    this.world.scene.add(cube);

    this.blocks.push(cube);
  }

  step(dt) {

    if (!this.active) return;

    this.spawnTimer += dt;

    const t = Date.now() * 0.001;

    this.agents.red.moveTo(
      Math.sin(t) * 4,
      Math.cos(t) * 4
    );

    this.agents.blue.moveTo(
      Math.cos(t) * 4,
      Math.sin(t) * 4
    );

    for (const cube of this.blocks) {

      cube.rotation.x += dt;

      cube.rotation.y += dt * 1.2;
    }

    if (this.spawnTimer > 3) {

      this.spawnTimer = 0;

      this.spawnBlock();

      this.placed.red++;

      this.placed.blue++;
    }
  }

  getHUD() {

    return `
      <div class="game-hud">

        <h3>🧱 Sandbox</h3>

        <div>
          Red placed:
          <b>${this.placed.red}</b>
        </div>

        <div>
          Blue placed:
          <b>${this.placed.blue}</b>
        </div>

        <div>
          Cubes:
          <b>${this.blocks.length}</b>
        </div>

      </div>
    `;
  }
}
