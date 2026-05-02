/**
 * SandboxGame 3.0 — физическая песочница.
 *
 *  Что изменилось:
 *   • Все кубики — динамические тела mini-физики (js/physics/physics.js).
 *   • Гравитация, трение, столкновения куб-куб, куб-пол — реальные.
 *   • Агенты остаются кинематическими (проще для скриптовой переноски),
 *     но при падении блоков башня разрушается физикой, а не магией.
 *   • Агенты переносят ближайший свободный блок и кладут его в зону;
 *     награда за рост башни масштабируется высотой.
 *   • sNext ≠ s, _lastAction корректно используется при pushExperience.
 */
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { Game } from './gameBase.js';
import { encodeState } from '../ai/brain.js';
import { curriculum } from '../ai/curriculum.js';
import { World as PhysWorld, Body } from '../physics/physics.js';

const ZONE_R = 1.4;
const BLOCK_COUNT = 18;

export class SandboxGame extends Game {
  constructor(world, agents) {
    super(world, agents);
    this.name = 'sandbox';
    this.physics = null;
    this.blocks = [];
    this.zones = {};
    this.towerHeights = { red: 0, blue: 0 };
    this.tick = 0;
    this.placed = { red: 0, blue: 0 };
  }

  setup() {
    this.active = true;
    this.physics = new PhysWorld({ gravity: -18, groundY: 0, substeps: 3 });

    // Подиумы (зоны)
    const zMatR = new THREE.MeshToonMaterial({ color: 0x552030, emissive: 0xff3b5c, emissiveIntensity: 0.25 });
    const zMatB = new THREE.MeshToonMaterial({ color: 0x1d2a55, emissive: 0x3d7cff, emissiveIntensity: 0.25 });
    const zoneRed = new THREE.Mesh(new THREE.CylinderGeometry(ZONE_R, ZONE_R + 0.1, 0.1, 32), zMatR);
    zoneRed.position.set(-4.5, 0.05, 0);
    zoneRed.userData.gameObj = true;
    this.add(zoneRed);
    const zoneBlue = new THREE.Mesh(new THREE.CylinderGeometry(ZONE_R, ZONE_R + 0.1, 0.1, 32), zMatB);
    zoneBlue.position.set(4.5, 0.05, 0);
    zoneBlue.userData.gameObj = true;
    this.add(zoneBlue);

    // Кольца
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    const ringR = new THREE.Mesh(new THREE.RingGeometry(ZONE_R, ZONE_R + 0.1, 32), ringMat);
    ringR.rotation.x = -Math.PI / 2; ringR.position.set(-4.5, 0.12, 0); ringR.userData.gameObj = true; this.add(ringR);
    const ringB = new THREE.Mesh(new THREE.RingGeometry(ZONE_R, ZONE_R + 0.1, 32), ringMat);
    ringB.rotation.x = -Math.PI / 2; ringB.position.set(4.5, 0.12, 0); ringB.userData.gameObj = true; this.add(ringB);

    this.zones = {
      red:  new THREE.Vector3(-4.5, 0, 0),
      blue: new THREE.Vector3( 4.5, 0, 0)
    };

    // Spawn blocks
    for (let i = 0; i < BLOCK_COUNT; i++) this._spawnBlock(
      (Math.random() - 0.5) * 8,
      1 + Math.random() * 0.4,
      (Math.random() - 0.5) * 4 - 2
    );

    // Агенты
    this.agents.red.moveTo(-4.5, 1.8);
    this.agents.blue.moveTo( 4.5, -1.8);

    // Small ambient floor (visual + physics ground already at 0)
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 18),
      new THREE.MeshToonMaterial({ color: 0x251535 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.receiveShadow = true;
    pad.position.y = 0.001;
    pad.userData.gameObj = true;
    this.add(pad);
  }

  _spawnBlock(x, y, z) {
    const size = 0.6 + Math.random() * 0.25;
    const color = new THREE.Color().setHSL(Math.random(), 0.55, 0.55);
    const mat = new THREE.MeshToonMaterial({ color, emissive: color.clone().multiplyScalar(0.35) });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.gameObj = true;
    this.add(mesh);

    const body = new Body({
      type: 'box',
      pos: new THREE.Vector3(x, y, z),
      size: new THREE.Vector3(size, size, size),
      mass: 1.0,
      friction: 0.6,
      restitution: 0.12
    });
    body.mesh = mesh;
    body.userData = { block: true, held: false, placed: false };
    this.physics.add(body);
    this.blocks.push(body);
    return body;
  }

  _findFreeNearest(pos, minDist = 0.3) {
    let best = null, bd = 1e9;
    for (const b of this.blocks) {
      if (b.userData.held || b.userData.placed) continue;
      const d = b.pos.distanceTo(pos);
      if (d < bd && d > minDist) { bd = d; best = b; }
    }
    return best;
  }

  _towerHeight(zone) {
    // approx: count placed blocks near zone and return max Y
    let h = 0;
    for (const b of this.blocks) {
      if (!b.userData.placed) continue;
      const d = Math.hypot(b.pos.x - zone.x, b.pos.z - zone.z);
      if (d < ZONE_R + 0.2) h = Math.max(h, b.pos.y + 0.4);
    }
    return h;
  }

  _encode(agent) {
    const zone = this.zones[agent.color];
    const free = this._findFreeNearest(agent.position);
    return encodeState({
      task: 0.3,
      selfX: agent.position.x / 10, selfZ: agent.position.z / 10,
      zx: (zone.x - agent.position.x) / 10, zz: (zone.z - agent.position.z) / 10,
      carry: agent._carriedBlock ? 1 : 0,
      fx: free ? (free.pos.x - agent.position.x) / 10 : 0,
      fz: free ? (free.pos.z - agent.position.z) / 10 : 0,
      height: this.towerHeights[agent.color] / 6,
      freeCount: this.blocks.filter(b => !b.userData.held && !b.userData.placed).length / BLOCK_COUNT,
      skill: agent.brain.skill,
      pad: new Array(40).fill(0)
    });
  }

  step(dt) {
    if (!this.active) return;
    this.tick++;

    // физика
    this.physics.step(Math.min(dt, 1 / 30));
    this.physics.syncMeshes();

    // если блок находится низко или вне арены — респавним
    for (const b of this.blocks) {
      if (b.userData.held) continue;
      if (b.pos.y < -2 || Math.abs(b.pos.x) > 12 || Math.abs(b.pos.z) > 10) {
        b.pos.set((Math.random() - 0.5) * 8, 1.4, (Math.random() - 0.5) * 4 - 2);
        b.vel.set(0, 0, 0);
        b.userData.placed = false;
      }
    }

    // tower heights
    this.towerHeights.red  = this._towerHeight(this.zones.red);
    this.towerHeights.blue = this._towerHeight(this.zones.blue);

    // агентная логика
    for (const color of ['red', 'blue']) {
      const agent = this.agents[color];
      if (agent.sleeping) continue;

      const s = this._encode(agent);
      let action = agent.brain.act(s, true);

      const zone = this.zones[color];
      let reward = -0.005;

      if (agent._carriedBlock) {
        // двигаемся к зоне
        const dir = new THREE.Vector3().subVectors(zone, agent.position);
        dir.y = 0;
        if (dir.length() > 0.3) {
          dir.normalize().multiplyScalar(0.06);
          agent.position.x += dir.x;
          agent.position.z += dir.z;
          agent.rotation = Math.atan2(dir.x, dir.z);
          agent.moveTo(agent.position.x, agent.position.z);
          agent._carriedBlock.pos.set(agent.position.x, 1.4, agent.position.z);
          agent._carriedBlock.vel.set(0, 0, 0);
        } else {
          // кладём блок на башню
          const h = this.towerHeights[color];
          const b = agent._carriedBlock;
          b.pos.set(zone.x + (Math.random() - 0.5) * 0.25, Math.max(0.4, h + 0.5), zone.z + (Math.random() - 0.5) * 0.25);
          b.vel.set(0, 0, 0);
          b.userData.held = false;
          b.userData.placed = true;
          b.carriedBy = null;
          agent._carriedBlock = null;
          this.placed[color]++;
          reward += 1.5 + h * 0.4;
          agent.celebrate('↑');
          curriculum.record('sandbox', reward, true);

          // синий учит красного
          if (color === 'blue') {
            this.agents.red.brain.learnFromTeacher(s, action, 0.6);
          }
        }
      } else {
        // ищем свободный блок
        const tgt = this._findFreeNearest(agent.position);
        if (!tgt) {
          // пустота — ходим к центру
          agent.moveTo(0, 0);
        } else {
          const dir = new THREE.Vector3().subVectors(tgt.pos, agent.position);
          dir.y = 0;
          if (dir.length() > 0.55) {
            dir.normalize().multiplyScalar(0.06);
            agent.position.x += dir.x;
            agent.position.z += dir.z;
            agent.rotation = Math.atan2(dir.x, dir.z);
            agent.moveTo(agent.position.x, agent.position.z);
            reward += 0.01;
          } else {
            // берём
            tgt.userData.held = true;
            tgt.carriedBy = agent;
            agent._carriedBlock = tgt;
            reward += 0.5;
            agent.setThought('поднял', '✋');
          }
        }
      }

      // если рядом с зоной есть блоки — проверяем стабильность башни (иногда рушится)
      if (Math.random() < 0.002 && this.towerHeights[color] > 2.5) {
        for (const b of this.blocks) {
          if (b.userData.placed) {
            const d = Math.hypot(b.pos.x - zone.x, b.pos.z - zone.z);
            if (d < ZONE_R + 0.2 && b.pos.y > 1.5) {
              b.vel.set((Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2);
              b.userData.placed = false;
              reward -= 0.3;
              agent.surprise('башня шатается');
              break;
            }
          }
        }
      }

      const sNext = this._encode(agent);
      agent.pushExperience(s, action, reward * curriculum.rewardScale('sandbox'), sNext, false);
    }
  }

  teardown() {
    super.teardown();
    // очистить физику
    if (this.physics) { this.physics.bodies.length = 0; this.physics.constraints.length = 0; }
    this.blocks.length = 0;
    this.agents.red._carriedBlock = null;
    this.agents.blue._carriedBlock = null;
  }

  getHUD() {
    return `
      <div class="game-hud sandbox-hud">
        <h3>🧱 Песочница (физика)</h3>
        <div class="flap-cols">
          <div class="flap-col red">
            <div>КЕЙН</div>
            <div>Башня: <b>${this.towerHeights.red.toFixed(2)}</b> м</div>
            <div>Положено: ${this.placed.red}</div>
          </div>
          <div class="flap-col blue">
            <div>ЭЙС</div>
            <div>Башня: <b>${this.towerHeights.blue.toFixed(2)}</b> м</div>
            <div>Положено: ${this.placed.blue}</div>
          </div>
        </div>
        <div class="hint">Блоки подчиняются гравитации и рушатся при нестабильности.</div>
      </div>`;
  }
}
