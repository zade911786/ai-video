/**
 * EscapeGame 3.0 — «Побег»: учимся двигать ragdoll-конечностями,
 *  чтобы уворачиваться от смертоносного лазера.
 *
 *  Идея:
 *   • Агент становится ragdoll-телом (см. physics.Ragdoll).
 *   • По оси X движется лазерная линия (тонкая пластина на земле).
 *   • Если ragdoll-torso задевает лазер — агент уничтожается,
 *     reward -12, спавнится заново.
 *   • Чтобы выжить, агент должен СДВИНУТЬ торс в сторону (прыжком/
 *     ходьбой ногами через action 0..9).
 *   • Reward каждый шаг — +0.02 за выживание и -0.05 за близость к лазеру
 *     (меньше 1 метра). +0.3 если лазер прошёл мимо.
 *
 *  Для побуждения к локомоции agent использует actHybrid() с heuristic
 *  «если лазер в X < torso.x — прыжок вперёд, иначе назад».
 */
import * as THREE from 'three';
import { Game } from './gameBase.js';
import { encodeState } from '../ai/brain.js';
import { curriculum } from '../ai/curriculum.js';
import { World as PhysWorld } from '../physics/physics.js';

const ARENA_X = 6;

class Runner {
  constructor(world, scene, side, agent, physics) {
    this.world = world;
    this.scene = scene;
    this.side = side;
    this.agent = agent;
    this.physics = physics;

    this.score = 0;
    this.deaths = 0;
    this.steps = 0;

    this.laserX = -ARENA_X;
    this.laserDir = 1;
    this.laserSpeed = 2.2;
    this.round = 0;

    this._buildArena();
    this._spawnRagdoll();
  }

  _buildArena() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_X * 2 + 4, 6),
      new THREE.MeshToonMaterial({ color: 0x221028 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData.gameObj = true;
    this.scene.add(floor);
    this.floor = floor;

    // Стенки
    const wallMat = new THREE.MeshToonMaterial({ color: 0x773344, emissive: 0xff2060, emissiveIntensity: 0.2 });
    const wL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 6), wallMat);
    wL.position.set(-ARENA_X - 0.5, 0.6, 0);
    wL.userData.gameObj = true;
    this.scene.add(wL);
    const wR = wL.clone();
    wR.position.x = ARENA_X + 0.5;
    wR.userData.gameObj = true;
    this.scene.add(wR);
    this.walls = [wL, wR];

    // Лазер — тонкая плоская «линия» на земле + «столб света» сверху
    const laserMat = new THREE.MeshBasicMaterial({ color: 0xff1040, transparent: true, opacity: 0.9 });
    const laserLine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 6), laserMat);
    laserLine.position.set(this.laserX, 0.03, 0);
    laserLine.userData.gameObj = true;
    this.scene.add(laserLine);

    const laserCol = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 2.2, 6),
      new THREE.MeshBasicMaterial({ color: 0xff1040, transparent: true, opacity: 0.3 })
    );
    laserCol.position.set(this.laserX, 1.1, 0);
    laserCol.userData.gameObj = true;
    this.scene.add(laserCol);

    this.laser = { line: laserLine, col: laserCol };
  }

  _spawnRagdoll() {
    const agent = this.agent;
    agent.exitRagdoll?.();
    // Ставим ragdoll в случайную точку слева/справа от центра
    const startX = (Math.random() - 0.5) * 2;
    agent.enterRagdoll(this.physics, this.scene, new THREE.Vector3(startX, 0.9, 0));
    // Настраиваем камеру для split-screen (камера side автоматически размещена world.setSplit)
  }

  dispose() {
    [this.floor, ...this.walls, this.laser.line, this.laser.col].forEach(o => {
      o.parent?.remove(o);
      o.geometry?.dispose();
      o.material?.dispose();
    });
    // ragdoll будет убран через agent.exitRagdoll()
    this.agent.exitRagdoll();
  }

  _stateVector() {
    const torso = this.agent.ragdoll.parts.torso;
    const dx = torso.pos.x - this.laserX;
    const vy = torso.vel.y;
    const vx = torso.vel.x;
    return encodeState({
      task: 0.8,
      dxLaser: Math.max(-1, Math.min(1, dx / ARENA_X)),
      laserDir: this.laserDir,
      vx: Math.max(-1, Math.min(1, vx / 6)),
      vy: Math.max(-1, Math.min(1, vy / 8)),
      torsoY: Math.max(-1, Math.min(1, torso.pos.y / 2)),
      torsoX: Math.max(-1, Math.min(1, torso.pos.x / ARENA_X)),
      round: Math.min(1, this.round / 20),
      skill: this.agent.brain.skill,
      pad: new Array(40).fill(0)
    });
  }

  _heuristic() {
    // Если лазер справа и близко — бежим влево (action 0), иначе вправо (action 1).
    const torso = this.agent.ragdoll.parts.torso;
    const dx = torso.pos.x - this.laserX;
    if (Math.abs(dx) < 2) {
      return dx < 0 ? 0 : 1; // уйти дальше от лазера
    }
    // Если нет угрозы — прыгать иногда для обучения
    return Math.random() < 0.2 ? 9 : (Math.random() < 0.5 ? 0 : 1);
  }

  step(dt) {
    this.steps++;
    if (!this.agent.ragdoll) return;

    // Обновление лазера
    this.laserX += this.laserSpeed * this.laserDir * dt;
    if (this.laserX >  ARENA_X) { this.laserDir = -1; this.round++; this.score += 5; this.laserSpeed = Math.min(6, this.laserSpeed + 0.12); }
    if (this.laserX < -ARENA_X) { this.laserDir =  1; this.round++; this.score += 5; this.laserSpeed = Math.min(6, this.laserSpeed + 0.12); }
    this.laser.line.position.x = this.laserX;
    this.laser.col.position.x  = this.laserX;

    // Encode
    const s = this._stateVector();
    const heur = this._heuristic();
    const epsBoost = curriculum.epsilonBoost('escape');
    if (epsBoost > 0) this.agent.brain.epsilon = Math.min(1, this.agent.brain.epsilon + epsBoost * 0.01);
    const action = this.agent.brain.actHybrid(s, heur, true);

    // Actuation — ragdoll reacts каждый кадр
    this.agent.ragdoll.actuate(action, 1.0);

    // Reward shaping
    const torso = this.agent.ragdoll.parts.torso;
    const distLaser = Math.abs(torso.pos.x - this.laserX);
    let r = 0.02; // survive bonus
    if (distLaser < 1.0) r -= 0.08 * (1 - distLaser);
    else if (distLaser > 2.0) r += 0.02;
    // Вознаграждение за движение ногами
    const footSpeed = Math.max(
      this.agent.ragdoll.parts.footL.vel.length(),
      this.agent.ragdoll.parts.footR.vel.length()
    );
    if (footSpeed > 2.0) r += 0.01;

    // Keep inside arena
    if (torso.pos.x >  ARENA_X) torso.applyImpulse(new THREE.Vector3(-4, 0, 0));
    if (torso.pos.x < -ARENA_X) torso.applyImpulse(new THREE.Vector3( 4, 0, 0));

    // Death condition
    let done = false;
    if (distLaser < 0.2 && torso.pos.y < 1.3) {
      r -= 12;
      this.deaths++;
      this.agent.surprise('☠️ лазер');
      done = true;
      curriculum.record('escape', -12, false);
      this._spawnRagdoll();
      this.laserSpeed = 2.2;
      this.laserX = -ARENA_X;
      this.laserDir = 1;
    }

    const sNext = this._stateVector();
    this.agent.pushExperience(s, action, r * curriculum.rewardScale('escape'), sNext, done);

    // Обновим визуальные связи
    this.agent.updateRagdollVisuals?.();
  }
}

