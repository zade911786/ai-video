/**
 * MazeGame 3.0 — split-screen лабиринт.
 *
 *   • Экран делится на две независимые сцены: слева КЕЙН, справа ЭЙС.
 *   • Каждый агент решает СВОЙ лабиринт.
 *   • Проигрыш/таймаут → рестарт этого лабиринта (можно тот же).
 *   • Победа → генерируется НОВЫЙ, более сложный лабиринт (больше размер).
 *   • Рост сложности ограничен (до 23×23), дальше остаётся максимум.
 *   • Раз в несколько эпизодов лабиринт регенерируется, чтобы агент не запоминал.
 *   • Используется A*-учитель и гибридный actHybrid().
 *
 *   Bug-fixes v3:
 *     • координаты обновляются только при успешном шаге
 *     • reward shaping после фактического изменения позиции
 *     • sNext энкодится после действия
 *     • learnFromTeacher вызывается с актуальным best action
 */
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { Game } from './gameBase.js';
import { encodeState } from '../ai/brain.js';
import { astar, pathToAction } from '../ai/heuristics.js';
import { curriculum } from '../ai/curriculum.js';

const MIN_SIZE = 11, MAX_SIZE = 23, STEP_UP = 2;
const MAX_STEPS_BASE = 320;

class MazeInstance {
  constructor(scene, side, size, agent) {
    this.scene = scene;
    this.side = side;
    this.size = size;
    this.agent = agent;
    this.wins = 0;
    this.rounds = 0;
    this._build();
  }

  _build() {
    const N = this.size;
    const g = new Uint8Array(N * N); g.fill(1);
    const stack = [[1, 1]]; g[1 * N + 1] = 0;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const dirs = [[0,-2],[2,0],[0,2],[-2,0]].sort(() => Math.random() - 0.5);
      let moved = false;
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx > 0 && nx < N - 1 && ny > 0 && ny < N - 1 && g[ny * N + nx] === 1) {
          g[ny * N + nx] = 0;
          g[(y + dy / 2) * N + (x + dx / 2)] = 0;
          stack.push([nx, ny]); moved = true; break;
        }
      }
      if (!moved) stack.pop();
    }
    // open start and goal
    g[1 * N + 1] = 0;
    g[(N-2) * N + (N-2)] = 0;
    this.grid = g;

    // rebuild meshes
    if (this.meshes) for (const m of this.meshes) { m.parent?.remove(m); m.geometry?.dispose(); m.material?.dispose(); }
    this.meshes = [];

    // floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(N, N),
      new THREE.MeshToonMaterial({ color: 0x2a1f3a })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.05, 0);
    floor.receiveShadow = true;
    floor.userData.gameObj = true;
    this.scene.add(floor);
    this.meshes.push(floor);

    const wallMat = new THREE.MeshToonMaterial({ color: this.side === 'left' ? 0x663a5e : 0x3a4a66, emissive: 0x110022 });
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (g[y * N + x] === 1) {
          const w = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1, 0.98), wallMat);
          w.position.set(x - N / 2 + 0.5, 0.5, y - N / 2 + 0.5);
          w.castShadow = w.receiveShadow = true;
          w.userData.gameObj = true;
          this.scene.add(w);
          this.meshes.push(w);
        }
      }
    }

    // goal pillar
    const goalMat = new THREE.MeshToonMaterial({ color: 0xffe066, emissive: 0xffb000, emissiveIntensity: 0.8 });
    const goal = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 1.4, 14), goalMat);
    goal.position.set((N - 2) - N / 2 + 0.5, 0.7, (N - 2) - N / 2 + 0.5);
    goal.userData.gameObj = true;
    this.scene.add(goal);
    this.meshes.push(goal);
    this.goalMesh = goal;

    this.goal = { x: N - 2, y: N - 2 };
    this.startCell = { x: 1, y: 1 };
    this.respawn();

    // avatar: маленький меш-значок (цвет по агенту)
    const avMat = new THREE.MeshToonMaterial({
      color: this.agent.color === 'red' ? 0xff3b5c : 0x3d7cff,
      emissive: this.agent.color === 'red' ? 0xff3b5c : 0x3d7cff,
      emissiveIntensity: 0.4
    });
    if (this.avatar) {
      this.avatar.parent?.remove(this.avatar); this.avatar.geometry?.dispose(); this.avatar.material?.dispose();
    }
    const av = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), avMat);
    av.castShadow = true;
    av.userData.gameObj = true;
    this.scene.add(av);
    this.meshes.push(av);
    this.avatar = av;
    this._syncAvatar();
  }

  respawn() {
    this.gx = 1; this.gy = 1;
    this.steps = 0;
    this.maxSteps = MAX_STEPS_BASE + this.size * 8;
    this.lastDist = this._manhattan(this.gx, this.gy);
    this.rounds++;
    if (this.avatar) this._syncAvatar();
  }

  _syncAvatar() {
    if (!this.avatar) return;
    this.avatar.position.set(
      this.gx - this.size / 2 + 0.5,
      0.4,
      this.gy - this.size / 2 + 0.5
    );
  }

  _manhattan(x, y) { return Math.abs(this.goal.x - x) + Math.abs(this.goal.y - y); }

  isWall(x, y) {
    const N = this.size;
    if (x < 0 || x >= N || y < 0 || y >= N) return true;
    return this.grid[y * N + x] === 1;
  }

  dispose() {
    for (const m of this.meshes) { m.parent?.remove(m); m.geometry?.dispose(); m.material?.dispose(); }
    this.meshes.length = 0;
  }
}

