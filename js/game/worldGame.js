/**
 * WorldGame 3.0 — «мирок» для базового исследования.
 *
 *  Агенты свободно ходят по арене, собирают звёзды.
 *  Не использует split-screen. Эта сцена — демонстрационная / «бэкграунд»,
 *  чтобы игроку было что показать при запуске.
 *
 *  Bug-fixes v3:
 *   • s ≠ sNext (разные снапшоты состояния до/после действия).
 *   • Гарантированное обновление _lastAction / _lastState.
 *   • Корректная очистка при teardown (звёзды удаляются).
 */
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { Game } from './gameBase.js';
import { encodeState } from '../ai/brain.js';
import { curriculum } from '../ai/curriculum.js';

export class WorldGame extends Game {
  constructor(world, agents) {
    super(world, agents);
    this.name = 'world';
    this.stars = [];
    this.totalCollected = { red: 0, blue: 0 };
    this.tick = 0;
  }

  setup() {
    this.active = true;
    this.agents.red.moveTo(-3, 0);
    this.agents.blue.moveTo(3, 0);
    this._spawnStars(10);
  }

  _spawnStars(n) {
    for (let i = 0; i < n; i++) this._spawnStar();
  }

  _spawnStar() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.25, 0),
      new THREE.MeshToonMaterial({ color: 0xffe066, emissive: 0xffaa00, emissiveIntensity: 0.6 })
    );
    m.castShadow = true;
    g.add(m);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff2aa, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.05;
    g.add(halo);
    g.position.set((Math.random() - 0.5) * 14, 0.4, (Math.random() - 0.5) * 14);
    g.userData.star = true;
    this.add(g);
    this.stars.push(g);
  }

  _encode(agent) {
    let nearest = null, nd = 99;
    for (const s of this.stars) {
      const d = agent.position.distanceTo(s.position);
      if (d < nd) { nd = d; nearest = s; }
    }
    return encodeState({
      task: 0.05,
      dx: nearest ? (nearest.position.x - agent.position.x) / 12 : 0,
      dz: nearest ? (nearest.position.z - agent.position.z) / 12 : 0,
      dist: nd / 18,
      selfX: agent.position.x / 12,
      selfZ: agent.position.z / 12,
      skill: agent.brain.skill,
      starsLeft: this.stars.length / 12,
      pad: new Array(40).fill(0)
    });
  }

  step(dt) {
    if (!this.active) return;
    this.tick++;
    const dirs = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];

    for (const color of ['red', 'blue']) {
      const a = this.agents[color];
      if (a.sleeping) continue;

      const s = this._encode(a);
      let nearest = null, nd = 99;
      for (const st of this.stars) {
        const d = a.position.distanceTo(st.position);
        if (d < nd) { nd = d; nearest = st; }
      }
      const heur = (() => {
        if (!nearest) return 8;
        const dx = nearest.position.x - a.position.x;
        const dz = nearest.position.z - a.position.z;
        let bi = 0, bd = 1e9;
        for (let i = 0; i < 8; i++) {
          const d = Math.hypot(dx - dirs[i][0], dz - dirs[i][1]);
          if (d < bd) { bd = d; bi = i; }
        }
        return bi;
      })();

      curriculum.record('world', 0, nd < 0.8);
      const epsBoost = curriculum.epsilonBoost('world');
      if (epsBoost > 0) a.brain.epsilon = Math.min(1, a.brain.epsilon + epsBoost * 0.01);

      const action = a.brain.actHybrid(s, heur, true);
      const [dx, dz] = action < 8 ? dirs[action] : [0, 0];
      const prevDist = nd;

      const tx = Math.max(-16, Math.min(16, a.position.x + dx * 0.45));
      const tz = Math.max(-16, Math.min(16, a.position.z + dz * 0.45));
      a.moveTo(tx, tz);
      a.position.set(tx, 0, tz);
      a.rotation = Math.atan2(dx, dz);

      // reward
      let r = -0.01;
      let collected = false;
      for (let i = this.stars.length - 1; i >= 0; i--) {
        if (this.stars[i].position.distanceTo(a.position) < 0.7) {
          const st = this.stars[i];
          st.parent?.remove(st);
          this._disposeObj(st);
          this.stars.splice(i, 1);
          this.objects = this.objects.filter(o => o !== st);
          collected = true;
          this.totalCollected[color]++;
          r += 2.0;
          a.celebrate('⭐');
          curriculum.record('world', 2.0, true);
        }
      }
      // shape reward
      let newNd = 99;
      for (const st of this.stars) newNd = Math.min(newNd, a.position.distanceTo(st.position));
      if (newNd < prevDist - 0.01) r += 0.1;
      else if (newNd > prevDist + 0.01) r -= 0.03;

      const sNext = this._encode(a);
      a.pushExperience(s, action, r * curriculum.rewardScale('world'), sNext, false);

      if (this.stars.length < 4) this._spawnStars(6);

      if (this.tick % 300 === 0) {
        a.setThought(collected ? 'Есть!' : 'Исследую…', '✨');
      }
    }
  }

  getHUD() {
    return `
      <div class="game-hud world-hud">
        <h3>🎪 Мирок</h3>
        <div>⭐ Красный собрал: <b>${this.totalCollected.red}</b></div>
        <div>⭐ Синий собрал: <b>${this.totalCollected.blue}</b></div>
        <div>На сцене: <b>${this.stars.length}</b></div>
      </div>`;
  }
}
