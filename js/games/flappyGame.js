/**
 * FlappyGame 3.0 — split-screen Flappy Bird.
 *
 *  Изменения vs v1:
 *   • Экран разделён на две дорожки: слева красный ИИ, справа синий ИИ.
 *   • Каждый агент летит сам, у него своя сцена с собственными трубами.
 *   • Смерть одного агента НЕ сбрасывает другого — только его дорожку.
 *   • Агенты теперь выглядят как маленькие ИИ-«птицы»
 *     (специальный bird-mesh с окраской по цвету).
 *   • Столкновение с трубой = смерть, respawn на старте, reward -5.
 *   • Проход через проём = +2, best score обновляется отдельно для каждой стороны.
 *   • Экспириенс пушится каждый кадр: s и sNext различны.
 */
import * as THREE from 'three';
import { Game } from './gameBase.js';
import { encodeState } from '../ai/brain.js';
import { flappyHeuristic } from '../ai/heuristics.js';
import { curriculum } from '../ai/curriculum.js';

const LANE_WIDTH  = 18;
const LANE_HEIGHT = 10;
const GRAVITY     = -18;
const FLAP_IMP    = 7.2;
const PIPE_SPEED  = 4.2;
const PIPE_DIST   = 6.5;
const PIPE_GAP    = 3.6;

class Lane {
  constructor(scene, side) {
    this.scene = scene;
    this.side = side;
    this.pipes = [];
    this.birdY = 0;
    this.birdVy = 0;
    this.score = 0;
    this.best = 0;
    this.alive = true;
    this.tick = 0;
    this.rebuildScene();
  }

  rebuildScene() {
    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH * 2, 6),
      new THREE.MeshToonMaterial({ color: 0x553a77 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -LANE_HEIGHT / 2 - 0.5, 0);
    floor.receiveShadow = true;
    floor.userData.gameObj = true;
    this.scene.add(floor);
    this.floor = floor;

    // Backdrop clouds (sprite-less simple quads for perf)
    this.bg = [];
    for (let i = 0; i < 6; i++) {
      const cloud = new THREE.Mesh(
        new THREE.PlaneGeometry(2.3, 1.2),
        new THREE.MeshBasicMaterial({ color: 0xffe8f2, transparent: true, opacity: 0.7 })
      );
      cloud.position.set((Math.random() - 0.5) * LANE_WIDTH * 1.8, Math.random() * 4 + 1, -4);
      cloud.userData.gameObj = true;
      this.scene.add(cloud);
      this.bg.push(cloud);
    }

    // Lane label (big text-like strip)
    const labelColor = this.side === 'left' ? 0xff6080 : 0x6080ff;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH * 1.6, 0.15),
      new THREE.MeshBasicMaterial({ color: labelColor, transparent: true, opacity: 0.6 })
    );
    label.position.set(0, LANE_HEIGHT / 2, -2);
    label.userData.gameObj = true;
    this.scene.add(label);

    // initial pipes
    for (let i = 0; i < 4; i++) {
      this.spawnPipe(LANE_WIDTH / 2 + i * PIPE_DIST + 2);
    }
  }

  spawnPipe(x) {
    const gapY = (Math.random() - 0.5) * (LANE_HEIGHT - PIPE_GAP - 1.2);
    const topH = (LANE_HEIGHT / 2) - (gapY + PIPE_GAP / 2);
    const botH = (gapY - PIPE_GAP / 2) + LANE_HEIGHT / 2;
    const matPipe = new THREE.MeshToonMaterial({ color: 0x39d27a, emissive: 0x0a3a18, emissiveIntensity: 0.3 });

    const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, Math.max(0.2, topH), 0.9), matPipe);
    top.position.set(x, LANE_HEIGHT / 2 - topH / 2, 0);
    top.castShadow = true;
    top.userData.gameObj = true;
    this.scene.add(top);

    const bot = new THREE.Mesh(new THREE.BoxGeometry(0.9, Math.max(0.2, botH), 0.9), matPipe);
    bot.position.set(x, -LANE_HEIGHT / 2 + botH / 2, 0);
    bot.castShadow = true;
    bot.userData.gameObj = true;
    this.scene.add(bot);

    this.pipes.push({ top, bot, x, gapY, passed: false });
  }

  reset() {
    this.birdY = 0;
    this.birdVy = 0;
    this.score = 0;
    this.alive = true;
    for (const p of this.pipes) {
      p.top.parent?.remove(p.top); p.top.geometry?.dispose(); p.top.material?.dispose();
      p.bot.parent?.remove(p.bot); p.bot.geometry?.dispose(); p.bot.material?.dispose();
    }
    this.pipes.length = 0;
    for (let i = 0; i < 4; i++) this.spawnPipe(LANE_WIDTH / 2 + i * PIPE_DIST + 2);
  }

  dispose() {
    for (const p of this.pipes) {
      p.top.parent?.remove(p.top); p.top.geometry?.dispose(); p.top.material?.dispose();
      p.bot.parent?.remove(p.bot); p.bot.geometry?.dispose(); p.bot.material?.dispose();
    }
    this.pipes.length = 0;
    for (const c of this.bg) { c.parent?.remove(c); c.geometry?.dispose(); c.material?.dispose(); }
    this.floor?.parent?.remove(this.floor); this.floor?.geometry?.dispose(); this.floor?.material?.dispose();
  }
}