export class EscapeGame extends Game {
  constructor(world, agents) {
    super(world, agents);
    this.name = 'escape';
    this.left = null;
    this.right = null;
    this.physicsLeft = null;
    this.physicsRight = null;
  }

  setup() {
    this.active = true;
    this.agents.red.mesh.visible = false;
    this.agents.blue.mesh.visible = false;
    this.physicsLeft  = new PhysWorld({ gravity: -18, groundY: 0, substeps: 4, damping: 0.04 });
    this.physicsRight = new PhysWorld({ gravity: -18, groundY: 0, substeps: 4, damping: 0.04 });

    this.world.setSplit(
      true,
      (scene) => { this.left  = new Runner(this.world, scene, 'left',  this.agents.red,  this.physicsLeft);  this.world.split.leftCam.position.set(-1, 4, 10);  this.world.split.leftCam.lookAt(0, 1, 0); },
      (scene) => { this.right = new Runner(this.world, scene, 'right', this.agents.blue, this.physicsRight); this.world.split.rightCam.position.set(-1, 4, 10); this.world.split.rightCam.lookAt(0, 1, 0); },
      { left: 'КЕЙН', right: 'ЭЙС' }
    );
  }

  step(dt) {
    if (!this.active) return;
    const sdt = Math.min(dt, 1 / 30);

    this.physicsLeft?.step(sdt);
    this.physicsRight?.step(sdt);
    this.physicsLeft?.syncMeshes();
    this.physicsRight?.syncMeshes();

    this.left?.step(sdt);
    this.right?.step(sdt);
  }

  teardown() {
    this.left?.dispose();
    this.right?.dispose();
    super.teardown();
    this.agents.red.mesh.visible = true;
    this.agents.blue.mesh.visible = true;
    this.physicsLeft = this.physicsRight = null;
  }

  getHUD() {
    return `
      <div class="game-hud escape-hud">
        <h3>🚨 Побег — ragdoll-тренировка</h3>
        <div class="flap-cols">
          <div class="flap-col red">
            <div>КЕЙН</div>
            <div>Выжил: <b>${this.left?.score ?? 0}</b></div>
            <div>Погиб: ${this.left?.deaths ?? 0}×</div>
            <div>Раунд: ${this.left?.round ?? 0}</div>
          </div>
          <div class="flap-col blue">
            <div>ЭЙС</div>
            <div>Выжил: <b>${this.right?.score ?? 0}</b></div>
            <div>Погиб: ${this.right?.deaths ?? 0}×</div>
            <div>Раунд: ${this.right?.round ?? 0}</div>
          </div>
        </div>
        <div class="hint">Лазер убивает при касании. Агент обязан учиться двигать ногами и прыгать.</div>
      </div>`;
  }
}
