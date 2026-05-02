import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js?module";

console.log("🌍 worldGame.js loaded");

export class WorldGame {

  constructor(world, agents) {

    this.world = world;

    this.agents = agents;

    this.active = false;

    this.name = "world";

    this.stars = [];

    this.totalCollected = {
      red: 0,
      blue: 0
    };
  }

  setup() {

    console.log("✅ WorldGame setup");

    this.active = true;

    this.spawnStars(10);
  }

  teardown() {

    console.log("🧹 WorldGame teardown");

    this.active = false;

    for (const s of this.stars) {

      this.world.scene.remove(s);

    }

    this.stars = [];
  }

  spawnStars(n) {

    for (let i = 0; i < n; i++) {

      const star = new THREE.Mesh(

        new THREE.IcosahedronGeometry(0.25),

        new THREE.MeshBasicMaterial({
          color: 0xffdd55
        })
      );

      star.position.set(
        (Math.random() - 0.5) * 12,
        0.5,
        (Math.random() - 0.5) * 12
      );

      this.world.scene.add(star);

      this.stars.push(star);
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

    for (const s of this.stars) {

      s.rotation.y += dt;
    }
  }

  getHUD() {

    return `
      <div style="padding:10px">
        🌍 WORLD RUNNING
      </div>
    `;
  }
}
