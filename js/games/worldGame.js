/**
 * WorldGame 3.0 — FIXED VERSION FOR VERCEL/MOBILE
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js?module";

console.log("🌍 worldGame.js loaded");

export class WorldGame {

  constructor(world, agents) {

    this.world = world;

    this.agents = agents;

    this.name = "world";

    this.active = false;

    this.tick = 0;

    this.stars = [];

    this.totalCollected = {
      red: 0,
      blue: 0
    };

    this.objects = [];
  }

  setup() {

    console.log("✅ WorldGame setup");

    this.active = true;

    this.agents.red.moveTo(-3, 0);

    this.agents.blue.moveTo(3, 0);

    this.spawnStars(10);
  }

  teardown() {

    console.log("🧹 WorldGame teardown");

    this.active = false;

    for (const s of this.stars) {

      s.parent?.remove(s);

    }

    this.stars = [];

    this.objects = [];
  }

  add(obj) {

    obj.userData.gameObj = true;

    this.world.scene.add(obj);

    this.objects.push(obj);
  }

  spawnStars(n) {

    for (let i = 0; i < n; i++) {

      this.spawnStar();

    }
  }

  spawnStar() {

    const g = new THREE.Group();

    const star = new THREE.Mesh(

      new THREE.IcosahedronGeometry(
        0.25,
        0
      ),

      new THREE.MeshToonMaterial({
        color: 0xffe066,
        emissive: 0xffaa00,
        emissiveIntensity: 0.6
      })
    );

    star.castShadow = true;

    g.add(star);

    const halo = new THREE.Mesh(

      new THREE.RingGeometry(
        0.35,
        0.5,
        20
      ),

      new THREE.MeshBasicMaterial({
        color: 0xfff2aa,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
      })
    );

    halo.rotation.x = -Math.PI / 2;

    halo.position.y = 0.05;

    g.add(halo);

    g.position.set(
      (Math.random() - 0.5) * 14,
      0.4,
      (Math.random() - 0.5) * 14
    );

    g.userData.star = true;

    this.add(g);

    this.stars.push(g);
  }

  step(dt) {

    if (!this.active) return;

    this.tick++;

    const t = performance.now() * 0.001;

    // simple AI movement
    this.agents.red.moveTo(
      Math.sin(t) * 5,
      Math.cos(t) * 5
    );

    this.agents.blue.moveTo(
      Math.cos(t) * 5,
      Math.sin(t) * 5
    );

    // rotate stars
    for (const s of this.stars) {

      s.rotation.y += dt * 2;

    }

    // collect stars
    for (const color of ["red", "blue"]) {

      const a = this.agents[color];

      for (
        let i = this.stars.length - 1;
        i >= 0;
        i--
      ) {

        const st = this.stars[i];

        if (
          st.position.distanceTo(
            a.position
          ) < 0.8
        ) {

          st.parent?.remove(st);

          this.stars.splice(i, 1);

          this.totalCollected[color]++;

          a.celebrate("⭐");
        }
      }
    }

    // respawn stars
    if (this.stars.length < 5) {

      this.spawnStars(5);

    }
  }

  getHUD() {

    return `
      <div class="game-hud world-hud">
        <h3>🎪 Мирок</h3>

        <div>
          ⭐ Красный:
          <b>${this.totalCollected.red}</b>
        </div>

        <div>
          ⭐ Синий:
          <b>${this.totalCollected.blue}</b>
        </div>

        <div>
          ⭐ На сцене:
          <b>${this.stars.length}</b>
        </div>
      </div>
    `;
  }
}