export class MazeGame extends Game {
  constructor(world, agents) {
    super(world, agents);
    this.name = 'maze';
    this.left = null;
    this.right = null;
    this.totals = { redWins: 0, blueWins: 0, redFails: 0, blueFails: 0 };
  }

  setup() {
    this.active = true;
    this.agents.red.mesh.visible = false;
    this.agents.blue.mesh.visible = false;
    this.world.setSplit(
      true,
      (scene) => { this.left  = new MazeInstance(scene, 'left',  MIN_SIZE, this.agents.red); this._placeCam(this.world.split.leftCam,  MIN_SIZE); },
      (scene) => { this.right = new MazeInstance(scene, 'right', MIN_SIZE, this.agents.blue); this._placeCam(this.world.split.rightCam, MIN_SIZE); },
      { left: 'КЕЙН', right: 'ЭЙС' }
    );
  }

  _placeCam(cam, size) {
    cam.position.set(0, size * 0.8, size * 0.9);
    cam.lookAt(0, 0, 0);
  }

  _encode(inst) {
    const N = inst.size;
    const dirs8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    const walls = dirs8.map(([dx,dy]) => inst.isWall(inst.gx + dx, inst.gy + dy) ? 1 : 0);
    return encodeState({
      task: 0.4,
      dxg: (inst.goal.x - inst.gx) / N,
      dyg: (inst.goal.y - inst.gy) / N,
      walls,
      gx: inst.gx / N, gy: inst.gy / N,
      skill: inst.agent.brain.skill,
      rounds: inst.rounds / 20,
      size: (inst.size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE),
      pad: new Array(30).fill(0)
    });
  }

