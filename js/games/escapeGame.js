/**
 * EscapeGame — browser fixed version
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js?module";

console.log("🚨 escapeGame.js loaded");

export class EscapeGame {

  constructor(world, agents) {

    this.world = world;

    this.agents = agents;

    this.name = "escape";

    this.active = false;

    this.obstacles = [];

    this.left = {
      score: 0
    };

    this.right = {
      score: 0
    };

    this.time = 0;
  }

  setup() {

    console.log("✅ Escape setup");

    this.active = true;

    this.time = 0;

    this.buildArena();

    this.agents.red.position.set(
      -5,
      0,
      0
    );

    this.agents.blue.position.set(
      5,
      0,
      0
    );
  }

  teardown() {

    this.active = false;

    for (const o of this.obstacles) {

      o.parent?.remove(o);

    }

    this.obstacles = [];
  }

  buildArena() {

    for (let i = 0; i < 15; i++) {

      const obs = new THREE.Mesh(

        new THREE.BoxGeometry(
          1,
          1,
          1
        ),

        new THREE.MeshToonMaterial({
          color: 0xff4444
        })
      );

      obs.position.set(
        (Math.random() - 0.5) * 14,
        0.5,
        (Math.random() - 0.5) * 14
      );

      obs.castShadow = true;

      this.world.scene.add(obs);

      this.obstacles.push(obs);
    }
  }

  step(dt) {

    if (!this.active) return;

    this.time += dt;

    const t = Date.now() * 0.001;

    this.agents.red.moveTo(
      Math.sin(t * 1.3) * 6,
      Math.cos(t * 1.1) * 6
    );

    this.agents.blue.moveTo(
      Math.cos(t * 1.2) * 6,
      Math.sin(t * 1.4) * 6
    );

    for (const o of this.obstacles) {

      o.rotation.x += dt * 0.5;

      o.rotation.y += dt * 0.7;
    }

    if (Math.random() > 0.99) {

      this.left.score++;

      this.agents.red.celebrate("🔥");
    }

    if (Math.random() > 0.99) {

      this.right.score++;

      this.agents.blue.celebrate("⚡");
    }
  }

  getHUD() {

    return `
      <div class="game-hud">

        <h3>🚨 Escape</h3>

        <div>
          Red score:
          <b>${this.left.score}</b>
        </div>

        <div>
          Blue score:
          <b>${this.right.score}</b>
        </div>

        <div>
          Obstacles:
          <b>${this.obstacles.length}</b>
        </div>

      </div>
    `;
  }
}
