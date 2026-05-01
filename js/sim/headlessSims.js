/**
 * ============================================================
 *  Headless Simulations — абстрактные задачи без графики
 * ============================================================
 *  Реализуют те же дисциплины, что видит пользователь, но без
 *  three.js рендера. Нужны для множественной эволюции (Multi-Sim)
 *  и пошагового мультитренинга (Megatrain).
 *
 *  Каждая Sim выдаёт:
 *    - reset()  → s0
 *    - step(action) → {s, r, done}
 *    - info() → { score, bestAction? }
 *  ACTION_DIM = 12 (совместимо с мозгом).
 * ============================================================
 */

import { encodeState, STATE_DIM, ACTION_DIM } from '../ai/brain.js';

/* =========================================================
 *  MazeSim — упрощённый лабиринт с A*-подсказкой как учителем
 * ========================================================= */
export class MazeSim {
  constructor(size = 11) { this.size = size; this.reset(); }
  reset() {
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
    g[0] = 0; g[1] = 0; g[N] = 0;
    g[(N-1)*N + (N-1)] = 0;
    this.grid = g;
    this.x = 0; this.y = 0;
    this.goal = { x: N - 1, y: N - 1 };
    this.steps = 0; this.score = 0; this.done = false;
    return this._state();
  }
  _state() {
    const N = this.size;
    const walls = [];
    const dirs8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    for (const [dx, dy] of dirs8) {
      const nx = this.x + dx, ny = this.y + dy;
      walls.push((nx < 0 || nx >= N || ny < 0 || ny >= N || this.grid[ny*N+nx] === 1) ? 1 : 0);
    }
    return encodeState({
      task: 0.4,
      dxg: (this.goal.x - this.x) / N,
      dyg: (this.goal.y - this.y) / N,
      walls,
      gx: this.x / N, gy: this.y / N,
      steps: this.steps / 100,
      pad: new Array(30).fill(0)
    });
  }
  step(action) {
    if (this.done) return { s: this._state(), r: 0, done: true };
    this.steps++;
    const N = this.size;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    let r = -0.02;
    if (action < 8) {
      const [dx, dy] = dirs[action];
      const nx = this.x + dx, ny = this.y + dy;
      if (nx >= 0 && nx < N && ny >= 0 && ny < N && this.grid[ny*N+nx] === 0) {
        const dOld = Math.abs(this.goal.x - this.x) + Math.abs(this.goal.y - this.y);
        this.x = nx; this.y = ny;
        const dNew = Math.abs(this.goal.x - this.x) + Math.abs(this.goal.y - this.y);
        r += (dNew < dOld ? 0.15 : -0.05);
      } else r -= 0.1;
    } else r -= 0.02;
    const won = this.x === this.goal.x && this.y === this.goal.y;
    if (won) { r += 10; this.done = true; this.score += 10; }
    if (this.steps > N * N * 3) { this.done = true; }
    return { s: this._state(), r, done: this.done };
  }
  info() { return { score: this.score }; }
}

/* =========================================================
 *  FlappySim — упрощённая флаппи
 * ========================================================= */
export class FlappySim {
  constructor() { this.reset(); }
  reset() {
    this.y = 3; this.vy = 0; this.t = 0;
    this.pipes = [];
    for (let i = 0; i < 3; i++)
      this.pipes.push({ x: 5 + i * 5, gap: 2 + Math.random() * 3, scored: false });
    this.score = 0; this.done = false; this.steps = 0;
    return this._state();
  }
  _state() {
    const next = this.pipes.find(p => p.x > 0) || { x: 12, gap: 3 };
    return encodeState({
      task: 0.15,
      y: (this.y - 3) / 4, vy: this.vy / 5,
      ox: (next.x) / 10,
      gY: (next.gap - 3) / 4,
      dy: (next.gap - this.y) / 4,
      score: this.score / 20,
      pad: new Array(40).fill(0)
    });
  }
  step(action) {
    if (this.done) return { s: this._state(), r: 0, done: true };
    this.steps++;
    const dt = 0.1;
    if (action === 0) this.vy = 4.6;
    this.vy -= dt * 9;
    this.y += this.vy * dt;
    for (const p of this.pipes) p.x -= dt * 3.1;
    this.pipes = this.pipes.filter(p => p.x > -5);
    while (this.pipes.length < 3) {
      const lastX = this.pipes.length ? this.pipes[this.pipes.length-1].x : 0;
      this.pipes.push({ x: lastX + 5, gap: 1.8 + Math.random() * 3.2, scored: false });
    }
    let r = 0.01;
    const next = this.pipes.find(p => p.x > 0) || { x: 12, gap: 3 };
    r += Math.max(-0.05, 0.05 - Math.abs(this.y - next.gap) * 0.02);
    for (const p of this.pipes) {
      if (!p.scored && p.x < 0) {
        p.scored = true; this.score++; r += 1.8;
      }
      if (Math.abs(p.x) < 1.05 && Math.abs(this.y - p.gap) > 0.95) {
        r -= 3; this.done = true;
      }
    }
    if (this.y < 0.3 || this.y > 6.9) { r -= 3; this.done = true; }
    if (this.steps > 800) this.done = true;
    return { s: this._state(), r, done: this.done };
  }
  info() { return { score: this.score }; }
}

