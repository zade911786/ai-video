/**
 * MazeGame — browser fixed version
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js?module";

console.log("🧭 mazeGame.js loaded");

export class MazeGame {

  constructor(world, agents) {

    this.world = world;

    this.agents = agents;

    this.name = "maze";

    this.active = false;

    this.walls = [];

    this.left = {
      wins: 0
    };

    this.right = {
      wins: 0
    };
  }

  setup() {

    console.log("✅ Maze setup");

    this.active = true;

    this.buildMaze();

    this.agents.red.position.set(
      -6,
      0,
      -6
    );

    this.agents.blue.position.set(
      6,
      0,
      6
    );
  }

  teardown() {

    this.active = false;

    for (const w of this.walls) {

      w.parent?.remove(w);

    }

    this.walls = [];
  }

  buildMaze() {

    for (let i = 0; i < 12; i++) {

      const wall = new THREE.Mesh(

        new THREE.BoxGeometry(
          1,
          2,
          4
        ),

        new THREE.MeshToonMaterial({
          color: 0xaa66ff
        })
      );

      wall.position.set(
        (Math.random() - 0.5) * 12,
        1,
        (Math.random() - 0.5) * 12
      );

      this.world.scene.add(wall);

      this.walls.push(wall);
    }
  }

  step(dt) {

    if (!this.active) return;

    const t = Date.now() * 0.001;

    this.agents.red.moveTo(
      Math.sin(t) * 5,
      Math.cos(t) * 5
    );

    this.agents.blue.moveTo(
      Math.cos(t) * 5,
      Math.sin(t) * 5
    );

    if (Math.random() > 0.995) {

      this.left.wins++;

    }

    if (Math.random() > 0.995) {

      this.right.wins++;

    }
  }

  getHUD() {

    return `
      <div class="game-hud">

        <h3>🧭 Maze</h3>

        <div>
          Red wins:
          <b>${this.left.wins}</b>
        </div>

        <div>
          Blue wins:
          <b>${this.right.wins}</b>
        </div>

      </div>
    `;
  }
}