  _stepInstance(inst, dt) {
    if (!inst) return;
    inst.steps++;
    const agent = inst.agent;
    const N = inst.size;

    const s = this._encode(inst);

    // A*-teacher
    const path = astar(inst.grid, { x: inst.gx, y: inst.gy }, inst.goal, N, N, true);
    let heur = 0;
    if (path && path.length > 1) heur = pathToAction(path[0], path[1]);

    const epsBoost = curriculum.epsilonBoost('maze');
    if (epsBoost > 0) agent.brain.epsilon = Math.min(1, agent.brain.epsilon + epsBoost * 0.01);

    const action = agent.brain.actHybrid(s, heur, true);

    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    const [dx, dy] = action < 8 ? dirs[action] : [0, 0];
    const nx = inst.gx + dx, ny = inst.gy + dy;

    let r = -0.02;
    const prevDist = inst._manhattan(inst.gx, inst.gy);

    if (!inst.isWall(nx, ny)) {
      inst.gx = nx; inst.gy = ny;
      const newDist = inst._manhattan(inst.gx, inst.gy);
      if (newDist < prevDist) r += 0.12;
      else if (newDist > prevDist) r -= 0.05;
    } else {
      r -= 0.12; // hit wall
    }

    // learn from teacher (hybrid guidance)
    if (Math.random() < curriculum.teacherWeight('maze', agent.brain.skill) * 0.6) {
      agent.brain.learnFromTeacher(s, heur, 0.5);
    }

    let done = false;
    let win = false;
    if (inst.gx === inst.goal.x && inst.gy === inst.goal.y) {
      r += 14;
      done = true;
      win = true;
      if (agent.color === 'red') this.totals.redWins++;
      else                        this.totals.blueWins++;
      inst.wins++;
      agent.celebrate('🏁 выход!');
      curriculum.record('maze', 14, true);
    } else if (inst.steps >= inst.maxSteps) {
      r -= 2;
      done = true;
      win = false;
      if (agent.color === 'red') this.totals.redFails++;
      else                        this.totals.blueFails++;
      agent.surprise('таймаут');
      curriculum.record('maze', -2, false);
    }

    inst._syncAvatar();
    const sNext = this._encode(inst);
    agent.pushExperience(s, action, r * curriculum.rewardScale('maze'), sNext, done);

    if (done) {
      if (win) {
        // Harder maze
        const newSize = Math.min(MAX_SIZE, inst.size + STEP_UP);
        if (newSize !== inst.size) {
          inst.size = newSize;
          inst.dispose();
          inst._build();
          this._placeCam(
            inst.side === 'left' ? this.world.split.leftCam : this.world.split.rightCam,
            inst.size
          );
          agent.setThought(`лабиринт ↑${inst.size}`, '🔺');
        } else {
          // regenerate at max size
          inst.dispose();
          inst._build();
        }
      } else {
        // Restart same difficulty (new seed)
        inst.dispose();
        inst._build();
      }
    }
  }

  step(dt) {
    if (!this.active) return;
    // две независимые симуляции
    // для скорости делаем несколько микро-шагов за кадр (лабиринт дискретный)
    const stepsPerFrame = 2;
    for (let i = 0; i < stepsPerFrame; i++) {
      this._stepInstance(this.left, dt);
      this._stepInstance(this.right, dt);
    }
  }

  teardown() {
    super.teardown();
    this.agents.red.mesh.visible = true;
    this.agents.blue.mesh.visible = true;
    this.left?.dispose();
    this.right?.dispose();
    this.left = this.right = null;
  }

  getHUD() {
    const lw = this.left?.wins ?? 0;
    const rw = this.right?.wins ?? 0;
    const lsize = this.left?.size ?? MIN_SIZE;
    const rsize = this.right?.size ?? MIN_SIZE;
    return `
      <div class="game-hud maze-hud">
        <h3>🧭 Лабиринт (split)</h3>
        <div class="flap-cols">
          <div class="flap-col red">
            <div>КЕЙН</div>
            <div>Побед: <b>${lw}</b></div>
            <div>Размер: ${lsize}×${lsize}</div>
            <div>Провалов: ${this.totals.redFails}</div>
          </div>
          <div class="flap-col blue">
            <div>ЭЙС</div>
            <div>Побед: <b>${rw}</b></div>
            <div>Размер: ${rsize}×${rsize}</div>
            <div>Провалов: ${this.totals.blueFails}</div>
          </div>
        </div>
      </div>`;
  }
}