/* =========================================================
 *  EscapeSim — беги от лазера (упрощённая 1D)
 *  Агент получает скорость v ∈ [0,1], лазер движется с фикс. скоростью.
 *  Задача — поддерживать опережение. Награда = позиция - лазер.
 * ========================================================= */
export class EscapeSim {
  constructor() { this.reset(); }
  reset() {
    this.pos = 1; this.vel = 0;
    this.laser = -1;
    this.steps = 0; this.done = false; this.score = 0;
    return this._state();
  }
  _state() {
    return encodeState({
      task: 0.8,
      pos: this.pos / 50,
      laser: this.laser / 50,
      gap: (this.pos - this.laser) / 10,
      vel: this.vel / 6,
      steps: this.steps / 300,
      pad: new Array(40).fill(0)
    });
  }
  step(action) {
    if (this.done) return { s: this._state(), r: 0, done: true };
    this.steps++;
    const dt = 0.1;
    // действия: 0..7 — направления (для нашей 1D — 1/+x, 0/−x); 8..11 — жесты
    if (action === 1 || action === 6 || action === 7) this.vel += 1.5;
    else if (action === 0 || action === 4 || action === 5) this.vel -= 0.5;
    else if (action === 9) this.vel += 2.4; // прыжок даёт ускорение
    this.vel *= 0.85;
    this.vel = Math.max(-4, Math.min(6, this.vel));
    this.pos += this.vel * dt;
    this.laser += 0.08 + this.steps * 0.0002;
    const gap = this.pos - this.laser;
    let r = gap > 2 ? 0.08 : gap > 0 ? 0.02 : -0.3;
    r += this.vel > 0 ? 0.02 : -0.01;
    if (gap < -0.5) { r -= 4; this.done = true; }
    if (this.steps > 600) this.done = true;
    this.score = Math.max(this.score, Math.floor(this.pos));
    return { s: this._state(), r, done: this.done };
  }
  info() { return { score: this.score }; }
}

/* =========================================================
 *  SandboxSim — поднять и поставить «кубики» (упрощённо).
 * ========================================================= */
export class SandboxSim {
  constructor() { this.reset(); }
  reset() {
    this.px = 0; this.py = 0;
    this.blocks = [];
    for (let i = 0; i < 8; i++) this.blocks.push({ x: (Math.random()-0.5)*8, y: (Math.random()-0.5)*8, stacked: false });
    this.zone = { x: 4, y: 0 };
    this.carried = null;
    this.tower = 0;
    this.steps = 0; this.done = false; this.score = 0;
    return this._state();
  }
  _state() {
    // ближайший блок
    let nd = 99, nb = null;
    for (const b of this.blocks) if (!b.stacked) {
      const d = Math.hypot(b.x - this.px, b.y - this.py);
      if (d < nd) { nd = d; nb = b; }
    }
    const dx = nb ? (nb.x - this.px) / 10 : 0;
    const dy = nb ? (nb.y - this.py) / 10 : 0;
    const dzx = (this.zone.x - this.px) / 10;
    const dzy = (this.zone.y - this.py) / 10;
    return encodeState({
      task: 0.25,
      dx, dy, dzx, dzy,
      carried: this.carried ? 1 : 0,
      tower: this.tower / 10,
      avail: this.blocks.filter(b => !b.stacked).length / 10,
      steps: this.steps / 200,
      pad: new Array(40).fill(0)
    });
  }
  step(action) {
    if (this.done) return { s: this._state(), r: 0, done: true };
    this.steps++;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    if (action < 8) {
      const [dx, dy] = dirs[action];
      this.px += dx * 0.5; this.py += dy * 0.5;
    }
    this.px = Math.max(-10, Math.min(10, this.px));
    this.py = Math.max(-10, Math.min(10, this.py));
    let r = -0.005;
    if (!this.carried) {
      // пытаемся поднять
      for (const b of this.blocks) {
        if (!b.stacked && Math.hypot(b.x - this.px, b.y - this.py) < 0.7) {
          this.carried = b; r += 0.3; break;
        }
      }
    } else {
      // двигаем блок за собой
      this.carried.x = this.px; this.carried.y = this.py;
      // у зоны — ставим
      if (Math.hypot(this.zone.x - this.px, this.zone.y - this.py) < 0.9) {
        this.carried.stacked = true;
        this.tower++; this.score++;
        r += 1.0 + this.tower * 0.1;
        this.carried = null;
        if (this.blocks.filter(b => !b.stacked).length < 2) {
          for (let i = 0; i < 4; i++)
            this.blocks.push({ x: (Math.random()-0.5)*8, y: (Math.random()-0.5)*8, stacked: false });
        }
      }
    }
    if (this.steps > 400) this.done = true;
    return { s: this._state(), r, done: this.done };
  }
  info() { return { score: this.score }; }
}