export class FlappyGame extends Game {
  constructor(world, agents) {
    super(world, agents);
    this.name = 'flappy';
    this.lanes = { left: null, right: null };
    this.totalDeaths = { red: 0, blue: 0 };
    this.totalPassed = { red: 0, blue: 0 };
    this.best = { red: 0, blue: 0 };
    this.t = 0;
  }

  setup() {
    this.active = true;
    // Скрыть обычные меши агентов
    this.agents.red.mesh.visible = false;
    this.agents.blue.mesh.visible = false;

    // включить split-screen: левая — красный, правая — синий
    this.world.setSplit(
      true,
      (scene) => { this.lanes.left = new Lane(scene, 'left');  this._attachBird(scene, 'left', this.agents.red); },
      (scene) => { this.lanes.right = new Lane(scene, 'right'); this._attachBird(scene, 'right', this.agents.blue); },
      { left: 'КЕЙН', right: 'ЭЙС' }
    );

    // pointing cameras at lanes
    this.world.split.leftCam.position.set(-2, 0, 12);
    this.world.split.leftCam.lookAt(2, 0, 0);
    this.world.split.rightCam.position.set(-2, 0, 12);
    this.world.split.rightCam.lookAt(2, 0, 0);
  }

  _attachBird(scene, side, agent) {
    // создаём небольшой «ИИ-бот» меш прямо в сцене
    const color = agent.color === 'red' ? 0xff3b5c : 0x3d7cff;
    const g = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 12),
      new THREE.MeshToonMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
    );
    g.add(body);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.28, 0.34),
      new THREE.MeshToonMaterial({ color: 0xffffff })
    );
    head.position.set(0.1, 0.25, 0);
    g.add(head);

    const eyeL = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x0f0f0f })
    );
    eyeL.position.set(0.22, 0.3, 0.12);
    g.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.set(0.22, 0.3, -0.12);
    g.add(eyeR);

    // «крыло» (простая полоска, с анимацией через rotation.z)
    const wingL = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.08, 0.16),
      new THREE.MeshToonMaterial({ color: 0xfff0c0 })
    );
    wingL.position.set(-0.05, 0, 0.28);
    g.add(wingL);
    const wingR = wingL.clone();
    wingR.position.z = -0.28;
    g.add(wingR);

    // ИИ-шильдик
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.08, 0.18),
      new THREE.MeshToonMaterial({ color: 0x00ffd4, emissive: 0x00ffd4, emissiveIntensity: 0.8 })
    );
    chip.position.set(0, 0.5, 0);
    g.add(chip);

    g.position.set(-LANE_WIDTH / 3, 0, 0);
    g.userData.gameObj = true;
    scene.add(g);

    if (side === 'left') this.birdLeft = { group: g, wingL, wingR, chip, agent };
    else                 this.birdRight = { group: g, wingL, wingR, chip, agent };
  }

  _encode(lane, vy) {
    let next = null, nextDist = 99;
    for (const p of lane.pipes) {
      const d = p.x - (-LANE_WIDTH / 3);
      if (d > -0.3 && d < nextDist) { nextDist = d; next = p; }
    }
    const gapY = next ? next.gapY : 0;
    return encodeState({
      task: 0.6,
      y: lane.birdY / (LANE_HEIGHT / 2),
      vy: Math.max(-1, Math.min(1, vy / 8)),
      gapY: gapY / (LANE_HEIGHT / 2),
      gapDist: Math.max(0, nextDist) / LANE_WIDTH,
      dyToGap: (gapY - lane.birdY) / (LANE_HEIGHT / 2),
      score: Math.min(1, lane.score / 30),
      pad: new Array(40).fill(0)
    });
  }

  _stepLane(dt, side, lane, bird) {
    if (!lane || !bird) return;
    lane.tick++;
    const agent = bird.agent;

    // Encode before action
    const s = this._encode(lane, lane.birdVy);

    // Find nearest pipe for heuristic
    let next = null, nextDist = 99;
    for (const p of lane.pipes) {
      const d = p.x - (-LANE_WIDTH / 3);
      if (d > -0.3 && d < nextDist) { nextDist = d; next = p; }
    }
    const heur = flappyHeuristic(lane.birdY, lane.birdVy, next ? next.gapY : 0);

    const epsBoost = curriculum.epsilonBoost('flappy');
    if (epsBoost > 0) agent.brain.epsilon = Math.min(1, agent.brain.epsilon + epsBoost * 0.005);

    const action = agent.brain.actHybrid(s, heur, lane.alive);
    const flap = (action === 0 || action === 9 || action === 10); // несколько действий трактуем как flap

    if (flap) lane.birdVy = FLAP_IMP;
    lane.birdVy += GRAVITY * dt;
    lane.birdY  += lane.birdVy * dt;

    // move pipes
    for (const p of lane.pipes) {
      p.x -= PIPE_SPEED * dt;
      p.top.position.x = p.x;
      p.bot.position.x = p.x;
    }
    // remove off-screen pipes
    while (lane.pipes.length && lane.pipes[0].x < -LANE_WIDTH / 2 - 1.5) {
      const rm = lane.pipes.shift();
      rm.top.parent?.remove(rm.top); rm.top.geometry?.dispose(); rm.top.material?.dispose();
      rm.bot.parent?.remove(rm.bot); rm.bot.geometry?.dispose(); rm.bot.material?.dispose();
      const last = lane.pipes[lane.pipes.length - 1]?.x ?? 0;
      lane.spawnPipe(last + PIPE_DIST);
    }

    // animate bird
    bird.group.position.y = lane.birdY;
    bird.group.rotation.z = Math.max(-0.6, Math.min(0.6, lane.birdVy * 0.12));
    bird.wingL.rotation.z =  Math.sin(this.t * 20) * 0.8;
    bird.wingR.rotation.z = -Math.sin(this.t * 20) * 0.8;
    bird.chip.material.emissiveIntensity = 0.5 + 0.5 * Math.abs(Math.sin(this.t * 8));

    // scoring (gap passed)
    let reward = -0.01;
    for (const p of lane.pipes) {
      if (!p.passed && p.x < -LANE_WIDTH / 3 - 0.2) {
        p.passed = true;
        lane.score++;
        this.totalPassed[agent.color]++;
        reward += 3.0;
        curriculum.record('flappy', 3.0, true);
        if (lane.score > lane.best) lane.best = lane.score;
        if (lane.score > this.best[agent.color]) this.best[agent.color] = lane.score;
        agent.celebrate('➕');
      }
    }

    // collisions
    const birdX = -LANE_WIDTH / 3;
    const r = 0.35;
    let dead = (Math.abs(lane.birdY) > LANE_HEIGHT / 2 + 0.1);
    if (!dead) {
      for (const p of lane.pipes) {
        if (Math.abs(p.x - birdX) < 0.55) {
          // check gap
          const topY = lane.birdY - r;
          const botY = lane.birdY + r;
          const gapTop = p.gapY + PIPE_GAP / 2;
          const gapBot = p.gapY - PIPE_GAP / 2;
          if (botY > gapTop || topY < gapBot) { dead = true; break; }
        }
      }
    }

    const sNext = this._encode(lane, lane.birdVy);

    if (dead) {
      reward -= 6.0;
      this.totalDeaths[agent.color]++;
      agent.surprise('☠');
      curriculum.record('flappy', -6.0, false);
      agent.pushExperience(s, action, reward * curriculum.rewardScale('flappy'), sNext, true);
      // hard-reset только этой дорожки
      lane.reset();
      agent.setThought('ой, пробую снова', '💥');
    } else {
      agent.pushExperience(s, action, reward * curriculum.rewardScale('flappy'), sNext, false);
    }
  }

  step(dt) {
    if (!this.active) return;
    this.t += dt;
    // capped dt to avoid big jumps at high speed
    const sdt = Math.min(dt, 1 / 30);
    this._stepLane(sdt, 'left',  this.lanes.left,  this.birdLeft);
    this._stepLane(sdt, 'right', this.lanes.right, this.birdRight);
  }

  teardown() {
    super.teardown();
    this.agents.red.mesh.visible = true;
    this.agents.blue.mesh.visible = true;
    this.lanes.left?.dispose();
    this.lanes.right?.dispose();
    this.lanes.left = this.lanes.right = null;
  }

  getHUD() {
    return `
      <div class="game-hud flappy-hud">
        <h3>🐦 Flappy AI (split-screen)</h3>
        <div class="flap-cols">
          <div class="flap-col red">
            <div>КЕЙН (красный)</div>
            <div>Очки: <b>${this.lanes.left?.score ?? 0}</b></div>
            <div>Лучшее: <b>${this.best.red}</b></div>
            <div>Смертей: ${this.totalDeaths.red}</div>
          </div>
          <div class="flap-col blue">
            <div>ЭЙС (синий)</div>
            <div>Очки: <b>${this.lanes.right?.score ?? 0}</b></div>
            <div>Лучшее: <b>${this.best.blue}</b></div>
            <div>Смертей: ${this.totalDeaths.blue}</div>
          </div>
        </div>
      </div>`;
  }
}