/* =========================================================
 *  WorldSim — собирать «звёзды»
 * ========================================================= */
export class WorldSim {
  constructor() { this.reset(); }
  reset() {
    this.px = 0; this.py = 0;
    this.stars = [];
    for (let i = 0; i < 8; i++) this.stars.push({ x: (Math.random()-0.5)*14, y: (Math.random()-0.5)*14 });
    this.score = 0; this.steps = 0; this.done = false;
    return this._state();
  }
  _state() {
    let nd = 99, nb = null;
    for (const s of this.stars) {
      const d = Math.hypot(s.x - this.px, s.y - this.py);
      if (d < nd) { nd = d; nb = s; }
    }
    return encodeState({
      task: 0.05,
      dx: nb ? (nb.x - this.px) / 10 : 0,
      dy: nb ? (nb.y - this.py) / 10 : 0,
      dist: nd / 15,
      selfX: this.px / 10, selfY: this.py / 10,
      stars: this.stars.length / 10,
      steps: this.steps / 300,
      pad: new Array(40).fill(0)
    });
  }
  step(action) {
    if (this.done) return { s: this._state(), r: 0, done: true };
    this.steps++;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    if (action < 8) {
      const [dx, dy] = dirs[action];
      this.px += dx * 0.7; this.py += dy * 0.7;
    }
    this.px = Math.max(-16, Math.min(16, this.px));
    this.py = Math.max(-16, Math.min(16, this.py));
    let r = -0.01;
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      if (Math.hypot(s.x - this.px, s.y - this.py) < 0.6) {
        this.stars.splice(i, 1);
        this.score++;
        r += 1.5;
        this.stars.push({ x: (Math.random()-0.5)*14, y: (Math.random()-0.5)*14 });
      }
    }
    if (this.steps > 500) this.done = true;
    return { s: this._state(), r, done: this.done };
  }
  info() { return { score: this.score }; }
}

export const GAMES = {
  maze:    MazeSim,
  flappy:  FlappySim,
  escape:  EscapeSim,
  sandbox: SandboxSim,
  world:   WorldSim
};

/**
 * Запустить эпизод на указанной симуляции с данным мозгом.
 * Возвращает {score, totalReward, steps}.
 */
export function runEpisode(brain, simCtor, { maxSteps = 800, learn = true } = {}) {
  const sim = new simCtor();
  let s = sim.reset();
  let total = 0;
  let steps = 0;
  while (!sim.done && steps < maxSteps) {
    const a = brain.act(s, true);
    const { s: sNext, r, done } = sim.step(a);
    if (learn) brain.push(s, a, r, sNext, done);
    total += r;
    s = sNext;
    steps++;
  }
  return { score: sim.info().score, totalReward: total, steps };
}

/**
 * Прогоняет несколько эпизодов, возвращает суммарную статистику.
 */
export function evaluate(brain, simCtor, episodes = 3) {
  let best = 0, sum = 0;
  for (let i = 0; i < episodes; i++) {
    const { score } = runEpisode(brain, simCtor, { learn: false });
    sum += score;
    if (score > best) best = score;
  }
  return { best, avg: sum / episodes };
}
